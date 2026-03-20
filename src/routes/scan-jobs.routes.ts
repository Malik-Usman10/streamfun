// REST API routes for scan_jobs (auto-upload tracking)
import { Router } from 'express';
import { ScanJobRepository } from '../repositories/scan-job.repository.js';
import { DirectoryScanner } from '../services/directory-scanner.service.js';
import { AutoUploadQueue } from '../services/auto-upload.queue.js';
import logger from '../utils/logger.js';

export function createScanJobRoutes(
  scanJobRepo: ScanJobRepository,
  scanner: DirectoryScanner,
  queue: AutoUploadQueue
): Router {
  const router = Router();

  // GET /api/scan-jobs — list all jobs (paginated, filterable by status)
  router.get('/', async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const status = req.query.status as string | undefined;

      const jobs = await scanJobRepo.getAll({
        limit,
        offset,
        status: status as any,
      });

      res.json({ jobs, limit, offset });
    } catch (err) { next(err); }
  });

  // GET /api/scan-jobs/stats — summary counts
  router.get('/stats', async (_req, res, next) => {
    try {
      const stats = await scanJobRepo.getStats();
      res.json(stats);
    } catch (err) { next(err); }
  });

  // POST /api/scan-jobs/scan — trigger a manual rescan
  router.post('/scan', async (_req, res, next) => {
    try {
      const result = await scanner.rescan();
      logger.info({ discovered: result.discovered }, 'Manual rescan completed');
      res.json({ success: true, discovered: result.discovered });
    } catch (err) { next(err); }
  });

  // POST /api/scan-jobs/:id/retry — retry a failed job
  router.post('/:id/retry', async (req, res, next) => {
    try {
      const job = await scanJobRepo.findById(req.params.id);
      if (!job) return res.status(404).json({ error: 'Scan job not found' });
      if (job.status !== 'failed') {
        return res.status(400).json({ error: 'Only failed jobs can be retried' });
      }

      await scanJobRepo.resetForRetry(job.id);
      await queue.enqueue({
        scanJobId: job.id,
        sourcePath: job.sourcePath,
        filename: job.filename,
        fileSize: job.fileSize,
        mimeType: job.mimeType ?? 'application/octet-stream',
        directoryName: job.directoryName ?? undefined,
      });

      res.json({ success: true, message: 'Job re-queued' });
    } catch (err) { next(err); }
  });

  // DELETE /api/scan-jobs/:id — remove a completed/failed entry from tracking
  router.delete('/:id', async (req, res, next) => {
    try {
      const job = await scanJobRepo.findById(req.params.id);
      if (!job) return res.status(404).json({ error: 'Scan job not found' });

      await scanJobRepo.delete(job.id);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // POST /api/scan-jobs/:id/dismiss — dismiss a failed job
  router.post('/:id/dismiss', async (req, res, next) => {
    try {
      const job = await scanJobRepo.findById(req.params.id);
      if (!job) return res.status(404).json({ error: 'Scan job not found' });
      if (job.status !== 'failed') {
        return res.status(400).json({ error: 'Only failed jobs can be dismissed' });
      }

      await scanJobRepo.markDismissed(job.id);
      res.json({ success: true, message: 'Job dismissed' });
    } catch (err) { next(err); }
  });

  return router;
}
