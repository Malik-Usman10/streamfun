// Account selector service for intelligent account selection based on quota
import { pool } from '../../../database/connection.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { ProviderFactory } from '../../storage/providers/provider.factory.js';
import type { Account, ProviderType } from '../../../shared/types/index.js';
import logger from '../../../shared/utils/logger.js';

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
  private quotaRefreshInterval = 60 * 60 * 1000; // 1 hour (reduced from 5 mins for base, but threshold below is what matters)
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
      
      // Use cache if less than 1 hour old (reduced from 24h for better responsiveness)
      if (lastRefreshed && (now.getTime() - lastRefreshed.getTime() < 60 * 60 * 1000)) {
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
    
    // Refresh quota from provider
    const timeoutMs = 30000; // 30 seconds timeout for quota check (covers rclone size fallback)
    let timeoutHandle: any;

    const timeoutPromise = new Promise<any>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Quota refresh timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const quota = await Promise.race([
        provider.getQuotaInfo(account),
        timeoutPromise
      ]);
      
      clearTimeout(timeoutHandle);
      
      let totalSpace = quota.total || 0;
      let usedSpace = quota.used || 0;
      let availableSpace = quota.available || 0;

      // If the provider reported total=0, it doesn't support quota reporting (e.g. Filen, Koofr).
      // Use the previously stored total from the DB if we have one (set manually or from a prior successful check).
      if (totalSpace === 0 && account.quotaTotal && Number(account.quotaTotal) > 0) {
        totalSpace = Number(account.quotaTotal);
        availableSpace = Math.max(0, totalSpace - usedSpace);
        logger.info({ accountId, totalSpace, usedSpace, availableSpace }, 
          'Provider did not report total capacity, using DB-stored quota_total');
      }

      // If we still have no total, try to estimate used space from DB file sizes
      if (totalSpace === 0 && usedSpace === 0) {
        const dbUsed = await this.estimateUsedSpaceFromDB(accountId);
        if (dbUsed > 0) {
          usedSpace = dbUsed;
          logger.info({ accountId, dbUsed }, 'Estimated used space from DB file records');
        }
      }

      // Compute available and usage percent
      if (totalSpace > 0) {
        availableSpace = Math.max(0, totalSpace - usedSpace);
      }
      const usagePercent = totalSpace > 0 ? (usedSpace / totalSpace) * 100 : 0;

      const quotaInfo: QuotaInfo = {
        accountId,
        totalSpace,
        usedSpace,
        availableSpace,
        lastUpdated: new Date()
      };

      // Update accounts table cache
      await this.accountRepository.updateQuota(accountId, {
        total: totalSpace,
        used: usedSpace,
        available: availableSpace,
        usagePercent,
        lastCheckedAt: new Date()
      });
      
      logger.info({ accountId, totalSpace, usedSpace, availableSpace, usagePercent: usagePercent.toFixed(1) }, 'Quota refreshed');
      
      return quotaInfo;
    } catch (error: any) {
      clearTimeout(timeoutHandle);
      logger.warn({ accountId, error: error.message }, 'Failed to refresh quota from provider, trying last known value in database');
      
      // Try to get last known quota from DB
      const freshAccount = await this.accountRepository.findById(accountId);
      if (freshAccount && freshAccount.quotaTotal !== null && Number(freshAccount.quotaTotal) > 0) {
        return {
          accountId,
          totalSpace: Number(freshAccount.quotaTotal),
          usedSpace: Number(freshAccount.quotaUsed || 0),
          availableSpace: Number(freshAccount.quotaAvailable || 0),
          lastUpdated: freshAccount.quotaLastCheckedAt || new Date(),
        };
      }

      // Last resort: estimate used from DB, report 0 total (account won't be selected for uploads,
      // which is safer than blindly assuming 100GB free)
      const dbUsed = await this.estimateUsedSpaceFromDB(accountId);
      return {
        accountId,
        totalSpace: 0,
        usedSpace: dbUsed,
        availableSpace: 0,
        lastUpdated: new Date(),
      };
    }
  }

  /**
   * Estimate used space from DB file records for an account.
   * Used when the provider doesn't support quota/about commands.
   */
  private async estimateUsedSpaceFromDB(accountId: string): Promise<number> {
    try {
      const result = await pool.query(
        `SELECT COALESCE(SUM(f.size), 0) as total_used
         FROM files f
         WHERE f.account_id = $1`,
        [accountId]
      );
      return parseInt(result.rows[0]?.total_used || '0', 10);
    } catch (err) {
      logger.warn({ accountId, err }, 'Failed to estimate used space from DB');
      return 0;
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

  /**
   * Select the single best account across ALL provider types based on available space
   */
  async selectBestAccountAcrossProviders(fileSize: number): Promise<{ accountId: string; account: Account; availableSpace: number }> {
    logger.info({ fileSize }, 'Selecting best account across all providers');
    
    const accounts = await this.accountRepository.findAll();
    const activeAccounts = accounts.filter(a => a.status === 'active');
    
    if (activeAccounts.length === 0) {
      throw new Error('No active cloud accounts available');
    }
    
    // Get quota for all accounts (uses cache or refreshes if stale)
    // Use limited concurrency to avoid overwhelming the system with rclone processes
    const CONCURRENCY_LIMIT = 5;
    const accountsWithQuota: { account: Account; quota: QuotaInfo }[] = [];
    
    for (let i = 0; i < activeAccounts.length; i += CONCURRENCY_LIMIT) {
      const batch = activeAccounts.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map(async (account) => {
          try {
            const quota = await this.getAvailableQuota(account.id);
            return { account, quota };
          } catch (error) {
            logger.warn({ accountId: account.id, error }, 'Failed to get quota for account during global selection');
            return { account, quota: { availableSpace: 0 } as QuotaInfo }; 
          }
        })
      );
      accountsWithQuota.push(...batchResults);
    }
    
    // Filter and sort — enforce 90% usage threshold to prevent overfilling
    const MAX_USAGE_PERCENT = 90;
    const validAccounts = accountsWithQuota
      .filter(a => {
        // Skip accounts where we don't know total capacity (totalSpace=0 means quota unknown)
        if (a.quota.totalSpace === 0) {
          logger.debug({ accountId: a.account.id, provider: a.account.providerType }, 
            'Skipping account with unknown total capacity for upload');
          return false;
        }
        // Must have enough space for the file
        if (a.quota.availableSpace < fileSize) return false;
        // Must be under 90% full
        const usagePercent = a.quota.totalSpace > 0 
          ? (a.quota.usedSpace / a.quota.totalSpace) * 100 
          : 0;
        if (usagePercent >= MAX_USAGE_PERCENT) {
          logger.debug({ accountId: a.account.id, usagePercent: usagePercent.toFixed(1) }, 
            'Skipping account over 90% usage threshold');
          return false;
        }
        return true;
      })
      .sort((a, b) => b.quota.availableSpace - a.quota.availableSpace);
      
    if (validAccounts.length === 0) {
      // Find the account with the most space to give a better error message
      const sortedBySpace = accountsWithQuota.sort((a, b) => b.quota.availableSpace - a.quota.availableSpace);
      const bestSpaceAvailable = sortedBySpace[0]?.quota.availableSpace || 0;
      const bestUsagePercent = sortedBySpace[0]?.quota.totalSpace 
        ? ((sortedBySpace[0]?.quota.usedSpace / sortedBySpace[0]?.quota.totalSpace) * 100).toFixed(1)
        : 'unknown';
      throw new Error(
        `No account has enough space or all are over ${MAX_USAGE_PERCENT}% full. ` +
        `Need ${(fileSize / (1024*1024)).toFixed(1)} MB, best available is ${(bestSpaceAvailable / (1024*1024)).toFixed(1)} MB ` + 
        `(${bestUsagePercent}% used)`
      );
    }
    
    const selected = validAccounts[0];
    logger.info({ 
      accountId: selected.account.id, 
      provider: selected.account.providerType,
      availableSpace: (selected.quota.availableSpace / (1024*1024*1024)).toFixed(2) + ' GB',
      usagePercent: selected.quota.totalSpace > 0 
        ? ((selected.quota.usedSpace / selected.quota.totalSpace) * 100).toFixed(1) + '%'
        : 'unknown'
    }, 'Selected best account for upload');
    
    return {
      accountId: selected.account.id,
      account: selected.account,
      availableSpace: selected.quota.availableSpace
    };
  }
}
