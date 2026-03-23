// Main application entry point
import { appConfig } from './config/index.js';
import logger from './utils/logger.js';
import { testConnection, closeConnection } from './database/connection.js';
import { testRedisConnection, closeRedisConnection } from './database/redis.js';
import { createApp, getAppContext } from './app.js';
import { RcloneConfigService } from './services/rclone-config.service.js';

const app = createApp();

// Graceful shutdown handler
async function shutdown(signal: string) {
  logger.info(`${signal} received, starting graceful shutdown`);

  try {
    const ctx = getAppContext();
    if (ctx) {
      await ctx.scanner.stop();
      await ctx.queue.close();
      await ctx.backupQueue.close();
    }
    await closeConnection();
    await closeRedisConnection();
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
async function start() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }
    
    // Test Redis connection
    const redisConnected = await testRedisConnection();
    if (!redisConnected) {
      logger.warn('Redis connection failed, caching will be disabled');
    }
    
    // Initialize rclone service
    try {
      const rcloneService = new RcloneConfigService();
      await rcloneService.initialize();
      logger.info('Rclone service initialized successfully');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Rclone initialization failed');
      logger.warn('Cloud storage features will not be available');
      // Don't exit - allow server to start without rclone
    }
    
    // Start Express server
    app.listen(appConfig.server.port, async () => {
      logger.info(
        `StreamFun server started on port ${appConfig.server.port} in ${appConfig.server.env} mode`
      );

      // Start directory scanner and upload worker
      const ctx = getAppContext();
      if (ctx) {
        try {
          // Only start the BullMQ upload worker if auto-scan is enabled.
          logger.info({ autoScan: appConfig.upload.autoScan }, 'Auto-upload system configuration status');
          if (appConfig.upload.autoScan) {
            // CRITICAL: Drain all stale Redis jobs FIRST, then re-enqueue from DB
            // with correct priority routing, then start workers.
            // If workers start first, they grab old Redis jobs before we can
            // re-route high-progress repairs to the priority queue.
            await ctx.queue.drainStaleJobs();
            await ctx.queue.recoverInterrupted();

            // NOW start BullMQ workers (queues are clean and correctly routed)
            ctx.queue.startWorker();

            // Start watching /uploads directory
            await ctx.scanner.start();

            logger.info('Auto-upload system started successfully');
          } else {
            logger.info('Auto-scan disabled, skipping upload worker and directory watcher');
          }

          // Performance: Initial quota sync for all accounts ONE TIME on startup
          logger.info('Syncing initial quotas for all accounts...');
          ctx.accountService.syncAllQuotas().catch(err => {
            logger.error({ err }, 'Initial quota sync failed (non-fatal)');
          });

          // Initialize backup system
          ctx.backupQueue.startWorker();
          await ctx.backupQueue.updateSchedule();
        } catch (err) {
          logger.error({ err }, 'Failed to start auto-upload system (non-fatal)');
        }
      }
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
