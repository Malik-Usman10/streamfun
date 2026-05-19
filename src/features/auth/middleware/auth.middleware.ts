// API key authentication middleware
import { Request, Response, NextFunction } from 'express';
import { pool } from '../../../database/connection.js';
import crypto from 'crypto';
import logger from '../../../shared/utils/logger.js';
import { AuthService } from '../services/auth.service.js';

export interface AuthenticatedRequest extends Request {
  apiKey?: {
    id: string;
    name: string;
    permissions: string[];
  };
}

/**
 * Middleware to authenticate API requests using API keys
 * Expects API key in Authorization header: "Bearer <api_key>"
 */
export async function authenticateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn({ path: req.path, method: req.method }, 'Missing or invalid authorization header');
      res.status(401).json({ 
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
      return;
    }
    
    const apiKey = authHeader.substring(7); // Remove "Bearer " prefix
    
    if (!apiKey) {
      logger.warn({ path: req.path, method: req.method }, 'Empty API key');
      res.status(401).json({ 
        error: 'Invalid API key',
        code: 'UNAUTHORIZED'
      });
      return;
    }
    
    // Hash the API key to compare with stored hash
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    // Query database for API key
    const result = await pool.query(
      `SELECT id, name, permissions, expires_at, is_active 
       FROM api_keys 
       WHERE key_hash = $1`,
      [keyHash]
    );
    
    if (result.rows.length === 0) {
      logger.warn({ path: req.path, method: req.method }, 'Invalid API key');
      res.status(401).json({ 
        error: 'Invalid API key',
        code: 'UNAUTHORIZED'
      });
      return;
    }
    
    const keyData = result.rows[0];
    
    // Check if key is active
    if (!keyData.is_active) {
      logger.warn({ 
        path: req.path, 
        method: req.method,
        keyId: keyData.id 
      }, 'Inactive API key');
      res.status(401).json({ 
        error: 'API key is inactive',
        code: 'UNAUTHORIZED'
      });
      return;
    }
    
    // Check if key is expired
    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      logger.warn({ 
        path: req.path, 
        method: req.method,
        keyId: keyData.id 
      }, 'Expired API key');
      res.status(401).json({ 
        error: 'API key has expired',
        code: 'UNAUTHORIZED'
      });
      return;
    }
    
    // Attach API key info to request
    req.apiKey = {
      id: keyData.id,
      name: keyData.name,
      permissions: keyData.permissions || [],
    };
    
    // Update last_used_at
    await pool.query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
      [keyData.id]
    );
    
    logger.info({ 
      path: req.path, 
      method: req.method,
      keyId: keyData.id,
      keyName: keyData.name
    }, 'API key authenticated');
    
    next();
  } catch (error) {
    logger.error({ error, path: req.path, method: req.method }, 'Authentication error');
    res.status(500).json({ 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
}

/**
 * Middleware to check if authenticated API key has required permission
 */
export function requirePermission(permission: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      res.status(401).json({ 
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
      return;
    }
    
    if (!req.apiKey.permissions.includes(permission) && !req.apiKey.permissions.includes('admin')) {
      logger.warn({ 
        keyId: req.apiKey.id,
        requiredPermission: permission,
        keyPermissions: req.apiKey.permissions
      }, 'Insufficient permissions');
      res.status(403).json({ 
        error: 'Insufficient permissions',
        code: 'FORBIDDEN'
      });
      return;
    }
    
    next();
  };
}

/**
 * Optional authentication - allows both authenticated and unauthenticated requests
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No auth provided, continue without authentication
    next();
    return;
  }
  
  // Auth provided, validate it
  await authenticateApiKey(req, res, next);
}

const authService = new AuthService();

/**
 * Middleware to require JWT user authentication if enabled in settings
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const isEnabled = await authService.isAuthEnabled();
    
    // Pass strictly through if auth is disabled
    if (!isEnabled) {
      return next();
    }

    const token = req.cookies?.auth_token;

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const isValid = authService.verifyToken(token);
    
    if (!isValid) {
      res.status(401).json({ error: 'Invalid or expired authentication' });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}
