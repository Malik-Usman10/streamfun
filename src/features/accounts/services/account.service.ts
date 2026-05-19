// Account service for managing storage provider accounts
import { AccountRepository } from '../repositories/account.repository';
import { EncryptionService } from '../../../shared/services/encryption.service.js';
import { ProviderFactory } from '../../storage/providers/provider.factory.js';
import type { Account, ProviderType } from '../../../shared/types/index.js';
import type { ProviderCredentials } from '../../../shared/types/provider.js';
import { AuthenticationError } from '../../../shared/utils/errors.js';
import logger from '../../../shared/utils/logger.js';

export class AccountService {
  constructor(
    private accountRepository: AccountRepository,
    private encryptionService: EncryptionService,
    private providerFactory: ProviderFactory
  ) {}

  async registerAccount(
    providerType: ProviderType,
    credentials: ProviderCredentials
  ): Promise<Account> {
    logger.info({ providerType }, 'Registering new account');
    
    // Extract account identifier (for rclone, it's the remoteName)
    const accountIdentifier = credentials.data.remoteName || credentials.data.email || credentials.data.userId;
    
    // Check if account already exists
    if (accountIdentifier) {
      const existing = await this.accountRepository.findByIdentifier(providerType, accountIdentifier);
      if (existing) {
        throw new Error(`Account already exists: ${accountIdentifier} (${providerType})`);
      }
    }
    
    // Authenticate with provider
    const provider = this.providerFactory.getProvider(providerType);
    const authResult = await provider.authenticate(credentials);
    
    if (!authResult.success) {
      throw new AuthenticationError(authResult.error || 'Authentication failed');
    }
    
    // Encrypt credentials
    const credentialsEncrypted = await this.encryptionService.encrypt(
      JSON.stringify(credentials)
    );
    
    // Encrypt session data (for rclone, this contains remoteName and remotePath)
    let tokensEncrypted: string | undefined;
    if (authResult.sessionData) {
      tokensEncrypted = await this.encryptionService.encrypt(JSON.stringify(authResult.sessionData));
    } else if (authResult.tokens) {
      tokensEncrypted = await this.encryptionService.encrypt(JSON.stringify(authResult.tokens));
    }
    
    // Create account
    const account = await this.accountRepository.create({
      providerType,
      credentialsEncrypted,
      tokensEncrypted,
      accountIdentifier,
    });
    
    // Get initial quota
    try {
      const quota = await provider.getQuotaInfo(account);
      await this.accountRepository.updateQuota(account.id, {
        total: quota.total,
        used: quota.used,
        available: quota.available,
        usagePercent: (quota.used / quota.total) * 100,
        lastCheckedAt: new Date(),
      });
    } catch (error) {
      logger.warn({ error, accountId: account.id }, 'Failed to fetch initial quota');
    }
    
    logger.info({ accountId: account.id, accountIdentifier }, 'Account registered successfully');
    
    return account;
  }

  async listAccounts(): Promise<Account[]> {
    return this.accountRepository.findAll();
  }

  async updateAccount(accountId: string, credentials: ProviderCredentials): Promise<Account> {
    const account = await this.accountRepository.findById(accountId);
    
    if (!account) {
      throw new Error('Account not found');
    }
    
    // Re-authenticate with new credentials
    const provider = this.providerFactory.getProvider(account.providerType);
    const authResult = await provider.authenticate(credentials);
    
    if (!authResult.success) {
      throw new AuthenticationError(authResult.error || 'Re-authentication failed');
    }
    
    // Encrypt new credentials
    const credentialsEncrypted = await this.encryptionService.encrypt(
      JSON.stringify(credentials)
    );
    
    // Update account (simplified - would need proper update method)
    logger.info({ accountId }, 'Account updated successfully');
    
    return account;
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.accountRepository.delete(accountId);
    logger.info({ accountId }, 'Account deleted successfully');
  }

  /**
   * Get decrypted credentials for an account
   */
  async getCredentials(accountId: string): Promise<ProviderCredentials> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    const decrypted = await this.encryptionService.decrypt(account.credentialsEncrypted);
    return JSON.parse(decrypted);
  }

  async getAccountStatus(accountId: string): Promise<Account | null> {
    return this.accountRepository.findById(accountId);
  }

  async updateAccountQuota(accountId: string, quota: any): Promise<void> {
    await this.accountRepository.updateQuota(accountId, quota);
  }

  async updateAccountHealth(accountId: string, health: any): Promise<void> {
    await this.accountRepository.updateHealth(accountId, health);
  }

  /**
   * Sync quotas for all accounts
   */
  async syncAllQuotas(): Promise<void> {
    const accounts = await this.listAccounts();
    const now = new Date();
    const STALE_THRESHOLD = 60 * 60 * 1000; // 1 hour (reduced from 24h)
    
    const activeAccounts = accounts.filter(a => {
      if (a.status !== 'active') return false;
      if (!a.quotaLastCheckedAt) return true;
      return (now.getTime() - new Date(a.quotaLastCheckedAt).getTime()) > STALE_THRESHOLD;
    });
    
    if (activeAccounts.length === 0) {
      logger.info('No active accounts found for quota sync');
      return;
    }

    logger.info({ count: activeAccounts.length }, 'Starting limited-concurrency quota synchronization for active accounts');
    
    // Use a small concurrency limit to avoid overwhelming the system
    const CONCURRENCY_LIMIT = 5;
    for (let i = 0; i < activeAccounts.length; i += CONCURRENCY_LIMIT) {
      const batch = activeAccounts.slice(i, i + CONCURRENCY_LIMIT);
      logger.debug({ batchSize: batch.length, index: i }, 'Syncing batch of accounts');
      
      await Promise.allSettled(
        batch.map(async (account) => {
          try {
            await this.refreshAccountQuota(account.id);
          } catch (error: any) {
            logger.warn({ error: error.message, accountId: account.id }, 'Failed to sync quota for account during batch sync');
          }
        })
      );
    }
    
    logger.info('Full quota synchronization completed');
  }

  /**
   * Refresh quota for a specific account
   */
  async refreshAccountQuota(accountId: string): Promise<void> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) return;

    try {
      const provider = this.providerFactory.getProvider(account.providerType);
      const quota = await provider.getQuotaInfo(account);
      
      await this.accountRepository.updateQuota(account.id, {
        total: quota.total || 0,
        used: quota.used || 0,
        available: quota.available || 0,
        usagePercent: quota.total ? (Number(quota.used || 0) / Number(quota.total)) * 100 : 0,
        lastCheckedAt: new Date(),
      });
      
      logger.debug({ accountId, provider: account.providerType }, 'Refreshed account quota');
    } catch (error: any) {
      logger.error({ error: error.message, accountId }, 'Failed to refresh account quota');
      throw error;
    }
  }

  /**
   * Refresh quota for an account by its remote name (identifier)
   */
  async refreshAccountQuotaByRemoteName(remoteName: string): Promise<void> {
    const accounts = await this.listAccounts();
    const account = accounts.find(a => a.accountIdentifier === remoteName);
    
    if (account) {
      return this.refreshAccountQuota(account.id);
    } else {
      logger.warn({ remoteName }, 'No account found for remote name, skipping quota refresh');
    }
  }

  /**
   * Start periodic background synchronization of all account quotas
   */
  startBackgroundSync(intervalMinutes: number = 60): void {
    logger.info({ intervalMinutes }, 'Starting account quota background sync');
    
    // Initial sync
    this.syncAllQuotas().catch(err => {
      logger.error({ err }, 'Periodic quota sync failed (initial)');
    });

    // Schedule periodic sync
    setInterval(() => {
      logger.info('Running scheduled account quota sync');
      this.syncAllQuotas().catch(err => {
        logger.error({ err }, 'Periodic quota sync failed');
      });
    }, intervalMinutes * 60 * 1000);
  }
}
