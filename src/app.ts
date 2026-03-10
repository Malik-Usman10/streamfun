// Application setup and dependency injection
import express from 'express';
import { errorHandler } from './middleware/error-handler.js';
import { createAccountRoutes } from './routes/account.routes.js';
import { createFileRoutes } from './routes/file.routes.js';
import { createChunkedUploadRoutes } from './routes/chunked-upload.routes.js';
import { createDashboardRoutes } from './routes/dashboard.routes.js';
import { createRcloneRoutes } from './routes/rclone.routes.js';

// Repositories
import { AccountRepository } from './repositories/account.repository.js';
import { FileRepository } from './repositories/file.repository.js';
import { ChunkRepository } from './repositories/chunk.repository.js';

// Services
import { EncryptionService } from './services/encryption.service.js';
import { FileEncryptionService } from './services/file-encryption.service.js';
import { TokenManager } from './services/token-manager.service.js';
import { BandwidthTracker } from './services/bandwidth-tracker.service.js';
import { AccountRotator } from './services/account-rotator.service.js';
import { AccountSelector } from './services/account-selector.service.js';
import { CacheService } from './services/cache.service.js';
import { AccountService } from './services/account.service.js';
import { FileService } from './services/file.service.js';
import { ChunkManager } from './services/chunk-manager.service.js';
import { StreamService } from './services/stream.service.js';

// Providers
import { ProviderFactory } from './providers/provider.factory.js';

export function createApp() {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Serve static files from public directory
  app.use(express.static('public'));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Initialize dependencies
  const accountRepository = new AccountRepository();
  const fileRepository = new FileRepository();
  const chunkRepository = new ChunkRepository();
  
  const encryptionService = new EncryptionService();
  const fileEncryptionService = new FileEncryptionService();
  const cacheService = new CacheService();
  const bandwidthTracker = new BandwidthTracker();
  
  const providerFactory = new ProviderFactory();
  const accountRotator = new AccountRotator(accountRepository, bandwidthTracker);
  const accountSelector = new AccountSelector(accountRepository, providerFactory);
  const tokenManager = new TokenManager(encryptionService, accountRepository);
  
  const accountService = new AccountService(
    accountRepository,
    encryptionService,
    providerFactory
  );
  
  const chunkManager = new ChunkManager(
    chunkRepository,
    accountRepository,
    fileRepository,
    accountSelector,
    providerFactory,
    fileEncryptionService
  );
  
  const fileService = new FileService(
    fileRepository,
    accountRotator,
    providerFactory,
    tokenManager,
    bandwidthTracker,
    fileEncryptionService,
    chunkManager
  );

  const streamService = new StreamService(
    fileRepository,
    accountRepository,
    cacheService,
    providerFactory
  );

  // Routes
  app.use('/api/accounts', createAccountRoutes(accountService));
  app.use('/api/files', createFileRoutes(fileService, streamService));
  app.use('/api/files/upload/chunked', createChunkedUploadRoutes(chunkManager));
  app.use('/api/dashboard', createDashboardRoutes(accountService));
  app.use('/api/rclone', createRcloneRoutes(accountService));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
