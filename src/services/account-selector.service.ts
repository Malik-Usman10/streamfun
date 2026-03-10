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
    // Check cache first
    const cached = await pool.query(
      `SELECT * FROM account_quotas WHERE account_id = $1`,
      [accountId]
    );
    
    if (cached.rows.length > 0) {
      const row = cached.rows[0];
      const lastRefreshed = new Date(row.last_refreshed);
      const now = new Date();
      
      // Use cache if less than 5 minutes old
      if (now.getTime() - lastRefreshed.getTime() < this.quotaRefreshInterval) {
        return {
          accountId: row.account_id,
          totalSpace: parseInt(row.total_space),
          usedSpace: parseInt(row.used_space),
          availableSpace: parseInt(row.available_space),
          lastUpdated: lastRefreshed,
        };
      }
    }
    
    // Refresh quota from provider
    return await this.refreshQuota(accountId);
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
      
      // Update cache
      await pool.query(
        `INSERT INTO account_quotas (account_id, total_space, used_space, available_space, last_refreshed)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (account_id) 
         DO UPDATE SET 
           total_space = $2,
           used_space = $3,
           available_space = $4,
           last_refreshed = NOW(),
           updated_at = NOW()`,
        [accountId, quota.total, quota.used, quota.available]
      );
      
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
      `UPDATE account_quotas 
       SET used_space = used_space + $1,
           available_space = available_space - $1,
           updated_at = NOW()
       WHERE account_id = $2`,
      [uploadedSize, accountId]
    );
    
    logger.debug({ accountId, uploadedSize }, 'Quota updated after upload');
  }
}
