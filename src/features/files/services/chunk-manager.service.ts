// Chunk manager for handling large file uploads/downloads
import { ChunkRepository, type ChunkedFileRecord } from '../repositories/chunk.repository.js';
import { AccountRepository } from '../../accounts/repositories/account.repository.js';
import { FileRepository } from '../repositories/file.repository.js';
import { AccountSelector } from '../../accounts/services/account-selector.service.js';
import { AccountRotator } from '../../accounts/services/account-rotator.service.js';
import { ProviderFactory } from '../../storage/providers/provider.factory.js';
import { ThumbnailService } from './thumbnail.service.js';
import { CacheService } from '../../../shared/services/cache.service.js';
import { ConcurrencyLimiter } from '../../../shared/utils/concurrency-limiter.js';
import { detectCategory, generateDefaultCollectionName, generateStoragePath } from '../../../shared/utils/storage-path.js';
import type { ChunkMetadata, ProviderType } from '../../../shared/types/index.js';
import type { FileUpload } from '../../../shared/types/provider.js';
import { v4 as uuidv4 } from 'uuid';
import { appConfig } from '../../../config/index.js';
import { ChunkUploadError } from '../../../shared/utils/errors.js';
import logger from '../../../shared/utils/logger.js';

export interface UploadProgress {
  fileId: string;
  totalChunks: number;
  uploadedChunks: number;
  percentage: number;
  isComplete: boolean;
  missingChunks?: number[];
}

interface UploadMetadata {
  filename: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  providerType: ProviderType;
  mimeType?: string;
  uploadedChunks: number[];
  category?: string;
  collectionName?: string;
  accountId: string; // Store the selected account ID
}

export class ChunkManager {
  private defaultChunkSize = appConfig.upload.chunkSize;
  private uploadMetadata: Map<string, UploadMetadata> = new Map();
  private uploadLimiter: ConcurrencyLimiter;
  private downloadLimiter: ConcurrencyLimiter;
  private thumbnailService: ThumbnailService;
  private cacheService: CacheService;
  private chunkCacheTTL = 3600; // 1 hour cache for chunks

  constructor(
    private chunkRepository: ChunkRepository,
    private accountRepository: AccountRepository,
    private fileRepository: FileRepository,
    private accountSelector: AccountSelector,
    private accountRotator: AccountRotator,
    private providerFactory: ProviderFactory
  ) {
    this.uploadLimiter = new ConcurrencyLimiter(appConfig.upload.maxParallelChunks);
    this.downloadLimiter = new ConcurrencyLimiter(appConfig.upload.maxParallelDownloads);
    this.thumbnailService = new ThumbnailService();
    this.cacheService = new CacheService();
  }

  async uploadFileInChunks(
    file: FileUpload,
    providerType: ProviderType,
    chunkSize: number = this.defaultChunkSize
  ): Promise<string> {
    const fileId = uuidv4();
    const totalChunks = Math.ceil(file.size / chunkSize);

    logger.info({ fileId, totalChunks, size: file.size }, 'Starting chunked upload');

    const chunks: Omit<ChunkMetadata, 'id'>[] = [];

    // Upload chunks with limited concurrency
    const concurrency = appConfig.upload.maxParallelChunks;

    for (let i = 0; i < totalChunks; i += concurrency) {
      const chunkPromises = [];

      for (let j = 0; j < concurrency && i + j < totalChunks; j++) {
        const chunkIndex = i + j;
        chunkPromises.push(
          this.uploadChunk(file, fileId, chunkIndex, chunkSize, providerType)
        );
      }

      const chunkResults = await Promise.allSettled(chunkPromises);

      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          chunks.push(result.value);
        } else {
          logger.error({ error: result.reason }, 'Chunk upload failed');
          throw new ChunkUploadError('Failed to upload chunk', result.reason.chunkIndex);
        }
      }
    }

    // Store file record with chunk references
    await this.chunkRepository.createChunkedFile({
      fileId,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      totalChunks,
      chunkSize,
      chunks,
    });

    logger.info({ fileId }, 'Chunked upload completed');

    return fileId;
  }

  private async uploadChunk(
    file: FileUpload,
    fileId: string,
    chunkIndex: number,
    chunkSize: number,
    providerType: ProviderType
  ): Promise<Omit<ChunkMetadata, 'id'>> {
    // Select account for this chunk
    const account = await this.accountRotator.selectAccountForUpload(providerType, chunkSize);

    // Extract chunk from file stream
    const chunkStart = chunkIndex * chunkSize;
    const chunkEnd = Math.min(chunkStart + chunkSize, file.size);
    const actualChunkSize = chunkEnd - chunkStart;

    // For now, we'll use a simplified approach
    // In production, you'd want to properly handle stream slicing
    const chunkData = Buffer.alloc(actualChunkSize);

    // Upload to provider
    const provider = this.providerFactory.getProvider(providerType);

    const chunkStream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunkData);
        controller.close();
      },
    });

    const result = await provider.uploadFile(account, {
      filename: `${fileId}_chunk_${chunkIndex}`,
      mimeType: 'application/octet-stream',
      size: chunkData.length,
      stream: chunkStream,
    }, undefined); // Note: internal background upload currently doesn't use a signal

    logger.info({ fileId, chunkIndex }, 'Chunk uploaded successfully');

    return {
      fileId,
      chunkIndex,
      chunkSize: actualChunkSize,
      accountId: account.id,
      providerType,
      providerFileId: result.providerFileId,
      uploadedAt: new Date(),
    };
  }

  async downloadFileInChunks(
    fileId: string,
    rangeStart?: number,
    rangeEnd?: number
  ): Promise<ReadableStream> {
    const fileRecord = await this.chunkRepository.getChunkedFile(fileId);

    if (!fileRecord) {
      throw new Error(`Chunked file not found: ${fileId}`);
    }

    if (fileRecord.chunks.length === 0) {
      throw new Error(`File still uploading or initialization incomplete: ${fileId}`);
    }

    const startChunk = rangeStart ? Math.floor(rangeStart / fileRecord.chunkSize) : 0;
    const maxChunks = fileRecord.chunks.length;
    const endChunk = rangeEnd 
      ? Math.min(Math.floor(rangeEnd / fileRecord.chunkSize), maxChunks - 1) 
      : maxChunks - 1;

    logger.debug({ fileId, startChunk, endChunk, rangeStart, rangeEnd }, 'Downloading chunk range');

    const abortController = new AbortController();
    const signal = abortController.signal;

    return this.createChunkStream(fileRecord, startChunk, endChunk, abortController, rangeStart, rangeEnd);
  }

  private createChunkStream(
    fileRecord: ChunkedFileRecord,
    startChunk: number,
    endChunk: number,
    abortController: AbortController,
    rangeStart?: number,
    rangeEnd?: number
  ): ReadableStream {
    const signal = abortController.signal;
    let currentChunk = startChunk;
    const PREFETCH_COUNT = appConfig.upload.prefetchCount; // Configurable, default 3

    // Helper: download and decrypt a single chunk (streamed and cached on-the-fly)
    const fetchChunkStream = async (chunkIndex: number): Promise<ReadableStream> => {
      if (signal.aborted) throw new Error('Stream aborted');
      const cacheKey = `chunk:stream:${fileRecord.fileId}:${chunkIndex}`;

      // Try Redis Stream Cache first
      const cachedStream = await this.cacheService.getStream(cacheKey);
      if (cachedStream) {
        logger.debug({ fileId: fileRecord.fileId, chunkIndex }, 'Chunk stream served from Redis cache');
        return cachedStream;
      }

      // Cache miss — download from cloud
      logger.debug({ fileId: fileRecord.fileId, chunkIndex }, 'Chunk stream cache miss, downloading from cloud');

      const chunk = fileRecord.chunks[chunkIndex];
      const provider = this.providerFactory.getProvider(chunk.providerType);
      const account = await this.accountRepository.findById(chunk.accountId);

      if (!account) {
        throw new Error(`Account not found: ${chunk.accountId}`);
      }

      // Use download-specific concurrency limiter to avoid starving uploads
      const getChunkStream = async () => {
        return await this.downloadLimiter.run(async () => {
          if (signal.aborted) throw new Error('Stream aborted');
          return await provider.downloadFile(account, chunk.providerFileId, signal);
        });
      };

      const chunkStream = await getChunkStream();
      if (signal.aborted) {
        chunkStream.cancel().catch(() => {});
        throw new Error('Stream aborted');
      }

      // Wrap it in cache proxy so it gets saved to Redis memory automatically as it flows
      return this.cacheService.cacheStream(cacheKey, chunkStream, this.chunkCacheTTL);
    };

    const prefetchPromises: Map<number, Promise<ReadableStream>> = new Map();

    // Start prefetching: kick off downloads for the first few chunks immediately
    const startPrefetch = (fromIndex: number) => {
      for (let i = fromIndex; i <= Math.min(fromIndex + PREFETCH_COUNT - 1, endChunk); i++) {
        if (!prefetchPromises.has(i)) {
          prefetchPromises.set(i, fetchChunkStream(i));
        }
      }
    };

    // Kick off initial prefetch
    startPrefetch(startChunk);
    
    let currentReader: any = null;
    let absolutePos = startChunk * fileRecord.chunkSize;

    return new ReadableStream({
      pull: async (controller) => {
        try {
          while (true) {
            // If stream was canceled while we waited, bail out
            if (signal.aborted) {
              try { controller.close(); } catch {}
              return;
            }

            // Check if we are done with all chunks
            if (currentChunk > endChunk && !currentReader) {
              try { controller.close(); } catch {}
              return;
            }

            // Need to open the next chunk stream
            if (!currentReader) {
              let chunkPromise = prefetchPromises.get(currentChunk);
              if (!chunkPromise) {
                chunkPromise = fetchChunkStream(currentChunk);
              }

              const chunkStream = await chunkPromise;

              // Re-check abort after await — cancel() may have fired
              if (signal.aborted) {
                chunkStream?.cancel().catch(() => {});
                try { controller.close(); } catch {}
                return;
              }

              prefetchPromises.delete(currentChunk);
              currentReader = chunkStream?.getReader() || null;
              
              if (!currentReader) {
                 throw new Error(`Failed to get reader for chunk ${currentChunk}`);
              }
              
              // Trigger prefetch for upcoming chunks now that we advanced a chunk
              startPrefetch(currentChunk + 1);
              absolutePos = currentChunk * fileRecord.chunkSize;
            }

            // Read from current chunk
            const { done, value } = await currentReader.read();

            // Re-check abort after await — cancel() may have nulled currentReader
            if (signal.aborted) {
              // currentReader may have been nulled by cancel(), safe-guard
              if (currentReader) {
                try { currentReader.releaseLock(); } catch {}
                currentReader = null;
              }
              try { controller.close(); } catch {}
              return;
            }

            if (done) {
              // Current chunk finished, move to next
              logger.debug({ fileId: fileRecord.fileId, currentChunk, nextChunk: currentChunk + 1 }, 'Chunk finished, advancing reader');
              if (currentReader) {
                try { currentReader.releaseLock(); } catch {}
              }
              currentReader = null;
              currentChunk++;
              // Loop continues to open next chunk
            } else {
              // Yield data with range-based slicing
              const chunkStartPos = absolutePos;
              const chunkEndPos = absolutePos + value.length;
              absolutePos = chunkEndPos;

              logger.trace({ 
                fileId: fileRecord.fileId, 
                currentChunk, 
                chunkStartPos, 
                chunkEndPos, 
                len: value.length 
              }, 'Processing chunk slice');

              const start = rangeStart !== undefined ? rangeStart : 0;
              const end = rangeEnd !== undefined ? rangeEnd : Infinity;

              // Check if this slice overlaps with the requested range
              if (chunkEndPos > start && chunkStartPos <= end) {
                const sliceStart = Math.max(0, start - chunkStartPos);
                const sliceEnd = Math.min(value.length, end - chunkStartPos + 1);
                
                if (sliceStart < sliceEnd) {
                  const slice = value.slice(sliceStart, sliceEnd);
                  try { controller.enqueue(slice); } catch {}
                  return; // End pull cycle after yielding data
                }
              }
              // If this chunk portion is outside the range, continue the while loop
            }
          }
        } catch (error: any) {
          // If aborted, just close cleanly — don't log as error
          if (signal.aborted) {
            try { controller.close(); } catch {}
            return;
          }

          logger.error({ error: error.message, chunkIndex: currentChunk, fileId: fileRecord.fileId }, 'Chunk stream download failed');
          
          // We DO NOT mark the file as corrupted in the database here.
          // Playback/download errors can be caused by transient network issues, 
          // provider rate limits, or momentary timeouts. Permanently marking 
          // the file as corrupted here creates false positives that break playback 
          // permanently. Integrity auditing is strictly handled by IntegrityService.
          if (error.message?.includes('Downloaded chunk is empty') || error.message?.includes('missing on provider')) {
            logger.warn({ chunkIndex: currentChunk, fileId: fileRecord.fileId }, 'Chunk download returned empty or missing from provider (transient stream error)');
          }

          if (currentReader) {
            try { currentReader.cancel(); } catch {}
            currentReader = null;
          }
          try { controller.error(error); } catch {}
        }
      },
      cancel(reason) {
        logger.info({ fileId: fileRecord.fileId }, 'Main stream canceled, cleaning up resources');
        abortController.abort(reason);

        if (currentReader) {
          try { currentReader.cancel(reason); } catch {}
          currentReader = null;
        }
        
        // Also cancel all prefetch promises to kill their rclone processes
        for (const [index, promise] of prefetchPromises.entries()) {
          promise.then(stream => {
            stream.cancel(reason).catch(() => {});
          }).catch(() => {});
        }
        prefetchPromises.clear();
      }
    });
  }


  async getUploadProgress(fileId: string): Promise<UploadProgress> {
    const chunks = await this.chunkRepository.getChunksByFileId(fileId);

    // Calculate expected total from the file's actual size, NOT from chunk count in DB
    const file = await this.fileRepository.findById(fileId);
    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }
    const chunkSize = this.defaultChunkSize;
    const totalChunks = Math.ceil(file.size / chunkSize);

    const uploadedChunks = chunks.length;
    const uploadedIndices = new Set(chunks.map((c: any) => c.chunkIndex));
    const missingChunks = [];

    for (let i = 0; i < totalChunks; i++) {
      if (!uploadedIndices.has(i)) {
        missingChunks.push(i);
      }
    }

    return {
      fileId,
      totalChunks,
      uploadedChunks,
      percentage: totalChunks > 0 ? (uploadedChunks / totalChunks) * 100 : 0,
      isComplete: uploadedChunks === totalChunks,
      missingChunks,
    };
  }

  async resumeChunkedUpload(params: {
    fileId: string;
    chunkSize: number;
    totalChunks: number;
  }): Promise<void> {
    logger.info({ fileId: params.fileId }, 'Resuming chunked upload metadata from database');
    const fileRecord = await this.fileRepository.findById(params.fileId);
    if (!fileRecord || !fileRecord.isChunked) {
      throw new Error(`Cannot resume upload: Chunked file record not found for ${params.fileId}`);
    }

    this.uploadMetadata.set(params.fileId, {
      filename: fileRecord.filename,
      size: fileRecord.size,
      chunkSize: params.chunkSize,
      totalChunks: params.totalChunks,
      providerType: fileRecord.providerType!,
      mimeType: fileRecord.mimeType,
      uploadedChunks: [], 
      category: fileRecord.category || undefined,
      collectionName: fileRecord.collectionName || undefined,
      accountId: fileRecord.accountId!,
    });
  }

  async initializeChunkedUpload(params: {
    filename: string;
    size: number;
    chunkSize: number;
    totalChunks: number;
    providerType: ProviderType;
    mimeType?: string;
    collectionName?: string;
    accountId?: string;
  }): Promise<string> {
    const fileId = uuidv4();

    logger.info({ fileId, filename: params.filename, totalChunks: params.totalChunks }, 'Initializing chunked upload');

    // Detect category from MIME type
    const category = detectCategory(params.mimeType);

    // Generate collection name if not provided (for images)
    // Only automatically categorize images. Videos should remain uncategorized by default.
    const collectionName = params.collectionName || (category === 'images' ? generateDefaultCollectionName() : undefined);

    // Select account for this upload
    let account;
    if (params.accountId) {
      account = await this.accountRepository.findById(params.accountId);
      if (!account) {
        throw new Error(`Specified account not found: ${params.accountId}`);
      }
    } else {
      const selection = await this.accountSelector.selectAccountsForUpload(
        params.size,
        params.providerType
      );

      if (selection.accounts.length === 0) {
        throw new Error('No accounts available with sufficient quota');
      }
      account = selection.accounts[0].account;
    }

    // Create file record in database
    await this.fileRepository.create({
      id: fileId,
      filename: params.filename,
      size: params.size,
      mimeType: params.mimeType || 'application/octet-stream',
      providerType: params.providerType,
      accountId: account.id,
      providerFileId: fileId,
      isChunked: true,
      category,
      collectionName,
      chunkSize: params.chunkSize,
      uploadedAt: new Date(),
    });

    // Store upload metadata with selected account
    this.uploadMetadata.set(fileId, {
      filename: params.filename,
      size: params.size,
      chunkSize: params.chunkSize,
      totalChunks: params.totalChunks,
      providerType: params.providerType,
      mimeType: params.mimeType,
      uploadedChunks: [],
      category,
      collectionName,
      accountId: account.id, // Store the selected account ID
    });

    return fileId;
  }

  async uploadChunkData(
    fileId: string,
    chunkIndex: number,
    stream: ReadableStream,
    size: number
  ): Promise<void> {
    logger.info({ fileId, chunkIndex }, 'Uploading chunk');

    // Check if chunk already exists (duplicate prevention)
    const exists = await this.checkChunkExists(fileId, chunkIndex);
    if (exists) {
      logger.info({ fileId, chunkIndex }, 'Chunk already exists, skipping upload');
      return;
    }

    const metadata = this.uploadMetadata.get(fileId);
    if (!metadata) {
      throw new Error('Upload not initialized');
    }

    // Read stream into buffer
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const chunkData = new Uint8Array(Buffer.concat(chunks));

    const dataToUpload = chunkData;

    // Use the account that was already selected during initialization
    const account = await this.accountRepository.findById(metadata.accountId);
    if (!account) {
      throw new Error(`Account not found: ${metadata.accountId}`);
    }

    // Generate storage path based on category
    const storagePath = generateStoragePath({
      category: (metadata.category as 'videos' | 'images') || 'videos',
      collectionName: metadata.collectionName || metadata.filename,
      filename: metadata.filename,
      chunkIndex,
      remoteName: '', // Will be set by provider
    });

    // Upload to provider via rclone with category-based path
    const provider = this.providerFactory.getProvider(metadata.providerType);

    const MAX_RETRIES = 3;
    let attempt = 0;
    let uploadResult;

    while (attempt < MAX_RETRIES) {
      try {
        const chunkStream = new ReadableStream({
          start(controller) {
            controller.enqueue(dataToUpload);
            controller.close();
          },
        });

        uploadResult = await provider.uploadFile(account, {
          filename: storagePath,
          mimeType: 'application/octet-stream',
          size: dataToUpload.length,
          stream: chunkStream,
        }, undefined); // Internal parallel upload doesn't use signal yet
        
        // Break out of retry loop on success
        break;
      } catch (error: any) {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          logger.error({ error: error.message, fileId, chunkIndex }, 'Chunk upload failed completely after retries');
          throw error;
        }
        
        const delay = Math.pow(2, attempt) * 2000;
        logger.warn({ error: error.message, fileId, chunkIndex, attempt, delay }, 'Chunk upload failed, retrying...');
        await new Promise(r => setTimeout(r, delay));
      }
    }

    if (!uploadResult) {
      throw new Error(`Upload failed for chunk ${chunkIndex}`);
    }

    // Store chunk metadata
    await this.chunkRepository.createChunk({
      fileId,
      chunkIndex,
      chunkSize: dataToUpload.length,
      accountId: account.id,
      providerType: metadata.providerType,
      providerFileId: uploadResult.providerFileId,
      uploadedAt: new Date(),
    });

    // Track uploaded chunk
    metadata.uploadedChunks.push(chunkIndex);

    // Generate thumbnail from first chunk (only if it represents the full image or is a video)
    const isSingleChunkImage = metadata.mimeType?.startsWith('image/') && metadata.totalChunks === 1;
    const isVideo = metadata.mimeType?.startsWith('video/');

    if (chunkIndex === 0 && (isSingleChunkImage || isVideo)) {
      try {
        const thumbnail = await this.thumbnailService.generateThumbnailFromBuffer(
          Buffer.from(chunkData),
          metadata.mimeType!
        );

        // Update file record with thumbnail
        await this.fileRepository.update(fileId, { thumbnailData: thumbnail });

        logger.info({ fileId }, 'Thumbnail generated and stored');
      } catch (error) {
        logger.warn({ fileId, error }, 'Failed to generate thumbnail, continuing without it');
        // Don't fail the upload if thumbnail generation fails
      }
    }

    logger.info({ fileId, chunkIndex, size: dataToUpload.length }, 'Chunk uploaded successfully');
  }

  async finalizeChunkedUpload(fileId: string): Promise<any> {
    logger.info({ fileId }, 'Finalizing chunked upload');

    const metadata = this.uploadMetadata.get(fileId);
    if (!metadata) {
      throw new Error('Upload not initialized');
    }

    // Verify all chunks uploaded
    const progress = await this.getUploadProgress(fileId);

    if (!progress.isComplete) {
      throw new Error(`Upload incomplete: ${progress.uploadedChunks}/${progress.totalChunks} chunks uploaded`);
    }

    // Get the file record (already created during initialization)
    const fileRecord = await this.fileRepository.findById(fileId);

    if (!fileRecord) {
      throw new Error('File record not found');
    }

    // Clean up temporary metadata
    this.uploadMetadata.delete(fileId);

    // NOTE: Quota update is handled by the caller (e.g. auto-upload.queue.ts)
    // after finalization, using refreshAccountQuota for accurate values.
    // Previously this called updateQuotaAfterUpload here too, which caused
    // double-counting when both the caller and this method incremented quota.

    logger.info({ fileId }, 'Chunked upload finalized');

    return fileRecord;
  }

  /**
   * Upload multiple chunks in parallel with concurrency control
   */
  async uploadChunksInParallel(
    fileId: string,
    chunks: Array<{ index: number; stream: ReadableStream; size: number }>
  ): Promise<{ successful: number[]; failed: Array<{ index: number; error: string }> }> {
    logger.info({ fileId, chunkCount: chunks.length }, 'Starting parallel chunk upload');

    const results = await Promise.allSettled(
      chunks.map((chunk) =>
        this.uploadLimiter.run(async () => {
          await this.uploadChunkData(fileId, chunk.index, chunk.stream, chunk.size);
          return chunk.index;
        })
      )
    );

    const successful: number[] = [];
    const failed: Array<{ index: number; error: string }> = [];

    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        successful.push(result.value);
      } else {
        failed.push({
          index: chunks[idx].index,
          error: result.reason?.message || 'Unknown error',
        });
      }
    });

    logger.info(
      { fileId, successful: successful.length, failed: failed.length },
      'Parallel chunk upload completed'
    );

    return { successful, failed };
  }

  /**
   * Check if a chunk already exists in the database
   */
  async checkChunkExists(fileId: string, chunkIndex: number): Promise<boolean> {
    const chunks = await this.chunkRepository.getChunksByFileId(fileId);
    return chunks.some((chunk: any) => chunk.chunkIndex === chunkIndex);
  }

  /**
   * Get missing chunks for an upload session
   */
  async getMissingChunks(fileId: string): Promise<number[]> {
    const file = await this.fileRepository.findById(fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const metadata = this.uploadMetadata.get(fileId);
    if (!metadata) {
      throw new Error('Upload metadata not found');
    }

    const uploadedChunks = await this.chunkRepository.getChunksByFileId(fileId);
    const uploadedIndices = new Set(uploadedChunks.map((c: any) => c.chunkIndex));

    const missingChunks: number[] = [];
    for (let i = 0; i < metadata.totalChunks; i++) {
      if (!uploadedIndices.has(i)) {
        missingChunks.push(i);
      }
    }

    return missingChunks.sort((a, b) => a - b);
  }

  /**
   * Clear cached chunks for a file
   * Call this when a file is deleted or updated
   */
  async clearFileCache(fileId: string): Promise<number> {
    const pattern = `chunk:${fileId}:*`;
    const deleted = await this.cacheService.deletePattern(pattern);
    logger.info({ fileId, deleted }, 'Cleared file chunks from cache');
    return deleted;
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{ keys: number; memory: string }> {
    return await this.cacheService.getStats();
  }
}
