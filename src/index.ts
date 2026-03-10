// Main application entry point
import { appConfig } from './config/index.js';
import logger from './utils/logger.js';
import { testConnection, closeConnection } from './database/connection.js';
import { testRedisConnection, closeRedisConnection } from './database/redis.js';
import { createApp } from './app.js';
import { RcloneConfigService } from './services/rclone-config.service.js';

const app = createApp();

// Graceful shutdown handler
async function shutdown(signal: string) {
  logger.info(`${signal} received, starting graceful shutdown`);
  
  try {
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
    app.listen(appConfig.server.port, () => {
      logger.info(
        `StreamFun server started on port ${appConfig.server.port} in ${appConfig.server.env} mode`
      );
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
