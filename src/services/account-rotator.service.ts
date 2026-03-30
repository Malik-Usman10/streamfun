// Account rotator for selecting optimal accounts
import { AccountRepository } from '../repositories/account.repository.js';
import { BandwidthTracker } from './bandwidth-tracker.service.js';
import type { Account, ProviderType } from '../types/index.js';
import { NoAvailableAccountError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export class AccountRotator {
  constructor(
    private accountRepository: AccountRepository,
    private bandwidthTracker: BandwidthTracker
  ) {}

  async selectAccountForUpload(
    providerType: ProviderType,
    fileSize: number
  ): Promise<Account> {
    const accounts = await this.accountRepository.findActiveByProvider(providerType);
    
    if (accounts.length === 0) {
      throw new NoAvailableAccountError(`No active accounts for provider: ${providerType}`);
    }
    
    // Filter accounts with sufficient quota
    const eligibleAccounts = accounts.filter((account) => {
      // Skip accounts where total capacity is unknown (0 or null)
      const totalKnown = account.quotaTotal !== null && account.quotaTotal !== undefined && Number(account.quotaTotal) > 0;
      if (!totalKnown) return false;
      // If quota has been checked (quotaAvailable is not null/undefined), enforce the space requirement
      const quotaChecked = account.quotaAvailable !== null && account.quotaAvailable !== undefined;
      const hasQuota = !quotaChecked || Number(account.quotaAvailable) >= fileSize;
      const notFull = account.quotaUsagePercent === null || account.quotaUsagePercent === undefined || account.quotaUsagePercent < 90;
      return hasQuota && notFull;
    });
    
    if (eligibleAccounts.length === 0) {
      throw new NoAvailableAccountError('No accounts with sufficient quota');
    }
    
    const selected = this.roundRobinSelect(eligibleAccounts);
    logger.info({ accountId: selected.id, providerType }, 'Account selected for upload');
    
    return selected;
  }

  async selectAccountForDownload(
    providerType: ProviderType,
    fileSize: number
  ): Promise<Account> {
    const accounts = await this.accountRepository.findActiveByProvider(providerType);
    
    if (accounts.length === 0) {
      throw new NoAvailableAccountError(`No active accounts for provider: ${providerType}`);
    }
    
    // Filter accounts with available bandwidth
    const eligibleAccounts: Account[] = [];
    
    for (const account of accounts) {
      const bandwidthUsage = await this.bandwidthTracker.getUsagePercent(account.id);
      if (bandwidthUsage < 90) {
        eligibleAccounts.push(account);
      }
    }
    
    if (eligibleAccounts.length === 0) {
      throw new NoAvailableAccountError('No accounts with available bandwidth');
    }
    
    const selected = this.roundRobinSelect(eligibleAccounts);
    logger.info({ accountId: selected.id, providerType }, 'Account selected for download');
    
    return selected;
  }

  async updateAccountUsage(accountId: string, bytesUsed: number): Promise<void> {
    const account = await this.accountRepository.findById(accountId);
    
    if (account && account.quotaUsed !== undefined && account.quotaTotal !== undefined) {
      const newUsed = account.quotaUsed + bytesUsed;
      const newAvailable = account.quotaTotal - newUsed;
      const newPercent = (newUsed / account.quotaTotal) * 100;
      
      await this.accountRepository.updateQuota(accountId, {
        total: account.quotaTotal,
        used: newUsed,
        available: newAvailable,
        usagePercent: newPercent,
        lastCheckedAt: new Date(),
      });
    }
    
    await this.accountRepository.updateLastUsed(accountId);
  }

  private roundRobinSelect(accounts: Account[]): Account {
    // Sort by last used timestamp (oldest first)
    return accounts.sort((a, b) => {
      const aTime = a.lastUsedAt?.getTime() || 0;
      const bTime = b.lastUsedAt?.getTime() || 0;
      return aTime - bTime;
    })[0];
  }
}
