import { ChunkRepository } from '../repositories/chunk.repository.js';
import { FileRepository } from '../repositories/file.repository.js';
import { ScanJobRepository } from '../repositories/scan-job.repository.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import logger from '../utils/logger.js';
import { appConfig } from '../config/index.js';

export interface IntegrityResult {
  valid: boolean;
  reason?: string;
  details?: any;
  failedChunkIndex?: number;
}

export class IntegrityService {
  private CHUNK_SIZE = appConfig.upload.chunkSize;
  private AUTH_TAG_SIZE = 16;

  constructor(
    private chunkRepo: ChunkRepository,
    private fileRepo: FileRepository,
    private scanJobRepo: ScanJobRepository,
    private accountRepo: AccountRepository,
    private providerFactory: ProviderFactory
  ) {}

  /**
   * Performs a deep check of a file's integrity
   * 1. DB: Check if all expected chunks are present
   * 2. DB: Check if total stored size is correct (size + tags)
   * 3. Cloud: Probe chunk_0 to ensure it's not empty/missing
   */
  async checkFileIntegrity(fileId: string, probeCloud: boolean = true): Promise<IntegrityResult> {
    try {
      const file = await this.chunkRepo.getChunkedFile(fileId);
      if (!file) {
        return { valid: false, reason: 'File record not found or not chunked' };
      }

      const fileSize = Number(file.size);
      const chunkSize = Number(file.chunkSize);
      const expectedChunks = Math.ceil(fileSize / chunkSize);
      const actualChunks = file.chunks.length;

      // 1. Check chunk count
      if (actualChunks !== expectedChunks) {
        return { 
          valid: false, 
          reason: `Missing chunks: found ${actualChunks}, expected ${expectedChunks}`,
          details: { actualChunks, expectedChunks }
        };
      }

      // 2. Check total stored size in DB
      // Expected stored size = fileSize + (num_chunks * auth_tag_size)
      const expectedStoredSize = fileSize + (actualChunks * this.AUTH_TAG_SIZE);
      const actualStoredSize = file.chunks.reduce((sum, c) => sum + Number(c.chunkSize), 0);

      if (Math.abs(actualStoredSize - expectedStoredSize) > 1024) { // 1KB tolerance
        return {
          valid: false,
          reason: `Stored size mismatch: found ${actualStoredSize}, expected ${expectedStoredSize}`,
          details: { actualStoredSize, expectedStoredSize }
        };
      }

      // 3. Proactive Cloud Probe (Check chunk_0 existence and size)
      //    Uses retry-with-backoff to handle eventual consistency on providers like Blomp.
      if (probeCloud && file.chunks.length > 0) {
        const chunk0 = file.chunks[0];
        const provider = this.providerFactory.getProvider(chunk0.providerType);
        const account = await this.accountRepo.findById(chunk0.accountId);
        
        if (!account) {
          return { valid: false, reason: `Account ${chunk0.accountId} not found for cloud probe` };
        }

        const PROBE_RETRIES = 3;
        const PROBE_DELAYS = [5000, 15000, 30000]; // 5s, 15s, 30s
        let lastProbeError: string | null = null;

        for (let attempt = 0; attempt < PROBE_RETRIES; attempt++) {
          try {
            logger.debug({ fileId, providerFileId: chunk0.providerFileId, attempt: attempt + 1 }, 'Cloud probe attempt');
            const metadata = await provider.getFileMetadata(account, chunk0.providerFileId);
            
            if (metadata.size === 0) {
              return { valid: false, reason: 'Cloud probe failed: Chunk 0 is 0 bytes on provider', failedChunkIndex: 0 };
            }
            
            if (Number(metadata.size) !== Number(chunk0.chunkSize)) {
              return { 
                valid: false, 
                reason: `Cloud probe failed: Chunk 0 size mismatch (${metadata.size} vs ${chunk0.chunkSize})`,
                failedChunkIndex: 0
              };
            }
            
            logger.debug({ fileId, filename: file.filename }, 'Integrity cloud probe successful');
            lastProbeError = null;
            break; // Success — exit the retry loop
          } catch (err: any) {
            lastProbeError = err.message;
            logger.warn({ err: err.message, fileId, attempt: attempt + 1, maxRetries: PROBE_RETRIES }, 'Cloud probe attempt failed');
            
            if (attempt < PROBE_RETRIES - 1) {
              const delay = PROBE_DELAYS[attempt];
              logger.info({ fileId, delayMs: delay }, 'Waiting before next cloud probe retry (eventual consistency)');
              await new Promise(r => setTimeout(r, delay));
            }
          }
        }

        if (lastProbeError) {
          logger.error({ fileId, err: lastProbeError }, 'Cloud probe failed after all retries');
          return { valid: false, reason: `Cloud probe failed: ${lastProbeError}` };
        }
      }

      return { valid: true };
    } catch (err: any) {
      logger.error({ err: err.message, fileId }, 'Integrity check crashed');
      return { valid: false, reason: `Integrity check error: ${err.message}` };
    }
  }

  /**
   * Scans recently completed jobs and verifies their integrity.
   * Marks them as 'failed' if they are corrupted.
   */
  async auditRecentJobs(hours: number = 24): Promise<number> {
    logger.info({ hours }, 'Starting integrity audit for recent uploads');
    const recentJobs = await this.scanJobRepo.findRecentlyCompleted(hours);
    let corruptedCount = 0;

    for (const job of recentJobs) {
      if (!job.fileId) continue;

      const result = await this.checkFileIntegrity(job.fileId, true);
      if (!result.valid) {
        corruptedCount++;
        let errorMessage = `INTEGRITY_FAILURE: ${result.reason}`;
        
        if (result.failedChunkIndex !== undefined) {
          errorMessage += ` [chunk:${result.failedChunkIndex}]`;
        }
        logger.warn({ job: job.id, filename: job.filename, reason: result.reason }, 'Audit found corrupted file');
        
        // Mark as failed in dashboard
        await this.scanJobRepo.markFailed(job.id, errorMessage);
        
        // Also mark file as corrupted in its own metadata for future reference
        await this.fileRepo.update(job.fileId, {
          metadata: {
            corrupted: true,
            corruptionReason: result.reason,
            corruptedAt: new Date().toISOString()
          }
        }).catch(() => {});
      }
    }

    logger.info({ totalChecked: recentJobs.length, corruptedCount }, 'Integrity audit completed');
    return corruptedCount;
  }
}
