// Rate limiting middleware using Redis
import { Request, Response, NextFunction } from 'express';
import { redis } from '../../database/redis.js';
import logger from '../utils/logger.js';
import type { AuthenticatedRequest } from '../../features/auth/middleware/auth.middleware.js';

export interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  maxRequests: number;  // Maximum requests per window
  keyPrefix?: string;  // Redis key prefix
}

/**
 * Create rate limiting middleware using sliding window algorithm
 */
export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests, keyPrefix = 'ratelimit' } = config;
  
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Use API key ID or IP address as identifier
      const identifier = req.apiKey?.id || req.ip || 'anonymous';
      const key = `${keyPrefix}:${identifier}`;
      
      const now = Date.now();
      const windowStart = now - windowMs;
      
      // Remove old entries outside the window
      await redis.zremrangebyscore(key, 0, windowStart);
      
      // Count requests in current window
      const requestCount = await redis.zcard(key);
      
      if (requestCount >= maxRequests) {
        // Rate limit exceeded
        const oldestRequest = await redis.zrange(key, 0, 0, 'WITHSCORES');
        const resetTime = oldestRequest.length > 0 
          ? parseInt(oldestRequest[1]) + windowMs 
          : now + windowMs;
        
        const retryAfter = Math.ceil((resetTime - now) / 1000);
        
        logger.warn({ 
          identifier,
          requestCount,
          maxRequests,
          path: req.path,
          method: req.method
        }, 'Rate limit exceeded');
        
        res.status(429)
          .set({
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(resetTime).toISOString(),
            'Retry-After': retryAfter.toString(),
          })
          .json({ 
            error: 'Too many requests',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter
          });
        return;
      }
      
      // Add current request to window
      await redis.zadd(key, now, `${now}-${Math.random()}`);
      
      // Set expiration on key (cleanup)
      await redis.expire(key, Math.ceil(windowMs / 1000));
      
      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': (maxRequests - requestCount - 1).toString(),
        'X-RateLimit-Reset': new Date(now + windowMs).toISOString(),
      });
      
      next();
    } catch (error) {
      // If Redis fails, log error but don't block request
      logger.error({ error, path: req.path, method: req.method }, 'Rate limiting error');
      next();
    }
  };
}

/**
 * Predefined rate limiters for different use cases
 */
export const rateLimiters = {
  // Strict rate limit for uploads (10 requests per minute)
  upload: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 10,
    keyPrefix: 'ratelimit:upload',
  }),
  
  // Moderate rate limit for downloads (30 requests per minute)
  download: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    keyPrefix: 'ratelimit:download',
  }),
  
  // Lenient rate limit for general API (100 requests per minute)
  general: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyPrefix: 'ratelimit:general',
  }),
  
  // Very strict rate limit for admin operations (5 requests per minute)
  admin: createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 5,
    keyPrefix: 'ratelimit:admin',
  }),
};
