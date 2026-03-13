import { Queue, Worker, type Job } from 'bullmq';
import { appConfig } from '../config/index.js';
import { BackupService } from './backup.service.js';
import { SettingsRepository } from '../repositories/settings.repository.js';
import logger from '../utils/logger.js';

const QUEUE_NAME = 'database-backup';

const redisConnection = {
  host: appConfig.redis.host,
  port: appConfig.redis.port,
  password: appConfig.redis.password,
};

export class BackupQueue {
  private queue: Queue;
  private worker: Worker | null = null;

  constructor(
    private backupService: BackupService,
    private settingsRepo: SettingsRepository
  ) {
    this.queue = new Queue(QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    });
  }

  /**
   * Update the backup schedule based on settings
   * Clears old repeatable jobs and sets up a new one if frequency is not manual
   */
  async updateSchedule(): Promise<void> {
    try {
      // 1. Get current configuration
      const frequency = await this.settingsRepo.get('backup_frequency') || 'manual';
      
      // 2. Remove all existing repeatable jobs for this queue
      const repeatableJobs = await this.queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        await this.queue.removeRepeatableByKey(job.key);
      }

      if (frequency === 'manual') {
        logger.info('Backup schedule cleared (set to manual)');
        return;
      }

      // 3. Set new cron pattern
      let cron = '';
      if (frequency === 'daily') {
        cron = '0 0 * * *'; // Midnight every day
      } else if (frequency === 'weekly') {
        cron = '0 0 * * 0'; // Midnight every Sunday
      } else {
        logger.warn({ frequency }, 'Unsupported backup frequency, defaulting to manual');
        return;
      }

      // 4. Add the repeatable job
      await this.queue.add('scheduled-backup', {}, {
        repeat: { pattern: cron }
      });

      logger.info({ frequency, cron }, 'Database backup schedule initialized');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to update backup schedule');
    }
  }

  /**
   * Manually trigger a backup job immediately
   */
  async triggerManualBackup(): Promise<void> {
    await this.queue.add(`manual-backup-${Date.now()}`, {});
    logger.info('Manual database backup job enqueued');
  }

  /**
   * Start the backup worker to process jobs
   */
  startWorker(): void {
    if (!appConfig.workers.enabled) {
      logger.info('Backup worker disabled by configuration');
      return;
    }

    this.worker = new Worker(
      QUEUE_NAME,
      async () => {
        logger.info('Processing database backup job');
        await this.backupService.performBackup();
      },
      { 
        connection: redisConnection,
        concurrency: 1 // Never run multiple backups at once
      }
    );

    this.worker.on('completed', (job: Job) => {
      logger.info({ jobId: job.id }, 'Database backup job completed successfully');
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      logger.error({ jobId: job?.id, error: err.message }, 'Database backup job failed');
    });

    logger.info('Database backup worker started');
  }

  async close(): Promise<void> {
    if (this.worker) await this.worker.close();
    await this.queue.close();
  }
}
