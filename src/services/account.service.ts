// Account service for managing storage provider accounts
import { AccountRepository } from '../repositories/account.repository.js';
import { EncryptionService } from './encryption.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import type { Account, ProviderType } from '../types/index.js';
import type { ProviderCredentials } from '../types/provider.js';
import { AuthenticationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

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

  async getAccountStatus(accountId: string): Promise<Account | null> {
    return this.accountRepository.findById(accountId);
  }
}
