import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';

export function createAuthRoutes(): Router {
  const router = Router();
  const authService = new AuthService();

  // Check auth status
  router.get('/status', async (req, res, next) => {
    try {
      const isEnabled = await authService.isAuthEnabled();
      res.json({ enabled: isEnabled });
    } catch (error) {
      next(error);
    }
  });

  // Setup password (only allowed if auth is not currently enabled, or if they are already logged in)
  router.post('/setup', async (req, res, next) => {
    try {
      const { password } = req.body;
      const isEnabled = await authService.isAuthEnabled();
      
      // If auth is already enabled, only an authenticated user can change it
      if (isEnabled) {
        const token = req.cookies?.auth_token;
        if (!token || !authService.verifyToken(token)) {
          return res.status(401).json({ error: 'Unauthorized to change password' });
        }
      }

      if (!password) {
        return res.status(400).json({ error: 'Password required' });
      }

      await authService.setupPassword(password);
      res.json({ success: true, message: 'Authentication setup successfully' });
    } catch (error) {
      next(error);
    }
  });

  // Disable auth (must be authenticated)
  router.post('/disable', async (req, res, next) => {
    try {
      const token = req.cookies?.auth_token;
      if (!token || !authService.verifyToken(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      await authService.disableAuth();
      res.json({ success: true, message: 'Authentication disabled' });
    } catch (error) {
      next(error);
    }
  });

  // Login
  router.post('/login', async (req, res, next) => {
    try {
      const { password } = req.body;
      
      if (!password) {
        return res.status(400).json({ error: 'Password required' });
      }

      const isValid = await authService.verifyPassword(password);
      
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid password' });
      }

      const token = authService.generateToken();
      
      // Set HTTP-Only cookie
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        path: '/'
      });

      res.json({ success: true, message: 'Logged in successfully' });
    } catch (error) {
      next(error);
    }
  });

  // Logout
  router.post('/logout', (req, res) => {
    res.clearCookie('auth_token', { path: '/' });
    res.json({ success: true, message: 'Logged out successfully' });
  });

  return router;
}
