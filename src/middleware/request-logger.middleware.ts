// Request logging middleware
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import type { AuthenticatedRequest } from './auth.middleware.js';

export interface RequestWithId extends AuthenticatedRequest {
  requestId?: string;
}

/**
 * Middleware to log all API requests with structured data
 */
export function requestLogger(req: RequestWithId, res: Response, next: NextFunction): void {
  // Generate unique request ID
  const requestId = uuidv4();
  req.requestId = requestId;
  
  const startTime = Date.now();
  
  // Log incoming request
  logger.info({
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    apiKeyId: req.apiKey?.id,
    apiKeyName: req.apiKey?.name,
  }, 'Incoming request');
  
  // Capture response
  const originalSend = res.send;
  res.send = function (data: any): Response {
    const duration = Date.now() - startTime;
    
    // Log response
    logger.info({
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      apiKeyId: req.apiKey?.id,
    }, 'Request completed');
    
    return originalSend.call(this, data);
  };
  
  next();
}
