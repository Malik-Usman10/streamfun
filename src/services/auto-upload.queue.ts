// BullMQ-based auto-upload queue and worker
// Processes scan_jobs: reads files from disk, encrypts, chunks, and uploads to cloud storage
import { Queue, Worker, type Job } from 'bullmq';
import { createReadStream, statSync } from 'fs';
import { access } from 'fs/promises';
import { constants } from 'fs';
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
        logger.debug({ jobId: job.id, scanJobId: job.data.scanJobId }, 'Worker picking up job');
        await this.processJob(job);
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

    // Check if file already exists in library (final check before starting)
    const exists = await this.fileRepo.existsByNameAndSize(filename, fileSize);
    if (exists) {
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

    // Pick the best cloud account by quota — try all providers, pick first that has space
    let providerType: ProviderType;
    let selectedAccountId: string;

    try {
      const { accountId, provider } = await this.pickBestAccount(fileSize);
      providerType = provider;
      selectedAccountId = accountId;
    } catch (err: any) {
      const msg = err?.message ?? 'No cloud account with sufficient space';
      await this.scanJobRepo.markFailed(scanJobId, msg);
      throw err;
    }

    await this.scanJobRepo.markUploading(scanJobId, providerType, selectedAccountId);

    const chunkSize = appConfig.upload.chunkSize; // 10 MB default
    const totalChunks = Math.ceil(fileSize / chunkSize);

    // Determine collection name for images (directory name), or video name
    const isImage = mimeType.startsWith('image/');
    const collectionName = isImage
      ? (directoryName ?? filename.replace(/\.[^/.]+$/, ''))
      : undefined; // videos don't use collectionName; directory name stored separately

    // Initialize chunked upload (creates DB record, generates encryption keys)
    const fileId = await this.chunkManager.initializeChunkedUpload({
      filename,
      size: fileSize,
      chunkSize,
      totalChunks,
      providerType,
      mimeType,
      encrypt: true,
      collectionName,
    });

    logger.info({ scanJobId, fileId, filename, totalChunks }, 'Starting chunked upload from disk');

    // Upload chunks sequentially from disk file (streaming)
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
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
      await this.scanJobRepo.updateProgress(scanJobId, progress);
      await job.updateProgress(progress);
    }

    // Finalize: generate thumbnail, complete DB record
    await this.chunkManager.finalizeChunkedUpload(fileId);

    // Mark scan job complete with the linked file ID
    await this.scanJobRepo.markCompleted(scanJobId, fileId);
    logger.info({ scanJobId, filename: job.data.filename }, 'Auto-upload job completed successfully');

    // Refresh account quota after successful upload
    if (this.accountService && selectedAccountId) {
      this.accountService.refreshAccountQuota(selectedAccountId).catch((err: any) => {
        logger.warn({ err: err.message, accountId: selectedAccountId }, 'Failed to refresh quota after upload');
      });
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
