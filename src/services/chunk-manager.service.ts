// Chunk manager for handling large file uploads/downloads
import { ChunkRepository } from '../repositories/chunk.repository.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { FileRepository } from '../repositories/file.repository.js';
import { AccountSelector } from './account-selector.service.js';
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
    const encryptedChunk = await this.encryptionService.decryptChunk(
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
    
    const startChunk = rangeStart ? Math.floor(rangeStart / fileRecord.chunkSize) : 0;
    const endChunk = rangeEnd ? Math.ceil(rangeEnd / fileRecord.chunkSize) : fileRecord.totalChunks;
    
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
    
    return new ReadableStream({
      pull: async (controller) => {
        if (currentChunk >= endChunk) {
          controller.close();
          return;
        }
        
        try {
          const chunk = fileRecord.chunks[currentChunk];
          const cacheKey = `chunk:${fileRecord.id}:${currentChunk}`;
          
          // Try to get from cache first
          let decryptedData = await this.cacheService.getBuffer(cacheKey);
          
          if (decryptedData) {
            logger.debug({ fileId: fileRecord.id, chunkIndex: currentChunk }, 'Chunk served from cache');
          } else {
            // Cache miss - download from cloud storage
            logger.debug({ fileId: fileRecord.id, chunkIndex: currentChunk }, 'Chunk cache miss, downloading from cloud');
            
            const provider = this.providerFactory.getProvider(chunk.providerType);
            const account = await this.accountRepository.findById(chunk.accountId);
            
            if (!account) {
              throw new Error(`Account not found: ${chunk.accountId}`);
            }
            
            const encryptedStream = await provider.downloadFile(account, chunk.providerFileId);
            const reader = encryptedStream.getReader();
            
            const chunks: Uint8Array[] = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            
            const encryptedData = Buffer.concat(chunks);
            decryptedData = await this.encryptionService.decryptChunk(
              encryptedData,
              fileRecord.encryptionKey,
              fileRecord.iv,
              currentChunk
            );
            
            // Store in cache for future requests (1 hour TTL)
            await this.cacheService.setBuffer(cacheKey, decryptedData, this.chunkCacheTTL);
            logger.debug({ fileId: fileRecord.id, chunkIndex: currentChunk, size: decryptedData.length }, 'Chunk cached');
          }
          
          controller.enqueue(decryptedData);
          currentChunk++;
        } catch (error) {
          logger.error({ error, chunkIndex: currentChunk }, 'Chunk download failed');
          controller.error(error);
        }
      },
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
    const collectionName = category === 'images' 
      ? (params.collectionName || generateDefaultCollectionName())
      : params.filename.replace(/\.[^/.]+$/, ''); // Remove extension for videos
    
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
    
    // Store upload metadata
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
    
    const chunkData = Buffer.concat(chunks);
    
    // Encrypt chunk if encryption is enabled
    let dataToUpload = chunkData;
    if (metadata.encryptionKey && metadata.iv) {
      dataToUpload = await this.encryptionService.encryptChunk(
        chunkData,
        metadata.encryptionKey,
        metadata.iv,
        chunkIndex
      );
    }
    
    // Select account for upload using AccountSelector
    const selection = await this.accountSelector.selectAccountsForUpload(
      dataToUpload.length,
      metadata.providerType
    );
    
    if (selection.accounts.length === 0) {
      throw new Error('No accounts available with sufficient quota');
    }
    
    const account = selection.accounts[0].account;
    
    // Generate storage path based on category
    const storagePath = generateStoragePath({
      category: metadata.category || 'videos',
      collectionName: metadata.collectionName || metadata.filename,
      filename: `chunk_${chunkIndex}`,
      chunkIndex,
      remoteName: '', // Will be set by provider
    });
    
    // Upload to provider via rclone with category-based path
    const provider = this.providerFactory.getProvider(metadata.providerType);
    
    const chunkStream = new ReadableStream({
      start(controller) {
        controller.enqueue(dataToUpload);
        controller.close();
      },
    });
    
    const result = await provider.uploadFile(account, {
      filename: storagePath,
      mimeType: 'application/octet-stream',
      size: dataToUpload.length,
      stream: chunkStream,
    });
    
    // Store chunk metadata
    await this.chunkRepository.createChunk({
      fileId,
      chunkIndex,
      chunkSize: chunkData.length,
      accountId: account.id,
      providerType: metadata.providerType,
      providerFileId: result.providerFileId,
      uploadedAt: new Date(),
    });
    
    // Update quota estimate after upload
    await this.accountSelector.updateQuotaAfterUpload(account.id, dataToUpload.length);
    
    // Track uploaded chunk
    metadata.uploadedChunks.push(chunkIndex);
    
    // Generate thumbnail from first chunk (for videos/images)
    if (chunkIndex === 0 && (metadata.mimeType?.startsWith('video/') || metadata.mimeType?.startsWith('image/'))) {
      try {
        const thumbnail = await this.thumbnailService.generateThumbnailFromBuffer(
          chunkData,
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
    
    logger.info({ fileId, chunkIndex, size: chunkData.length }, 'Chunk uploaded successfully');
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
