// Provider factory for creating storage provider instances
import type { IStorageProvider } from '../../../shared/types/provider.js';
import { ProviderType } from '../../../shared/types/index.js';
import { UnsupportedProviderError } from '../../../shared/utils/errors.js';
import { MockStorageProvider } from './mock/mock-storage.provider.js';
import { RcloneStorageProvider } from './rclone/rclone-storage.provider.js';

export class ProviderFactory {
  private providers: Map<ProviderType, IStorageProvider>;

  constructor() {
    this.providers = new Map();
    this.registerProviders();
  }

  private registerProviders(): void {
    this.providers.set(ProviderType.KOOFR, new RcloneStorageProvider(ProviderType.KOOFR));
    this.providers.set(ProviderType.FILEN, new RcloneStorageProvider(ProviderType.FILEN));
    this.providers.set(ProviderType.BLOMP, new RcloneStorageProvider(ProviderType.BLOMP));
    
    // Keep mock provider for testing
    this.providers.set('mock' as ProviderType, new MockStorageProvider('mock' as ProviderType));
  }

  getProvider(type: ProviderType): IStorageProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new UnsupportedProviderError(type);
    }
    return provider;
  }

  registerProvider(type: ProviderType, provider: IStorageProvider): void {
    this.providers.set(type, provider);
  }

  listProviders(): ProviderType[] {
    return Array.from(this.providers.keys());
  }
}
