// Redis connection
import { Redis } from 'ioredis';
import { appConfig } from '../config/index.js';
import logger from '../shared/utils/logger.js';

export const redis = new Redis({
  host: appConfig.redis.host,
  port: appConfig.redis.port,
  password: appConfig.redis.password,
  db: appConfig.redis.db,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Redis connection established');
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('ready', () => {
  logger.info('Redis client ready');
});

export async function testRedisConnection(): Promise<boolean> {
  try {
    await redis.ping();
    logger.info('Redis connection test successful');
    return true;
  } catch (error) {
    logger.error({ error }, 'Redis connection test failed');
    return false;
  }
}

export async function closeRedisConnection(): Promise<void> {
  await redis.quit();
  logger.info('Redis connection closed');
}
