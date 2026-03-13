// Account management routes
import { Router } from 'express';
import { AccountService } from '../services/account.service.js';
import { ProviderType } from '../types/index.js';
import logger from '../utils/logger.js';

export function createAccountRoutes(accountService: AccountService): Router {
  const router = Router();

  // Register new account
  router.post('/', async (req, res, next) => {
    try {
      const { provider, credentials, remoteName, remotePath } = req.body;
      
      // Support both old format (credentials) and new format (remoteName/remotePath for rclone)
      let finalCredentials = credentials;
      
      if (!finalCredentials && remoteName) {
        // New rclone format
        finalCredentials = {
          type: 'rclone',
          data: {
            remoteName,
            remotePath: remotePath || 'streamfun',
          },
        };
      }
      
      if (!provider || !finalCredentials) {
        return res.status(400).json({ error: 'Provider and credentials (or remoteName) required' });
      }
      
      const account = await accountService.registerAccount(provider as ProviderType, finalCredentials);
      
      res.status(201).json({
        id: account.id,
        provider: account.providerType,
        status: account.status,
        quotaTotal: account.quotaTotal,
        quotaUsed: account.quotaUsed,
        createdAt: account.createdAt,
      });
    } catch (error) {
      next(error);
    }
  });

  // List all accounts
  router.get('/', async (req, res, next) => {
    try {
      const accounts = await accountService.listAccounts();
      
      res.json({
        accounts: accounts.map((account) => ({
          id: account.id,
          provider: account.providerType,
          status: account.status,
          quotaUsed: account.quotaUsed,
          quotaTotal: account.quotaTotal,
          quotaPercent: account.quotaUsagePercent,
          lastUsed: account.lastUsedAt,
          healthStatus: account.healthError ? 'error' : 'healthy',
          identifier: account.accountIdentifier,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  // Update account
  router.put('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { credentials } = req.body;
      
      if (!credentials) {
        return res.status(400).json({ error: 'Credentials required' });
      }
      
      const account = await accountService.updateAccount(id, credentials);
      
      res.json({
        id: account.id,
        provider: account.providerType,
        status: account.status,
      });
    } catch (error) {
      next(error);
    }
  });

  // Delete account
  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      await accountService.deleteAccount(id);
      
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
