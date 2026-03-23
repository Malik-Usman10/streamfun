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
import { IntegrityService } from './integrity.service.js';
import type { ProviderType } from '../types/index.js';
import logger from '../utils/logger.js';

const QUEUE_NAME = 'auto-upload';
const PRIORITY_QUEUE_NAME = 'auto-upload-priority';
const INTEGRITY_QUEUE_NAME = 'auto-upload-integrity';

export interface AutoUploadJobData {
  scanJobId: string;
  sourcePath: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  directoryName?: string;
  isRecovery?: boolean;
  progress?: number;
}

export interface IntegrityJobData {
  fileId: string;
  scanJobId: string;
  filename: string;
}

const redisConnection = {
  host: appConfig.redis.host,
  port: appConfig.redis.port,
  password: appConfig.redis.password,
};

export class AutoUploadQueue {
  private queue: Queue<AutoUploadJobData>;
  private priorityQueue: Queue<AutoUploadJobData>;
  private integrityQueue: Queue<IntegrityJobData>;
  private worker: Worker<AutoUploadJobData> | null = null;
  private priorityWorker: Worker<AutoUploadJobData> | null = null;
  private integrityWorker: Worker<IntegrityJobData> | null = null;

  constructor(
    private scanJobRepo: ScanJobRepository,
    private fileRepo: FileRepository,
    private chunkManager: ChunkManager,
    private accountSelector: AccountSelector,
    private accountService?: any, // Optional to avoid circular deps problems if any, but we'll use it if present
    private integrityService?: IntegrityService // Optional for backward compatibility in tests
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

    this.priorityQueue = new Queue<AutoUploadJobData>(PRIORITY_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: false,
      },
    });

    this.integrityQueue = new Queue<IntegrityJobData>(INTEGRITY_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 10_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: false,
      },
    });
  }

  async enqueue(data: AutoUploadJobData): Promise<void> {
    const jobId = `scan-${data.scanJobId}`;
    
    // Calculate priority: 99% done = priority 1 (High), 0% done = priority 100 (Low)
    const priority = data.progress !== undefined 
      ? Math.max(1, 100 - Math.floor(data.progress))
      : 100;

    // Route high-progress (>=90%) or recovery jobs to the dedicated priority queue
    const isPriority = data.isRecovery || (data.progress !== undefined && data.progress >= 90);
    const targetQueue = isPriority ? this.priorityQueue : this.queue;

    // Also check the other queue for duplicates
    for (const q of [this.queue, this.priorityQueue]) {
      const existingJob = await q.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'completed' || state === 'failed') {
          await existingJob.remove();
        } else {
          // Job is already waiting/active/delayed — don't duplicate
          logger.info({ scanJobId: data.scanJobId, state, queue: q.name }, 'Job already in queue, skipping enqueue');
          return;
        }
      }
    }

    await targetQueue.add(`upload-${data.scanJobId}`, data, { jobId, priority });
    logger.info({ scanJobId: data.scanJobId, filename: data.filename, priority, queue: targetQueue.name }, 'Enqueued auto-upload job');
  }

  /** Enqueue a file for integrity verification in the dedicated integrity queue */
  async enqueueIntegrityCheck(data: IntegrityJobData): Promise<void> {
    const jobId = `integrity-${data.scanJobId}`;
    
    // If it's already in the integrity queue, don't duplicate
    const existing = await this.integrityQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'completed' && state !== 'failed') return;
      await existing.remove();
    }

    await this.integrityQueue.add(`verify-${data.scanJobId}`, data, { jobId, priority: 5 });
    logger.debug({ scanJobId: data.scanJobId, filename: data.filename }, 'Enqueued integrity verification job');
  }

  /** Re-enqueue jobs that were interrupted (status=uploading on startup) OR were never enqueued (status=pending) */
  async recoverInterrupted(): Promise<void> {
    // Audit recent jobs using the integrity queue instead of blocking startup
    if (this.integrityService) {
      const recentJobs = await this.scanJobRepo.findRecentlyCompleted(24);
      for (const job of recentJobs) {
        if (job.fileId) {
          await this.enqueueIntegrityCheck({
            fileId: job.fileId,
            scanJobId: job.id,
            filename: job.filename
          });
        }
      }
      logger.info({ count: recentJobs.length }, 'Enqueued recent jobs for background integrity audit');
    }

    // NOTE: drainStaleJobs() is called separately from index.ts BEFORE this method,
    // ensuring all stale Redis jobs are cleared before we re-enqueue from DB.

    const interrupted = await this.scanJobRepo.findByStatus('uploading');
    const pending = await this.scanJobRepo.findByStatus('pending');
    const skipped = await this.scanJobRepo.findByStatus('skipped');
    const stuckVerifying = await this.scanJobRepo.findByStatus('verifying');
    
    // Reset skipped jobs back to pending — they may have been incorrectly skipped
    // by a stale worker on another node or due to a transient access issue
    for (const job of skipped) {
      await this.scanJobRepo.resetForRetry(job.id);
    }

    // Jobs stuck in 'verifying' from a crash: mark them completed again so the
    // integrity queue can re-audit them cleanly
    for (const job of stuckVerifying) {
      if (job.fileId) {
        await this.scanJobRepo.markCompleted(job.id, job.fileId);
        await this.enqueueIntegrityCheck({
          fileId: job.fileId,
          scanJobId: job.id,
          filename: job.filename
        });
      }
    }

    const jobsToRecover = [...interrupted, ...pending, ...skipped];
    if (jobsToRecover.length === 0) return;

    logger.info({ count: jobsToRecover.length, uploading: interrupted.length, pending: pending.length }, 'Recovering auto-upload jobs');

    for (const job of jobsToRecover) {
      if (job.status === 'uploading') {
        // Reset to pending so worker picks them up fresh
        await this.scanJobRepo.resetForRetry(job.id);
      }
      
      // Only mark as recovery if the job actually has progress (was genuinely
      // interrupted mid-upload). Fresh pending/skipped 0% jobs go to the regular
      // queue so they don't flood the priority queue and block real repairs.
      const hasProgress = (job.progress ?? 0) > 0;

      await this.enqueue({
        scanJobId: job.id,
        sourcePath: job.sourcePath,
        filename: job.filename,
        fileSize: job.fileSize,
        mimeType: job.mimeType ?? 'application/octet-stream',
        directoryName: job.directoryName ?? undefined,
        isRecovery: hasProgress,
        progress: job.progress
      });
    }
  }

  /** Remove all non-active BullMQ jobs from ALL queues so we can re-enqueue with correct routing */
  async drainStaleJobs(): Promise<void> {
    try {
      const states: Array<'waiting' | 'completed' | 'failed' | 'delayed'> = ['waiting', 'completed', 'failed', 'delayed'];
      let removed = 0;

      // Drain all three queues
      for (const q of [this.queue, this.priorityQueue, this.integrityQueue]) {
        for (const state of states) {
          const jobs = await q.getJobs([state]);
          for (const job of jobs) {
            try { await job.remove(); removed++; } catch { /* job may have been picked up */ }
          }
        }
      }

      if (removed > 0) {
        logger.info({ removed }, 'Drained stale BullMQ jobs from all queues on startup');
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to drain stale BullMQ jobs (non-fatal)');
    }
  }

  startWorker(): void {
    // 1. Primary Upload Worker
    this.worker = new Worker<AutoUploadJobData>(
      QUEUE_NAME,
      async (job: Job<AutoUploadJobData>) => {
        logger.info({ jobId: job.id, scanJobId: job.data.scanJobId, filename: job.data.filename }, 'AUTO-UPLOAD: Worker picking up job');
        try {
          await this.processJob(job);
        } catch (err: any) {
          logger.error({ jobId: job.id, scanJobId: job.data.scanJobId, error: err.message }, 'AUTO-UPLOAD: Worker processing crashed');
          throw err;
        }
      },
      {
        connection: redisConnection,
        concurrency: appConfig.upload.uploadConcurrency,
      }
    );

    // 2. Integrity Audit Worker (Separate resource pool)
    // 3. Priority Upload Worker (dedicated lane for repairs / near-complete files)
    this.priorityWorker = new Worker<AutoUploadJobData>(
      PRIORITY_QUEUE_NAME,
      async (job: Job<AutoUploadJobData>) => {
        logger.info({ jobId: job.id, scanJobId: job.data.scanJobId, filename: job.data.filename }, 'PRIORITY-UPLOAD: Worker picking up job');
        try {
          await this.processJob(job);
        } catch (err: any) {
          logger.error({ jobId: job.id, scanJobId: job.data.scanJobId, error: err.message }, 'PRIORITY-UPLOAD: Worker processing crashed');
          throw err;
        }
      },
      {
        connection: redisConnection,
        concurrency: appConfig.upload.priorityConcurrency,
      }
    );

    // 4. Integrity Audit Worker (Separate resource pool)
    this.integrityWorker = new Worker<IntegrityJobData>(
      INTEGRITY_QUEUE_NAME,
      async (job: Job<IntegrityJobData>) => {
        if (!this.integrityService) return;
        const { fileId, scanJobId, filename } = job.data;
        
        try {
          // Update status to 'verifying' so UI knows it's audited
          await this.scanJobRepo.updateStatus(scanJobId, 'verifying');
          
          const result = await this.integrityService.checkFileIntegrity(fileId, true);
          if (!result.valid) {
            let errorMessage = `INTEGRITY_FAILURE: ${result.reason}`;
            if (result.failedChunkIndex !== undefined) {
              errorMessage += ` [chunk:${result.failedChunkIndex}]`;
            }
            logger.warn({ scanJobId, filename, reason: result.reason, failedChunkIndex: result.failedChunkIndex }, 'Integrity audit found corruption');
            
            await this.scanJobRepo.markFailed(scanJobId, errorMessage);
            await this.fileRepo.update(fileId, {
              metadata: {
                corrupted: true,
                corruptionReason: result.reason,
                corruptedAt: new Date().toISOString()
              }
            }).catch(() => {});
          } else {
            // Re-mark as completed if it passed (re-confirms health)
            await this.scanJobRepo.markCompleted(scanJobId, fileId);
          }
        } catch (err: any) {
          logger.error({ scanJobId, err: err.message }, 'Integrity worker failed');
          throw err;
        }
      },
      {
        connection: redisConnection,
        concurrency: appConfig.upload.integrityConcurrency,
      }
    );

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, scanJobId: job?.data.scanJobId, filename: job?.data.filename, err: err.message }, 'Auto-upload job failed');
    });

    this.priorityWorker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, scanJobId: job?.data.scanJobId, filename: job?.data.filename, err: err.message }, 'Priority upload job failed');
    });

    this.integrityWorker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, scanJobId: job?.data.scanJobId, err: err.message }, 'Integrity check job failed');
    });

    logger.info({ 
      uploadConcurrency: appConfig.upload.uploadConcurrency,
      priorityConcurrency: appConfig.upload.priorityConcurrency,
      integrityConcurrency: appConfig.upload.integrityConcurrency 
    }, 'Auto-upload workers started (Transfer + Priority + Integrity)');
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
    const existingFile = await this.fileRepo.existsByNameAndSize(filename, fileSize, fullJob.directoryName ?? undefined);
    if (existingFile && fullJob.status !== 'uploading' && fullJob.status !== 'pending') {
      logger.info({ filename, fileSize, collection: fullJob.directoryName }, 'File already exists in library, skipping auto-upload');
      
      // If the scan job doesn't have a fileId yet, point it to the existing one for tracking
      if (!fullJob.fileId) {
        await this.scanJobRepo.updateFileId(scanJobId, existingFile.id);
      }
      
      await this.scanJobRepo.updateStatus(scanJobId, 'completed'); // Mark as completed instead of skipped to show in UI
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

          if (fileId) {
            // Resume — file record already exists from a previous attempt
            logger.info({ scanJobId, fileId, startChunkIndex }, 'AUTO-UPLOAD: Resuming existing chunked upload');
            await this.chunkManager.resumeChunkedUpload({ fileId, chunkSize, totalChunks });
            await this.scanJobRepo.markUploading(scanJobId, providerType, selectedAccountId);
          } else {
            // New upload logic
            await this.scanJobRepo.markUploading(scanJobId, providerType, selectedAccountId);
            await this.scanJobRepo.updateProgress(scanJobId, 0, 'uploading');

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

          // Mark scan job complete temporarily
          await this.scanJobRepo.markCompleted(scanJobId, fileId);
          logger.info({ scanJobId, filename, fileId }, 'AUTO-UPLOAD: Upload transfer successful');
          
          // Refresh quota
          if (this.accountService) {
            this.accountService.refreshAccountQuota(selectedAccountId).catch(() => {});
          }

          // INTEGRITY CHECK (Offload to dedicated integrity queue)
          if (this.integrityService) {
            await this.enqueueIntegrityCheck({ fileId, scanJobId, filename });
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
    if (this.priorityWorker) await this.priorityWorker.close();
    if (this.integrityWorker) await this.integrityWorker.close();
    await this.queue.close();
    await this.priorityQueue.close();
    await this.integrityQueue.close();
  }
}
