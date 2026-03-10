// Stream service for generating and caching streaming links
import { FileRepository } from '../repositories/file.repository.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { CacheService } from './cache.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import logger from '../utils/logger.js';

export class StreamService {
  private readonly CACHE_TTL = 3600; // 1 hour in seconds

  constructor(
    private fileRepository: FileRepository,
    private accountRepository: AccountRepository,
    private cacheService: CacheService,
    private providerFactory: ProviderFactory
  ) {}

  async generateStreamingLink(fileId: string): Promise<{ url: string; expiresAt: Date }> {
    // Check cache first
    const cacheKey = `streaming:${fileId}`;
    const cached = await this.cacheService.get(cacheKey);

    if (cached) {
      logger.info({ fileId }, 'Streaming link retrieved from cache');
      const data = JSON.parse(cached);
      return {
        url: data.url,
        expiresAt: new Date(data.expiresAt),
      };
    }

    // Cache miss - generate new link
    logger.info({ fileId }, 'Cache miss, generating new streaming link');

    const file = await this.fileRepository.findById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const account = await this.accountRepository.findById(file.accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    // Generate streaming link from provider
    const provider = this.providerFactory.getProvider(file.providerType);
    const streamingLink = await provider.generateStreamingLink(account, file.providerFileId);

    // Store in cache
    const cacheData = {
      url: streamingLink.url,
      expiresAt: streamingLink.expiresAt.toISOString(),
    };

    await this.cacheService.set(cacheKey, JSON.stringify(cacheData), this.CACHE_TTL);

    logger.info({ fileId, expiresAt: streamingLink.expiresAt }, 'Streaming link generated and cached');

    return {
      url: streamingLink.url,
      expiresAt: streamingLink.expiresAt,
    };
  }
}
