// Cache service wrapper for Redis
import { redis } from '../database/redis.js';
import logger from '../utils/logger.js';

export class CacheService {
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error({ error, key }, 'Cache get failed');
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await redis.setex(key, ttl, serialized);
      } else {
        await redis.set(key, serialized);
      }
    } catch (error) {
      logger.error({ error, key }, 'Cache set failed');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await redis.del(key);
    } catch (error) {
      logger.error({ error, key }, 'Cache delete failed');
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error({ error, key }, 'Cache exists check failed');
      return false;
    }
  }

  /**
   * Store binary data (like video chunks) in Redis
   * @param key - Cache key
   * @param buffer - Binary data to store
   * @param ttl - Time to live in seconds (default: 1 hour)
   */
  async setBuffer(key: string, buffer: Buffer, ttl: number = 3600): Promise<void> {
    try {
      await redis.setex(key, ttl, buffer);
      logger.debug({ key, size: buffer.length, ttl }, 'Buffer cached');
    } catch (error) {
      logger.error({ error, key }, 'Cache setBuffer failed');
    }
  }

  /**
   * Retrieve binary data from Redis
   * @param key - Cache key
   * @returns Buffer or null if not found
   */
  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      const value = await redis.getBuffer(key);
      if (value) {
        logger.debug({ key, size: value.length }, 'Buffer cache hit');
      }
      return value;
    } catch (error) {
      logger.error({ error, key }, 'Cache getBuffer failed');
      return null;
    }
  }

  /**
   * Delete all keys matching a pattern
   * @param pattern - Redis key pattern (e.g., "chunk:fileId:*")
   */
  async deletePattern(pattern: string): Promise<number> {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length === 0) return 0;
      
      const deleted = await redis.del(...keys);
      logger.debug({ pattern, deleted }, 'Pattern deleted from cache');
      return deleted;
    } catch (error) {
      logger.error({ error, pattern }, 'Cache deletePattern failed');
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ keys: number; memory: string }> {
    try {
      const dbsize = await redis.dbsize();
      const info = await redis.info('memory');
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memory = memoryMatch ? memoryMatch[1].trim() : 'unknown';
      
      return { keys: dbsize, memory };
    } catch (error) {
      logger.error({ error }, 'Failed to get cache stats');
      return { keys: 0, memory: 'unknown' };
    }
  }
}
