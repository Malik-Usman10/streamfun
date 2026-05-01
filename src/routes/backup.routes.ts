import { Router } from 'express';
import multer from 'multer';
import { unlink } from 'fs/promises';
import { BackupQueue } from '../services/backup.queue.js';
import { BackupService } from '../services/backup.service.js';
import { SettingsRepository } from '../repositories/settings.repository.js';

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/',
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB max
  },
  fileFilter: (req, file, cb) => {
    // Accept .sql, .sql.gz, .dump, and .backup files
    if (file.originalname.endsWith('.sql') || 
        file.originalname.endsWith('.sql.gz') || 
        file.originalname.endsWith('.dump') ||
        file.originalname.endsWith('.backup')) {
      cb(null, true);
    } else {
      cb(new Error('Only .sql, .sql.gz, .dump, or .backup files are allowed'));
    }
  },
});

export function createBackupRoutes(
  backupQueue: BackupQueue,
  backupService: BackupService,
  settingsRepo: SettingsRepository
) {
  const router = Router();

  /**
   * GET /api/backup/config
   * Returns the current backup destination, frequency, and status
   */
  router.get('/config', async (req, res, next) => {
    try {
      const destination = await settingsRepo.get('backup_destination');
      const frequency = await settingsRepo.get('backup_frequency') || 'manual';
      const lastRun = await settingsRepo.get('backup_last_run');
      const status = await settingsRepo.get('backup_status');

      res.json({
        destination,
        frequency,
        lastRun,
        status
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/backup/config
   * Updates destination and frequency, then refreshes the scheduler
   */
  router.post('/config', async (req, res, next) => {
    try {
      const { destination, frequency } = req.body;

      if (destination !== undefined) {
        await settingsRepo.set('backup_destination', destination);
      }

      if (frequency !== undefined) {
        await settingsRepo.set('backup_frequency', frequency);
      }

      // Refresh the repeatable schedule in BullMQ
      await backupQueue.updateSchedule();

      res.json({ 
        success: true, 
        message: 'Backup configuration updated and schedule synchronized' 
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/backup/trigger
   * Manually enqueues a backup job to run immediately
   */
  router.post('/trigger', async (req, res, next) => {
    try {
      // Check if destination is configured first
      const destination = await settingsRepo.get('backup_destination');
      if (!destination) {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot trigger backup: No destination configured. Please select a cloud account in Settings.' 
        });
      }

      await backupQueue.triggerManualBackup();
      res.json({ success: true, message: 'Database backup job enqueued successfully' });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/backup/restore
   * Restore database from an uploaded dump file
   */
  router.post('/restore', upload.single('dumpFile'), async (req, res, next) => {
    let uploadedFilePath: string | undefined;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No dump file provided. Please upload a .sql or .sql.gz file.'
        });
      }

      uploadedFilePath = req.file.path;
      const originalFilename = req.file.originalname;

      // Perform the restore with original filename for format detection
      await backupService.restoreDatabase(uploadedFilePath, originalFilename);

      res.json({
        success: true,
        message: 'Database restored successfully from dump file'
      });
    } catch (error: any) {
      next(error);
    } finally {
      // Cleanup uploaded file
      if (uploadedFilePath) {
        try {
          await unlink(uploadedFilePath);
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
      }
    }
  });

  return router;
}
