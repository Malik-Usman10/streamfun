// Application setup and dependency injection
import express from 'express';
import { errorHandler } from './shared/middleware/error-handler.js';
import { createAccountRoutes } from './features/accounts/routes/account.routes.js';
import { createFileRoutes } from './features/files/routes/file.routes.js';
import { createChunkedUploadRoutes } from './features/files/routes/chunked-upload.routes.js';
import { createDashboardRoutes } from './features/dashboard/routes/dashboard.routes.js';
import { createRcloneRoutes } from './features/storage/routes/rclone.routes.js';
import { createScanJobRoutes } from './features/upload/routes/scan-jobs.routes.js';
import { createAuthRoutes } from './features/auth/routes/auth.routes.js';
import { createBackupRoutes } from './features/backup/routes/backup.routes.js';
import { requireAuth } from './features/auth/middleware/auth.middleware.js';
import cookieParser from 'cookie-parser';

// Repositories
import { AccountRepository } from './features/accounts/repositories/account.repository.js';
import { FileRepository } from './features/files/repositories/file.repository.js';
import { ChunkRepository } from './features/files/repositories/chunk.repository.js';
import { ScanJobRepository } from './features/upload/repositories/scan-job.repository.js';
import { SettingsRepository } from './features/backup/repositories/settings.repository.js';

// Services
import { EncryptionService } from './shared/services/encryption.service.js';
import { FileEncryptionService } from './shared/services/file-encryption.service.js';
import { TokenManager } from './features/accounts/services/token-manager.service.js';
import { BandwidthTracker } from './features/accounts/services/bandwidth-tracker.service.js';
import { AccountRotator } from './features/accounts/services/account-rotator.service.js';
import { AccountSelector } from './features/accounts/services/account-selector.service.js';
import { CacheService } from './shared/services/cache.service.js';
import { AccountService } from './features/accounts/services/account.service.js';
import { FileService } from './features/files/services/file.service.js';
import { ChunkManager } from './features/files/services/chunk-manager.service.js';
import { StreamService } from './features/files/services/stream.service.js';
import { AutoUploadQueue } from './features/upload/services/auto-upload.queue.js';
import { DirectoryScanner } from './features/upload/services/directory-scanner.service.js';
import { BackupService } from './features/backup/services/backup.service.js';
import { BackupQueue } from './features/backup/services/backup.queue.js';
import { IntegrityService } from './features/upload/services/integrity.service.js';

// Providers
import { ProviderFactory } from './features/storage/providers/provider.factory.js';

export interface AppContext {
  scanner: DirectoryScanner;
  queue: AutoUploadQueue;
  accountService: AccountService;
  backupQueue: BackupQueue;
}

// Shared context so index.ts can start the worker and scanner after the server starts
let appContext: AppContext | null = null;
export function getAppContext(): AppContext | null { return appContext; }

export function createApp() {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

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
  const settingsRepository = new SettingsRepository();

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
    accountRotator,
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

  const scanJobRepo = new ScanJobRepository();
  const integrityService = new IntegrityService(
    chunkRepository,
    fileRepository,
    scanJobRepo,
    accountRepository,
    providerFactory
  );
  
  const autoUploadQueue = new AutoUploadQueue(
    scanJobRepo, 
    fileRepository, 
    chunkManager, 
    accountSelector, 
    accountService, 
    integrityService
  );
  const directoryScanner = new DirectoryScanner(scanJobRepo, fileRepository, autoUploadQueue);

  const backupService = new BackupService(accountService, settingsRepository);
  const backupQueue = new BackupQueue(backupService, settingsRepository);

  // Store in module-level context for index.ts to start
  appContext = { 
    scanner: directoryScanner, 
    queue: autoUploadQueue, 
    accountService: accountService,
    backupQueue: backupQueue
  };

  // Auth Routes (Unprotected)
  app.use('/api/auth', createAuthRoutes());

  // Protected Routes
  app.use('/api/accounts', requireAuth, createAccountRoutes(accountService));
  app.use('/api/files', requireAuth, createFileRoutes(fileService, streamService));
  app.use('/api/files/upload/chunked', requireAuth, createChunkedUploadRoutes(chunkManager, accountService));
  app.use('/api/dashboard', requireAuth, createDashboardRoutes(accountService));
  app.use('/api/rclone', requireAuth, createRcloneRoutes(accountService));
  app.use('/api/scan-jobs', requireAuth, createScanJobRoutes(scanJobRepo, chunkRepository, directoryScanner, autoUploadQueue));
  app.use('/api/backup', requireAuth, createBackupRoutes(backupQueue, backupService, settingsRepository));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
