// Global error handler middleware
import type { Request, Response, NextFunction } from 'express';
import { StreamFunError } from '../utils/errors.js';
import { RcloneError } from '../utils/rclone-error.js';
import logger from '../utils/logger.js';

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error(
    {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
    },
    'Request error'
  );

  if (error instanceof RcloneError) {
    return res.status(400).json({
      error: error.message,
      type: error.type,
      retryable: error.retryable,
      details: error.details,
    });
  }

  if (error instanceof StreamFunError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
  }

  // Default error
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
}
