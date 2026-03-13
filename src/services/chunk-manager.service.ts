// Chunk manager for handling large file uploads/downloads
import { ChunkRepository } from '../repositories/chunk.repository.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { FileRepository } from '../repositories/file.repository.js';
import { AccountSelector } from './account-selector.service.js';
import { AccountRotator } from './account-rotator.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import { FileEncryptionService } from './file-encryption.service.js';
import { ThumbnailService } from './thumbnail.service.js';
import { CacheService } from './cache.service.js';
import { ConcurrencyLimiter } from '../utils/concurrency-limiter.js';
import { detectCategory, generateDefaultCollectionName, generateStoragePath } from '../utils/storage-path.js';
import type { ChunkMetadata, ProviderType } from '../types/index.js';
import type { FileUpload } from '../types/provider.js';
import { v4 as uuidv4 } from 'uuid';
import { appConfig } from '../config/index.js';
import { ChunkUploadError } from '../utils/errors.js';
import logger from '../utils/logger.js';

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
  encryptionKey?: string;
  iv?: string;
  uploadedChunks: number[];
  category?: string;
  collectionName?: string;
  accountId: string; // Store the selected account ID
}

export class ChunkManager {
  private defaultChunkSize = appConfig.upload.chunkSize;
  private uploadMetadata: Map<string, UploadMetadata> = new Map();
  private concurrencyLimiter: ConcurrencyLimiter;
  private thumbnailService: ThumbnailService;
  private cacheService: CacheService;
  private chunkCacheTTL = 3600; // 1 hour cache for chunks

  constructor(
    private chunkRepository: ChunkRepository,
    private accountRepository: AccountRepository,
    private fileRepository: FileRepository,
    private accountSelector: AccountSelector,
    private accountRotator: AccountRotator,
    private providerFactory: ProviderFactory,
    private encryptionService: FileEncryptionService
  ) {
    this.concurrencyLimiter = new ConcurrencyLimiter(appConfig.upload.maxParallelChunks);
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

    // Generate encryption key for entire file
    const { encryptionKey, iv } = await this.encryptionService.generateFileKey();

    const chunks: Omit<ChunkMetadata, 'id'>[] = [];

    // Upload chunks with limited concurrency
    const concurrency = appConfig.upload.maxParallelChunks;

    for (let i = 0; i < totalChunks; i += concurrency) {
      const chunkPromises = [];

      for (let j = 0; j < concurrency && i + j < totalChunks; j++) {
        const chunkIndex = i + j;
        chunkPromises.push(
          this.uploadChunk(file, fileId, chunkIndex, chunkSize, providerType, encryptionKey, iv)
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
      encryptionKey,
      iv,
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
    providerType: ProviderType,
    encryptionKey: string,
    iv: string
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

    // Encrypt chunk
    const encryptedChunk = await this.encryptionService.encryptChunk(
      chunkData,
      encryptionKey,
      iv,
      chunkIndex
    );

    // Upload to provider
    const provider = this.providerFactory.getProvider(providerType);

    const chunkStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encryptedChunk);
        controller.close();
      },
    });

    const result = await provider.uploadFile(account, {
      filename: `${fileId}_chunk_${chunkIndex}`,
      mimeType: 'application/octet-stream',
      size: encryptedChunk.length,
      stream: chunkStream,
    });

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
    const endChunk = rangeEnd ? Math.min(Math.ceil(rangeEnd / fileRecord.chunkSize), maxChunks) : maxChunks;

    return this.createChunkStream(fileRecord, startChunk, endChunk, rangeStart, rangeEnd);
  }

  private createChunkStream(
    fileRecord: any,
    startChunk: number,
    endChunk: number,
    rangeStart?: number,
    rangeEnd?: number
  ): ReadableStream {
    let currentChunk = startChunk;
    const PREFETCH_COUNT = 2; // Number of chunks to prefetch ahead

    // Helper: download and decrypt a single chunk (streamed and cached on-the-fly)
    const fetchChunkStream = async (chunkIndex: number): Promise<ReadableStream> => {
      const cacheKey = `chunk:stream:${fileRecord.id}:${chunkIndex}`;

      // Try Redis Stream Cache first
      const cachedStream = await this.cacheService.getStream(cacheKey);
      if (cachedStream) {
        logger.debug({ fileId: fileRecord.id, chunkIndex }, 'Chunk stream served from Redis cache');
        return cachedStream;
      }

      // Cache miss — download from cloud
      logger.debug({ fileId: fileRecord.id, chunkIndex }, 'Chunk stream cache miss, downloading from cloud');

      const chunk = fileRecord.chunks[chunkIndex];
      const provider = this.providerFactory.getProvider(chunk.providerType);
      const account = await this.accountRepository.findById(chunk.accountId);

      if (!account) {
        throw new Error(`Account not found: ${chunk.accountId}`);
      }

      // 1. Get encrypted stream from provider
      const encryptedStream = await provider.downloadFile(account, chunk.providerFileId);

      // Actually, since chunk-manager previously used `decryptChunk` which requires a full buffer:
      // Let's read the chunk entirely, decrypt it, and THEN proxy the buffer as a stream 
      // into the cache stream wrapper to at least cache it moving forward.
      const reader = encryptedStream.getReader();
      const parts: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      const encryptedData = Buffer.concat(parts);
      const decryptedData = await this.encryptionService.decryptChunk(
        encryptedData,
        fileRecord.encryptionKey,
        fileRecord.iv,
        chunkIndex
      );

      // Create a readable stream from the decrypted buffer
      const bufferStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(decryptedData));
          controller.close();
        }
      });

      // Wrap it in cache proxy so it gets saved to Redis memory automatically
      return this.cacheService.cacheStream(cacheKey, bufferStream, this.chunkCacheTTL);
    };

    const prefetchPromises: Map<number, Promise<ReadableStream>> = new Map();

    // Start prefetching: kick off downloads for the first few chunks immediately
    const startPrefetch = (fromIndex: number) => {
      for (let i = fromIndex; i < Math.min(fromIndex + PREFETCH_COUNT, endChunk); i++) {
        if (!prefetchPromises.has(i)) {
          prefetchPromises.set(i, fetchChunkStream(i));
        }
      }
    };

    // Kick off initial prefetch
    startPrefetch(startChunk);
    
    let currentReader: any = null;

    return new ReadableStream({
      pull: async (controller) => {
        try {
          while (true) {
            // Check if we are done with all chunks
            if (currentChunk >= endChunk && !currentReader) {
              controller.close();
              return;
            }

            // Need to open the next chunk stream
            if (!currentReader) {
              let chunkPromise = prefetchPromises.get(currentChunk);
              if (!chunkPromise) {
                chunkPromise = fetchChunkStream(currentChunk);
              }

              const chunkStream = await chunkPromise;
              prefetchPromises.delete(currentChunk);
              currentReader = chunkStream?.getReader() || null;
              
              if (!currentReader) {
                 throw new Error(`Failed to get reader for chunk ${currentChunk}`);
              }
              
              // Trigger prefetch for upcoming chunks now that we advanced a chunk
              startPrefetch(currentChunk + 1);
            }

            // Read from current chunk
            const { done, value } = await currentReader.read();

            if (done) {
              // Current chunk finished, move to next
              currentReader.releaseLock();
              currentReader = null;
              currentChunk++;
              // Loop continues to open next chunk
            } else {
              // Yield data
              controller.enqueue(value);
              return; // End pull cycle
            }
          }
        } catch (error) {
          logger.error({ error, chunkIndex: currentChunk }, 'Chunk stream download failed');
          if (currentReader) currentReader.releaseLock();
          controller.error(error);
        }
      },
      cancel(reason) {
        if (currentReader) {
          currentReader.cancel(reason);
        }
      }
    });
  }


  async getUploadProgress(fileId: string): Promise<UploadProgress> {
    const chunks = await this.chunkRepository.getChunksByFileId(fileId);
    const totalChunks = await this.chunkRepository.getTotalChunks(fileId);

    const uploadedChunks = chunks.length;
    const uploadedIndices = new Set(chunks.map(c => c.chunkIndex));
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

  async resumeUpload(fileId: string): Promise<void> {
    logger.info({ fileId }, 'Resume upload not yet implemented');
    // TODO: Implement resume logic
  }

  async initializeChunkedUpload(params: {
    filename: string;
    size: number;
    chunkSize: number;
    totalChunks: number;
    providerType: ProviderType;
    mimeType?: string;
    encrypt: boolean;
    collectionName?: string;
  }): Promise<string> {
    const fileId = uuidv4();

    logger.info({ fileId, filename: params.filename, totalChunks: params.totalChunks }, 'Initializing chunked upload');

    // Generate encryption key if needed
    let encryptionKey: string | undefined;
    let iv: string | undefined;

    if (params.encrypt) {
      const keyData = await this.encryptionService.generateFileKey();
      encryptionKey = keyData.encryptionKey;
      iv = keyData.iv;
    }

    // Detect category from MIME type
    const category = detectCategory(params.mimeType);

    // Generate collection name if not provided (for images)
    // Only automatically categorize images. Videos should remain uncategorized by default.
    const collectionName = params.collectionName || (category === 'images' ? generateDefaultCollectionName() : undefined);

    // Select accounts for this upload
    const selection = await this.accountSelector.selectAccountsForUpload(
      params.size,
      params.providerType
    );

    if (selection.accounts.length === 0) {
      throw new Error('No accounts available with sufficient quota');
    }

    const account = selection.accounts[0].account;

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
      encryptionKey: encryptionKey,
      encryptionIv: iv,
      category,
      collectionName,
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
      encryptionKey,
      iv,
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

    // Encrypt chunk if encryption is enabled
    let dataToUpload: Uint8Array = chunkData;
    if (metadata.encryptionKey && metadata.iv) {
      dataToUpload = await this.encryptionService.encryptChunk(
        Buffer.from(chunkData),
        metadata.encryptionKey,
        metadata.iv,
        chunkIndex
      );
    }

    // Use the account that was already selected during initialization
    const account = await this.accountRepository.findById(metadata.accountId);
    if (!account) {
      throw new Error(`Account not found: ${metadata.accountId}`);
    }

    // Generate storage path based on category
    const storagePath = generateStoragePath({
      category: (metadata.category as 'videos' | 'images') || 'videos',
      collectionName: metadata.collectionName || metadata.filename,
      filename: `chunk_${chunkIndex}`,
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
        });
        
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

    // Generate thumbnail from first chunk (for videos/images)
    if (chunkIndex === 0 && (metadata.mimeType?.startsWith('video/') || metadata.mimeType?.startsWith('image/'))) {
      try {
        const thumbnail = await this.thumbnailService.generateThumbnailFromBuffer(
          Buffer.from(chunkData),
          metadata.mimeType
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
        this.concurrencyLimiter.run(async () => {
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
    return chunks.some(chunk => chunk.chunkIndex === chunkIndex);
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
    const uploadedIndices = new Set(uploadedChunks.map(c => c.chunkIndex));

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
