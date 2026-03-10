// Dashboard API routes for admin interface
import { Router } from 'express';
import { pool } from '../database/connection.js';
import { AccountService } from '../services/account.service.js';
import logger from '../utils/logger.js';

export function createDashboardRoutes(accountService: AccountService): Router {
  const router = Router();

  // Get system statistics
  router.get('/stats', async (req, res, next) => {
    try {
      // Get total files and size
      const filesStats = await pool.query(`
        SELECT 
          COUNT(*) as total_files,
          COALESCE(SUM(size), 0) as total_size
        FROM files
      `);
      
      // Get stats by provider
      const providerStats = await pool.query(`
        SELECT 
          provider_type,
          COUNT(*) as file_count,
          COALESCE(SUM(size), 0) as total_size
        FROM files
        GROUP BY provider_type
      `);
      
      // Get account stats
      const accountStats = await pool.query(`
        SELECT 
          COUNT(*) as total_accounts,
          COUNT(*) FILTER (WHERE status = 'active') as active_accounts,
          COALESCE(SUM(quota_total), 0) as total_quota,
          COALESCE(SUM(quota_used), 0) as total_used
        FROM accounts
      `);
      
      res.json({
        files: {
          total: parseInt(filesStats.rows[0].total_files),
          totalSize: parseInt(filesStats.rows[0].total_size),
        },
        accounts: {
          total: parseInt(accountStats.rows[0].total_accounts),
          active: parseInt(accountStats.rows[0].active_accounts),
          totalQuota: parseInt(accountStats.rows[0].total_quota),
          totalUsed: parseInt(accountStats.rows[0].total_used),
        },
        byProvider: providerStats.rows.map(row => ({
          provider: row.provider_type,
          fileCount: parseInt(row.file_count),
          totalSize: parseInt(row.total_size),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  // Get all accounts with complete information
  router.get('/accounts', async (req, res, next) => {
    try {
      const accounts = await accountService.listAccounts();
      
      res.json({
        accounts: accounts.map(account => ({
          id: account.id,
          provider: account.providerType,
          status: account.status,
          quota: {
            total: account.quotaTotal,
            used: account.quotaUsed,
            available: account.quotaAvailable,
            usagePercent: account.quotaUsagePercent,
          },
          health: {
            status: account.healthError ? 'error' : 'healthy',
            error: account.healthError,
            lastChecked: account.lastHealthCheckAt,
          },
          lastUsed: account.lastUsedAt,
          createdAt: account.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  // Get audit logs
  router.get('/audit-logs', async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const eventType = req.query.eventType as string;
      const dateFrom = req.query.dateFrom as string;
      const dateTo = req.query.dateTo as string;
      
      const offset = (page - 1) * limit;
      
      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;
      
      if (eventType) {
        query += ` AND event_type = $${paramIndex}`;
        params.push(eventType);
        paramIndex++;
      }
      
      if (dateFrom) {
        query += ` AND created_at >= $${paramIndex}`;
        params.push(dateFrom);
        paramIndex++;
      }
      
      if (dateTo) {
        query += ` AND created_at <= $${paramIndex}`;
        params.push(dateTo);
        paramIndex++;
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);
      
      const result = await pool.query(query, params);
      
      // Get total count
      let countQuery = 'SELECT COUNT(*) as count FROM audit_logs WHERE 1=1';
      const countParams: any[] = [];
      let countParamIndex = 1;
      
      if (eventType) {
        countQuery += ` AND event_type = $${countParamIndex}`;
        countParams.push(eventType);
        countParamIndex++;
      }
      
      if (dateFrom) {
        countQuery += ` AND created_at >= $${countParamIndex}`;
        countParams.push(dateFrom);
        countParamIndex++;
      }
      
      if (dateTo) {
        countQuery += ` AND created_at <= $${countParamIndex}`;
        countParams.push(dateTo);
      }
      
      const countResult = await pool.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count);
      
      res.json({
        logs: result.rows.map(row => ({
          id: row.id,
          eventType: row.event_type,
          userId: row.user_id,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          action: row.action,
          metadata: row.metadata,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          createdAt: row.created_at,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
