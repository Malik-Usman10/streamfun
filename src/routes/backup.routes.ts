import { Router } from 'express';
import { BackupQueue } from '../services/backup.queue.js';
import { SettingsRepository } from '../repositories/settings.repository.js';

export function createBackupRoutes(
  backupQueue: BackupQueue,
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

  return router;
}
