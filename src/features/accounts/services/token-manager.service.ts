// Token manager for handling authentication tokens
import { EncryptionService } from '../../../shared/services/encryption.service';
import { AccountRepository } from '../repositories/account.repository.js';
import type { Account } from '../../../shared/types/index.js';
import type { IStorageProvider } from '../../../shared/types/provider.js';
import { TokenRefreshError } from '../../../shared/utils/errors.js';
import logger from '../../../shared/utils/logger.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  sessionData?: Record<string, any>;
}

export class TokenManager {
  constructor(
    private encryptionService: EncryptionService,
    private accountRepository: AccountRepository
  ) {}

  async storeTokens(accountId: string, tokens: AuthTokens): Promise<void> {
    const encrypted = await this.encryptionService.encrypt(JSON.stringify(tokens));
    await this.accountRepository.updateTokens(accountId, encrypted);
    logger.info({ accountId }, 'Tokens stored successfully');
  }

  async getTokens(accountId: string): Promise<AuthTokens> {
    const encrypted = await this.accountRepository.getTokens(accountId);
    const decrypted = await this.encryptionService.decrypt(encrypted);
    return JSON.parse(decrypted);
  }

  async refreshIfNeeded(account: Account, provider: IStorageProvider): Promise<void> {
    if (!account.tokensEncrypted) {
      return;
    }
    
    const tokens = await this.getTokens(account.id);
    
    // Check if token expires within 5 minutes
    const expiresIn = tokens.expiresAt.getTime() - Date.now();
    if (expiresIn < 5 * 60 * 1000) {
      logger.info({ accountId: account.id }, 'Refreshing token');
      
      const result = await provider.refreshToken(account);
      
      if (result.success && result.newAccessToken && result.expiresAt) {
        await this.storeTokens(account.id, {
          accessToken: result.newAccessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: result.expiresAt,
          sessionData: tokens.sessionData,
        });
        
        await this.accountRepository.resetFailures(account.id);
      } else {
        await this.accountRepository.incrementFailures(account.id);
        throw new TokenRefreshError(result.error);
      }
    }
  }
}
