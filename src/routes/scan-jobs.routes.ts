// REST API routes for scan_jobs (auto-upload tracking)
import { Router } from 'express';
import { ScanJobRepository } from '../repositories/scan-job.repository.js';
import { ChunkRepository } from '../repositories/chunk.repository.js';
import { DirectoryScanner } from '../services/directory-scanner.service.js';
import { AutoUploadQueue } from '../services/auto-upload.queue.js';
import logger from '../utils/logger.js';

export function createScanJobRoutes(
  scanJobRepo: ScanJobRepository,
  chunkRepo: ChunkRepository,
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
      const directoryName = req.query.directoryName as string | undefined;
 
      const jobs = await scanJobRepo.getAll({
        limit,
        offset,
        status: status?.includes(',') ? status.split(',') as any : status as any,
        directoryName
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

  // GET /api/scan-jobs/groups — summary by directory
  router.get('/groups', async (_req, res, next) => {
    try {
      const groups = await scanJobRepo.getGroupedStats();
      res.json(groups);
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

      let fallbackChunkIndex: number | undefined;

      // Smart Integrity Repair logic
      // If the error message contains "[chunk:X]", then only wipe that specific corrupted chunk
      if (job.errorMessage && job.errorMessage.startsWith('INTEGRITY_FAILURE') && job.fileId) {
        const chunkMatch = job.errorMessage.match(/\[chunk:(\d+)\]/);
        if (chunkMatch) {
          const badIndex = parseInt(chunkMatch[1], 10);
          logger.info({ fileId: job.fileId, badIndex }, 'Applying smart integrity repair for corrupted chunk');
          await chunkRepo.deleteChunkByIndex(job.fileId, badIndex);
          fallbackChunkIndex = badIndex;
        } else {
          // Fallback: If no chunk is specified, we wipe all chunks to enforce a clean re-upload
          logger.warn({ fileId: job.fileId }, 'Applying full integrity repair (no chunk specified)');
          await chunkRepo.deleteChunksByFileId(job.fileId);
          fallbackChunkIndex = 0;
        }
      }

      await scanJobRepo.resetForRetry(job.id, fallbackChunkIndex);
      
      // Clear corrupted metadata if file exists so auto-uploader doesn't skip it
      if (job.fileId) {
        const { FileRepository } = await import('../repositories/file.repository.js');
        const fileRepo = new FileRepository();
        await fileRepo.update(job.fileId, {
          metadata: { corrupted: false, corruptionReason: null, corruptedAt: null }
        }).catch(() => {});
      }

      // Use progress for priority: single-chunk repairs keep original high progress,
      // full wipe repairs reset to 0
      const retryProgress = (fallbackChunkIndex !== undefined && fallbackChunkIndex > 0) 
        ? job.progress 
        : 0;

      await queue.enqueue({
        scanJobId: job.id,
        sourcePath: job.sourcePath,
        filename: job.filename,
        fileSize: job.fileSize,
        mimeType: job.mimeType ?? 'application/octet-stream',
        directoryName: job.directoryName ?? undefined,
        isRecovery: true, // Route retries to priority queue
        progress: retryProgress,
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
