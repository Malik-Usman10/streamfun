// Account selector service for intelligent account selection based on quota
import { pool } from '../database/connection.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import type { Account, ProviderType } from '../types/index.js';
import logger from '../utils/logger.js';

export interface QuotaInfo {
  accountId: string;
  totalSpace: number;
  usedSpace: number;
  availableSpace: number;
  lastUpdated: Date;
}

export interface SelectedAccount {
  accountId: string;
  account: Account;
  availableSpace: number;
  allocatedSize: number;  // How much of the file will be stored here
}

export interface AccountSelection {
  accounts: SelectedAccount[];
  strategy: 'single' | 'distributed';
}

export class AccountSelector {
  private quotaRefreshInterval = 5 * 60 * 1000; // 5 minutes
  private refreshInProgress = new Map<string, Promise<QuotaInfo>>(); // Prevent concurrent refreshes
  
  constructor(
    private accountRepository: AccountRepository,
    private providerFactory: ProviderFactory
  ) {}

  /**
   * Select account(s) for uploading a file based on available quota
   */
  async selectAccountsForUpload(
    fileSize: number,
    providerType: ProviderType
  ): Promise<AccountSelection> {
    logger.info({ fileSize, providerType }, 'Selecting accounts for upload');
    
    // Get all active accounts for this provider
    const accounts = await this.accountRepository.findAll();
    const activeAccounts = accounts.filter(
      a => a.providerType === providerType && a.status === 'active'
    );
    
    if (activeAccounts.length === 0) {
      throw new Error(`No active accounts available for provider: ${providerType}`);
    }
    
    // Get quota information for each account
    const accountsWithQuota = await Promise.all(
      activeAccounts.map(async (account) => {
        const quota = await this.getAvailableQuota(account.id);
        return {
          account,
          quota,
        };
      })
    );
    
    // Filter accounts with sufficient space
    const accountsWithSpace = accountsWithQuota.filter(
      a => a.quota.availableSpace >= fileSize
    );
    
    if (accountsWithSpace.length > 0) {
      // Single account strategy - select account with most available space
      accountsWithSpace.sort((a, b) => b.quota.availableSpace - a.quota.availableSpace);
      const selected = accountsWithSpace[0];
      
      logger.info({ 
        accountId: selected.account.id,
        availableSpace: selected.quota.availableSpace,
        fileSize 
      }, 'Selected single account for upload');
      
      return {
        accounts: [{
          accountId: selected.account.id,
          account: selected.account,
          availableSpace: selected.quota.availableSpace,
          allocatedSize: fileSize,
        }],
        strategy: 'single',
      };
    }
    
    // Distributed strategy - no single account has enough space
    // Distribute across multiple accounts based on available space
    const totalAvailable = accountsWithQuota.reduce(
      (sum, a) => sum + a.quota.availableSpace,
      0
    );
    
    if (totalAvailable < fileSize) {
      throw new Error(
        `Insufficient total space: need ${fileSize} bytes, have ${totalAvailable} bytes`
      );
    }
    
    // Sort by available space (descending)
    accountsWithQuota.sort((a, b) => b.quota.availableSpace - a.quota.availableSpace);
    
    // Allocate file size proportionally based on available space
    const selectedAccounts: SelectedAccount[] = [];
    let remainingSize = fileSize;
    
    for (const { account, quota } of accountsWithQuota) {
      if (remainingSize <= 0) break;
      
      const allocatedSize = Math.min(quota.availableSpace, remainingSize);
      
      selectedAccounts.push({
        accountId: account.id,
        account,
        availableSpace: quota.availableSpace,
        allocatedSize,
      });
      
      remainingSize -= allocatedSize;
    }
    
    logger.info({ 
      accountCount: selectedAccounts.length,
      fileSize,
      strategy: 'distributed'
    }, 'Selected multiple accounts for distributed upload');
    
    return {
      accounts: selectedAccounts,
      strategy: 'distributed',
    };
  }

  /**
   * Get available quota for an account (with caching)
   */
  async getAvailableQuota(accountId: string): Promise<QuotaInfo> {
    // Check accounts table for cached quota
    const cached = await pool.query(
      `SELECT id, quota_total, quota_used, quota_available, quota_last_checked_at 
       FROM accounts WHERE id = $1`,
      [accountId]
    );
    
    if (cached.rows.length > 0) {
      const row = cached.rows[0];
      const lastRefreshed = row.quota_last_checked_at ? new Date(row.quota_last_checked_at) : null;
      const now = new Date();
      
      // Use cache if less than 24 hours old (aligned with dashboard cache)
      if (lastRefreshed && (now.getTime() - lastRefreshed.getTime() < 24 * 60 * 60 * 1000)) {
        return {
          accountId: row.id,
          totalSpace: parseInt(row.quota_total || '0'),
          usedSpace: parseInt(row.quota_used || '0'),
          availableSpace: parseInt(row.quota_available || '0'),
          lastUpdated: lastRefreshed,
        };
      }
    }
    
    // Check if refresh is already in progress for this account
    if (this.refreshInProgress.has(accountId)) {
      logger.info({ accountId }, 'Quota refresh already in progress, waiting...');
      return await this.refreshInProgress.get(accountId)!;
    }
    
    // Refresh quota from provider
    const refreshPromise = this.refreshQuota(accountId);
    this.refreshInProgress.set(accountId, refreshPromise);
    
    try {
      const result = await refreshPromise;
      return result;
    } finally {
      // Clean up the in-progress tracker
      this.refreshInProgress.delete(accountId);
    }
  }

  /**
   * Refresh quota information from provider
   */
  async refreshQuota(accountId: string): Promise<QuotaInfo> {
    logger.info({ accountId }, 'Refreshing quota from provider');
    
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }
    
    const provider = this.providerFactory.getProvider(account.providerType);
    
    try {
      const quota = await provider.getQuotaInfo(account);
      
      const quotaInfo: QuotaInfo = {
        accountId,
        totalSpace: quota.total,
        usedSpace: quota.used,
        availableSpace: quota.available,
        lastUpdated: new Date(),
      };
      
      // Update accounts table cache
      await this.accountRepository.updateQuota(accountId, {
        total: quota.total,
        used: quota.used,
        available: quota.available, // This is free bytes
        usagePercent: quota.total ? (quota.used / quota.total) * 100 : 0,
        lastCheckedAt: new Date()
      });
      
      logger.info({ accountId, availableSpace: quota.available }, 'Quota refreshed');
      
      return quotaInfo;
    } catch (error) {
      logger.warn({ accountId, error }, 'Failed to refresh quota, using defaults');
      
      // Return default quota if refresh fails
      return {
        accountId,
        totalSpace: 100 * 1024 * 1024 * 1024, // 100 GB default
        usedSpace: 0,
        availableSpace: 100 * 1024 * 1024 * 1024,
        lastUpdated: new Date(),
      };
    }
  }

  /**
   * Update quota after upload (estimate)
   */
  async updateQuotaAfterUpload(accountId: string, uploadedSize: number): Promise<void> {
    await pool.query(
      `UPDATE accounts 
       SET quota_used = COALESCE(quota_used, 0) + $1,
           quota_available = GREATEST(0, COALESCE(quota_available, 0) - $1),
           updated_at = NOW()
       WHERE id = $2`,
      [uploadedSize, accountId]
    );
    
    logger.debug({ accountId, uploadedSize }, 'Quota updated after upload');
  }
}
