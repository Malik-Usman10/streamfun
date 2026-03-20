// BullMQ-based auto-upload queue and worker
// Processes scan_jobs: reads files from disk, encrypts, chunks, and uploads to cloud storage
import { Queue, Worker, type Job } from 'bullmq';
import { createReadStream, statSync } from 'fs';
import { access, readdir } from 'fs/promises';
import { constants } from 'fs';
import { extname, join, dirname } from 'path';
import { lookup as mimeTypeLookup } from 'mime-types';
import { appConfig } from '../config/index.js';
import { ScanJobRepository } from '../repositories/scan-job.repository.js';
import { FileRepository } from '../repositories/file.repository.js';
import { ChunkManager } from './chunk-manager.service.js';
import { AccountSelector } from './account-selector.service.js';
import type { ProviderType } from '../types/index.js';
import logger from '../utils/logger.js';

const QUEUE_NAME = 'auto-upload';

export interface AutoUploadJobData {
  scanJobId: string;
  sourcePath: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  directoryName?: string;
}

const redisConnection = {
  host: appConfig.redis.host,
  port: appConfig.redis.port,
  password: appConfig.redis.password,
};

export class AutoUploadQueue {
  private queue: Queue<AutoUploadJobData>;
  private worker: Worker<AutoUploadJobData> | null = null;

  constructor(
    private scanJobRepo: ScanJobRepository,
    private fileRepo: FileRepository,
    private chunkManager: ChunkManager,
    private accountSelector: AccountSelector,
    private accountService?: any // Optional to avoid circular deps problems if any, but we'll use it if present
  ) {
    this.queue = new Queue<AutoUploadJobData>(QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: false,
      },
    });
  }

  async enqueue(data: AutoUploadJobData): Promise<void> {
    await this.queue.add(`upload-${data.scanJobId}`, data, {
      jobId: `scan-${data.scanJobId}`, // idempotent — same job won't be added twice
    });
    logger.info({ scanJobId: data.scanJobId, filename: data.filename }, 'Enqueued auto-upload job');
  }

  /** Re-enqueue jobs that were interrupted (status=uploading on startup) OR were never enqueued (status=pending) */
  async recoverInterrupted(): Promise<void> {
    const interrupted = await this.scanJobRepo.findByStatus('uploading');
    const pending = await this.scanJobRepo.findByStatus('pending');
    
    const jobsToRecover = [...interrupted, ...pending];
    if (jobsToRecover.length === 0) return;

    logger.info({ count: jobsToRecover.length, uploading: interrupted.length, pending: pending.length }, 'Recovering auto-upload jobs');

    for (const job of jobsToRecover) {
      if (job.status === 'uploading') {
        // Reset to pending so worker picks them up fresh
        await this.scanJobRepo.resetForRetry(job.id);
      }
      
      await this.enqueue({
        scanJobId: job.id,
        sourcePath: job.sourcePath,
        filename: job.filename,
        fileSize: job.fileSize,
        mimeType: job.mimeType ?? 'application/octet-stream',
        directoryName: job.directoryName ?? undefined,
      });
    }
  }

  startWorker(): void {
    this.worker = new Worker<AutoUploadJobData>(
      QUEUE_NAME,
      async (job: Job<AutoUploadJobData>) => {
        logger.info({ jobId: job.id, scanJobId: job.data.scanJobId, filename: job.data.filename }, 'AUTO-UPLOAD: Worker picking up job from queue');
        try {
          await this.processJob(job);
        } catch (err: any) {
          logger.error({ jobId: job.id, scanJobId: job.data.scanJobId, error: err.message }, 'AUTO-UPLOAD: Worker job processing crashed');
          throw err;
        }
      },
      {
        connection: redisConnection,
        concurrency: appConfig.workers.enabled ? 2 : 1, // Ensure at least 1 worker if started
      }
    );

    this.worker.on('completed', (job) => {
      logger.info({ jobId: job.id, scanJobId: job.data.scanJobId, filename: job.data.filename }, 'Auto-upload job completed successfully');
    });

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, scanJobId: job?.data.scanJobId, filename: job?.data.filename, err: err.message }, 'Auto-upload job failed');
    });

    logger.info('Auto-upload worker started');
  }

  private async processJob(job: Job<AutoUploadJobData>): Promise<void> {
    const { scanJobId, sourcePath, filename, fileSize, mimeType, directoryName } = job.data;
    logger.info({ scanJobId, filename, fileSize }, 'Processing auto-upload job');

    const fullJob = await this.scanJobRepo.findById(scanJobId);
    if (!fullJob) {
      logger.error({ scanJobId }, 'Scan job not found in DB');
      return;
    }

    // Check if file already exists in library (final check before starting)
    const exists = await this.fileRepo.existsByNameAndSize(filename, fileSize);
    if (exists && fullJob.status !== 'uploading' && fullJob.status !== 'pending') {
      logger.info({ filename, fileSize }, 'File already exists in library, skipping auto-upload');
      await this.scanJobRepo.updateStatus(scanJobId, 'skipped');
      return;
    }

    // Verify file still exists on disk
    try {
      await access(sourcePath, constants.R_OK);
    } catch {
      logger.warn({ scanJobId, sourcePath }, 'Source file no longer accessible, skipping');
      await this.scanJobRepo.updateStatus(scanJobId, 'skipped');
      return;
    }

    // Higher-level try-catch for the entire upload process to handle unexpected crashes
    try {
      // Get valid accounts sorted by space
      const selectionResult = await this.accountSelector.selectBestAccountAcrossProviders(fileSize);
      
      let selectedAccountId: string = selectionResult.accountId;
      let providerType: ProviderType = selectionResult.account.providerType;
      
      const maxRetries = 2; // Try up to 3 accounts total
      let currentTry = 0;
      let uploadSuccess = false;
      let lastError: any = null;

      // Fetch a list of potential accounts to try if the first one fails
      const allAccounts = await this.accountRepositoryFindAllActive();
      const candidateAccounts = allAccounts
        .filter(a => (Number(a.quota_available || a.quotaAvailable || 0) >= fileSize))
        .sort((a, b) => Number(b.quota_available || b.quotaAvailable || 0) - Number(a.quota_available || a.quotaAvailable || 0))
        .slice(0, 3); // Top 3 candidates

      for (const account of candidateAccounts) {
        selectedAccountId = account.id;
        providerType = account.providerType || account.provider_type;
        
        logger.info({ scanJobId, filename, providerType, selectedAccountId, attempt: currentTry + 1 }, 'AUTO-UPLOAD: Attempting upload with account');
        
        try {
          // Update status to show we are actively working with this specific account
          const chunkSize = appConfig.upload.chunkSize;
          const totalChunks = Math.ceil(fileSize / chunkSize);

          let fileId = fullJob.fileId;
          const startChunkIndex = fullJob.lastChunkIndex || 0;

          if (fileId && startChunkIndex > 0) {
            logger.info({ scanJobId, fileId, startChunkIndex }, 'AUTO-UPLOAD: Resuming existing chunked upload');
            await this.chunkManager.resumeChunkedUpload({ fileId, chunkSize, totalChunks });
            await this.scanJobRepo.markUploading(scanJobId, providerType, selectedAccountId);
          } else {
            // New upload logic
            await this.scanJobRepo.markUploading(scanJobId, providerType, selectedAccountId);
            await this.scanJobRepo.updateProgress(scanJobId, 0, 'pending');

            // Determine collection name for videos: only if multiple videos in directory
            const isImage = mimeType.startsWith('image/');
            let collectionName = undefined;

            if (isImage) {
              collectionName = directoryName ?? filename.replace(/\.[^/.]+$/, '');
            } else if (mimeType.startsWith('video/') && directoryName) {
              // Count video files in the same directory
              try {
                const parentPath = dirname(sourcePath);
                const entries = await readdir(parentPath, { withFileTypes: true });
                const videoExts = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mpeg', '.mpg', '.3gp']);
                
                const videoCount = entries.filter(entry => 
                  entry.isFile() && videoExts.has(extname(entry.name).toLowerCase())
                ).length;

                if (videoCount > 1) {
                  collectionName = directoryName;
                }
              } catch (err) {
                logger.warn({ err, sourcePath }, 'Failed to count videos in directory for auto-categorization');
              }
            }

            fileId = await this.chunkManager.initializeChunkedUpload({
              filename,
              size: fileSize,
              chunkSize,
              totalChunks,
              providerType,
              mimeType,
              encrypt: true,
              collectionName,
              accountId: selectedAccountId,
            });
            await this.scanJobRepo.updateFileId(scanJobId, fileId);
          }

          if (!fileId) throw new Error("FileId not returned from initialization");

          logger.info({ scanJobId, fileId, filename, totalChunks, startChunkIndex }, 'AUTO-UPLOAD: Starting data transfer to provider');

          // Upload chunks
          for (let chunkIndex = startChunkIndex; chunkIndex < totalChunks; chunkIndex++) {
            const chunkStart = chunkIndex * chunkSize;
            const actualChunkSize = Math.min(chunkSize, fileSize - chunkStart);

            const chunkBuffer = await this.readFileChunk(sourcePath, chunkStart, actualChunkSize);
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(chunkBuffer);
                controller.close();
              },
            });

            await this.chunkManager.uploadChunkData(fileId, chunkIndex, stream, actualChunkSize);

            const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
            await this.scanJobRepo.updateChunkProgress(scanJobId, progress, chunkIndex + 1);
            await job.updateProgress(progress);
          }

          // Finalize
          await this.chunkManager.finalizeChunkedUpload(fileId);

          // Mark scan job complete
          await this.scanJobRepo.markCompleted(scanJobId, fileId);
          logger.info({ scanJobId, filename, fileId }, 'AUTO-UPLOAD: Upload successful');
          
          // Refresh quota
          if (this.accountService) {
            this.accountService.refreshAccountQuota(selectedAccountId).catch(() => {});
          }

          uploadSuccess = true;
          break; // Exit the account loop
        } catch (err: any) {
          logger.warn({ scanJobId, filename, providerType, error: err.message }, 'AUTO-UPLOAD: Upload attempt failed, trying next account if available');
          lastError = err;
          currentTry++;
          // continue to next account
        }
      }

      if (!uploadSuccess) {
        const msg = lastError?.message ?? 'All available cloud accounts failed during upload';
        logger.error({ scanJobId, filename, error: msg }, 'AUTO-UPLOAD: All upload attempts failed');
        await this.scanJobRepo.markFailed(scanJobId, msg);
        throw lastError || new Error(msg);
      }

    } catch (err: any) {
      // This catch handles selection failures or other logic errors
      if (!job.failedReason) {
         const msg = err?.message ?? 'An unexpected error occurred during auto-upload';
         await this.scanJobRepo.markFailed(scanJobId, msg);
      }
      throw err;
    }
  }

  /** Gets all active accounts directly from Repo/DB Helper */
  private async accountRepositoryFindAllActive(): Promise<any[]> {
    // This is a helper since we don't have accountRepo directly here
    // But we have accountSelector which can get them
    try {
      const accounts = await (this.accountSelector as any).accountRepository.findAll();
      return accounts.filter((a: any) => a.status === 'active');
    } catch (err) {
      logger.error({ error: err }, 'Failed to fetch active accounts in worker');
      return [];
    }
  }

  /** Read a specific byte range from a file on disk into a Buffer */
  private readFileChunk(filePath: string, start: number, length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = createReadStream(filePath, { start, end: start + length - 1 });
      stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /**
   * Pick the cloud account/provider with the most available space.
   * Tries all providers registered in the DB, falls back across them.
   */
  private async pickBestAccount(fileSize: number): Promise<{ accountId: string; provider: ProviderType }> {
    try {
      const selected = await this.accountSelector.selectBestAccountAcrossProviders(fileSize);
      return { 
        accountId: selected.accountId, 
        provider: selected.account.providerType 
      };
    } catch (err: any) {
      logger.error({ err: err.message, fileSize }, 'Account selection failed for auto-upload');
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.worker) await this.worker.close();
    await this.queue.close();
  }
}
