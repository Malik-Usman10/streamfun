// File service for file operations
import { FileRepository } from '../repositories/file.repository.js';
import { AccountRotator } from './account-rotator.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import { TokenManager } from './token-manager.service.js';
import { BandwidthTracker } from './bandwidth-tracker.service.js';
import { FileEncryptionService } from './file-encryption.service.js';
import { CacheService } from './cache.service.js';
import { ThumbnailService } from './thumbnail.service.js';
import type { ChunkManager } from './chunk-manager.service.js';
import type { FileRecord, ProviderType } from '../types/index.js';
import type { FileUpload } from '../types/provider.js';
import { UploadError, DownloadError, FileNotFoundError } from '../utils/errors.js';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';

export class FileService {
  constructor(
    private fileRepository: FileRepository,
    private accountRotator: AccountRotator,
    private providerFactory: ProviderFactory,
    private tokenManager: TokenManager,
    private bandwidthTracker: BandwidthTracker,
    private encryptionService: FileEncryptionService,
    private chunkManager?: ChunkManager,
    private thumbnailService: ThumbnailService = new ThumbnailService(),
    private cacheService: CacheService = new CacheService()
  ) {}

  async uploadFile(
    providerType: ProviderType,
    file: FileUpload,
    encrypt: boolean = true,
    signal?: AbortSignal
  ): Promise<FileRecord> {
    logger.info({ filename: file.filename, size: file.size, providerType }, 'Starting file upload');
    
    // Select optimal account
    const account = await this.accountRotator.selectAccountForUpload(providerType, file.size);
    const provider = this.providerFactory.getProvider(providerType);
    
    // Ensure token is fresh
    await this.tokenManager.refreshIfNeeded(account, provider);
    
    let encryptionKey: string | undefined;
    let encryptionIv: string | undefined;
    let uploadStream = file.stream;
    
    // Encrypt file if requested
    if (encrypt) {
      const encrypted = await this.encryptionService.encryptFile(file.stream, file.filename);
      uploadStream = encrypted.encryptedStream;
      encryptionKey = encrypted.encryptionKey;
      encryptionIv = encrypted.iv;
    }
    
    // Upload with retry
    const result = await this.uploadWithRetry(provider, account, {
      ...file,
      stream: uploadStream,
    }, 3, signal);
    
    // Store metadata
    const fileRecord = await this.fileRepository.create({
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      providerType,
      accountId: account.id,
      providerFileId: result.providerFileId,
      isChunked: false,
      encryptionKey,
      encryptionIv,
      metadata: file.metadata,
      uploadedAt: result.uploadedAt,
    });
    
    // Update account usage and bandwidth
    await this.accountRotator.updateAccountUsage(account.id, file.size);
    await this.bandwidthTracker.recordUsage(account.id, 'upload', file.size);
    
    logger.info({ fileId: fileRecord.id }, 'File uploaded successfully');
    
    return fileRecord;
  }

  async uploadFromUrl(
    providerType: ProviderType,
    url: string,
    filename: string,
    encrypt: boolean = false,
    signal?: AbortSignal
  ): Promise<FileRecord> {
    logger.info({ url, filename, providerType }, 'Starting URL upload');
    
    // We don't know the exact size yet, assume 0 for initial account selection
    const account = await this.accountRotator.selectAccountForUpload(providerType, 0);
    const provider = this.providerFactory.getProvider(providerType);
    
    // Ensure token is fresh
    await this.tokenManager.refreshIfNeeded(account, provider);

    let providerFileId = filename;
    let finalSize = 0;
    let mimeType = 'application/octet-stream';
    let encryptionKey: string | undefined;
    let encryptionIv: string | undefined;

    // If unencrypted AND the provider supports uploadFromUrl, let the provider do it directly 
    if (!encrypt && provider.uploadFromUrl) {
      logger.info({ url, providerName: provider.providerName }, 'Delegating URL upload directly to provider (bypassing stream constraints)');
      
      const result = await provider.uploadFromUrl(account, url, filename, signal);
      providerFileId = result.providerFileId;
      
      // If we need the real size, we might have to fetch it explicitly here, 
      // but for bypassing, we skip downloading the size.
    } else {
      logger.info({ url, encrypt }, 'Downloading URL to server stream before upload');
      const response = await fetch(url, { signal } as RequestInit);
      
      if (!response.ok || !response.body) {
         throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }
      
      finalSize = parseInt(response.headers.get('content-length') || '0', 10);
      mimeType = response.headers.get('content-type') || mimeType;

      let uploadStream = response.body;
      
      // Encrypt file if requested
      if (encrypt) {
        const encrypted = await this.encryptionService.encryptFile(uploadStream, filename);
        uploadStream = encrypted.encryptedStream;
        encryptionKey = encrypted.encryptionKey;
        encryptionIv = encrypted.iv;
      }
      
      const file: FileUpload = {
        filename,
        mimeType,
        size: finalSize,
        stream: uploadStream
      };

      const result = await this.uploadWithRetry(provider, account, file, 3, signal);
      providerFileId = result.providerFileId;
    }

    // Store metadata
    const fileRecord = await this.fileRepository.create({
      filename,
      mimeType,
      size: finalSize,
      providerType,
      accountId: account.id,
      providerFileId,
      isChunked: false,
      encryptionKey,
      encryptionIv,
      uploadedAt: new Date(),
    });
    
    if (finalSize > 0) {
      await this.accountRotator.updateAccountUsage(account.id, finalSize);
      await this.bandwidthTracker.recordUsage(account.id, 'upload', finalSize);
    }
    
    logger.info({ fileId: fileRecord.id }, 'URL File uploaded successfully');
    
    return fileRecord;
  }

  private async uploadWithRetry(
    provider: any,
    account: any,
    file: FileUpload,
    maxRetries: number = 3,
    signal?: AbortSignal
  ): Promise<any> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new Error('Upload aborted');
      try {
        return await provider.uploadFile(account, file, signal);
      } catch (error) {
        lastError = error as Error;
        logger.warn({ attempt, error }, 'Upload attempt failed');
        
        if (attempt < maxRetries) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }
    
    throw new UploadError(`Upload failed after ${maxRetries} attempts`, lastError);
  }

  async downloadFile(
    fileId: string,
    rangeStart?: number,
    rangeEnd?: number,
    signal?: AbortSignal
  ): Promise<{ stream: ReadableStream; file: FileRecord }> {
    const file = await this.fileRepository.findById(fileId);
    
    if (!file) {
      throw new FileNotFoundError(fileId);
    }
    
    // Handle chunked files differently
    if (file.isChunked) {
      return await this.downloadChunkedFile(fileId, file, rangeStart, rangeEnd);
    }
    
    // Check Redis Stream Cache first
    const cacheKey = `file:stream:${fileId}`;
    const cachedStream = await this.cacheService.getStream(cacheKey);
    if (cachedStream && !rangeStart && !rangeEnd) {
       logger.info({ fileId }, 'Serving single non-chunked file stream entirely from Redis cache');
       return { stream: cachedStream, file };
    }

    const account = await this.accountRotator.selectAccountForDownload(
      file.providerType,
      file.size
    );
    const provider = this.providerFactory.getProvider(file.providerType);
    
    await this.tokenManager.refreshIfNeeded(account, provider);
    
    let stream = await provider.downloadFile(account, file.providerFileId, signal);
    
    // Decrypt if encrypted
    if (file.encryptionKey && file.encryptionIv) {
      stream = await this.encryptionService.decryptFile(stream, file.encryptionKey, file.encryptionIv);
    }
    
    // Cache the completely built and decrypted stream in Redis (only for full downloads)
    if (!rangeStart && !rangeEnd) {
      stream = this.cacheService.cacheStream(cacheKey, stream, 21600);
    }

    await this.bandwidthTracker.recordUsage(account.id, 'download', file.size);
    
    return { stream, file };
  }

  private async downloadChunkedFile(
    fileId: string,
    file: FileRecord,
    rangeStart?: number,
    rangeEnd?: number
  ): Promise<{ stream: ReadableStream; file: FileRecord }> {
    if (!this.chunkManager) {
      throw new Error('ChunkManager not available for chunked file download');
    }
    
    logger.info({ fileId, isChunked: file.isChunked }, 'Downloading chunked file');
    
    // OPTIMIZATION: For single-chunk files, download directly without chunk manager overhead
    const { ChunkRepository } = await import('../repositories/chunk.repository.js');
    const chunkRepository = new ChunkRepository();
    const chunks = await chunkRepository.getChunksByFileId(fileId);
    
    if (chunks.length === 1) {
      logger.info({ fileId }, 'Single chunk detected, using direct download');
      
      const chunk = chunks[0];
      const { AccountRepository } = await import('../repositories/account.repository.js');
      const accountRepository = new AccountRepository();
      const account = await accountRepository.findById(chunk.accountId);
      
      if (!account) {
        throw new Error(`Account not found: ${chunk.accountId}`);
      }
      
      const provider = this.providerFactory.getProvider(chunk.providerType);
      let stream = await provider.downloadFile(account, chunk.providerFileId);
      
      // Decrypt if encrypted
      if (file.encryptionKey && file.encryptionIv) {
        logger.debug({ fileId, hasEncryption: true }, 'File is encrypted, decrypting single chunk');
        
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        
        const encryptedData = Buffer.concat(chunks);
        logger.debug({ 
          fileId, 
          encryptedSize: encryptedData.length,
          keyLength: file.encryptionKey.length,
          ivLength: file.encryptionIv.length 
        }, 'About to decrypt single chunk');
        
        const decryptedData = await this.encryptionService.decryptChunk(
          encryptedData,
          file.encryptionKey,
          file.encryptionIv,
          0 // chunk index 0
        );
        
        stream = new ReadableStream({
          start(controller) {
            controller.enqueue(decryptedData);
            controller.close();
          },
        });
      }
      
      await this.bandwidthTracker.recordUsage(account.id, 'download', file.size);
      
      return { stream, file };
    }
    
    // Use ChunkManager for multi-chunk files
    const stream = await this.chunkManager.downloadFileInChunks(fileId, rangeStart, rangeEnd);
    
    return { stream, file };
  }

  async deleteFile(fileId: string): Promise<void> {
    const file = await this.fileRepository.findById(fileId);
    
    if (!file) {
      throw new FileNotFoundError(fileId);
    }
    
    logger.info({ fileId, isChunked: file.isChunked }, 'Starting file deletion');
    
    // Handle chunked files differently
    if (file.isChunked) {
      await this.deleteChunkedFile(fileId);
      
      // Clear cached chunks from Redis
      if (this.chunkManager) {
        await this.chunkManager.clearFileCache(fileId);
      }
    } else {
      // Delete single file from storage
      const account = await this.accountRotator.selectAccountForDownload(
        file.providerType,
        file.size
      );
      const provider = this.providerFactory.getProvider(file.providerType);
      
      await provider.deleteFile(account, file.providerFileId);
    }
    
    // Delete file record from database
    await this.fileRepository.delete(fileId);
    
    logger.info({ fileId }, 'File deleted successfully');
  }

  private async deleteChunkedFile(fileId: string): Promise<void> {
    // Import ChunkRepository dynamically to avoid circular dependency
    const { ChunkRepository } = await import('../repositories/chunk.repository.js');
    const chunkRepository = new ChunkRepository();
    
    // Get all chunks for this file
    const chunks = await chunkRepository.getChunksByFileId(fileId);
    
    logger.info({ fileId, chunkCount: chunks.length }, 'Deleting chunked file');
    
    // Delete each chunk from cloud storage
    const deletePromises = chunks.map(async (chunk) => {
      try {
        const { AccountRepository } = await import('../repositories/account.repository.js');
        const accountRepository = new AccountRepository();
        const account = await accountRepository.findById(chunk.accountId);
        
        if (!account) {
          logger.warn({ chunkId: chunk.id, accountId: chunk.accountId }, 'Account not found for chunk, skipping');
          return;
        }
        
        const provider = this.providerFactory.getProvider(chunk.providerType);
        await provider.deleteFile(account, chunk.providerFileId);
        
        logger.debug({ chunkId: chunk.id, chunkIndex: chunk.chunkIndex }, 'Chunk deleted from storage');
      } catch (error) {
        logger.error({ chunkId: chunk.id, error }, 'Failed to delete chunk from storage');
        // Continue with other chunks even if one fails
      }
    });
    
    // Wait for all deletions to complete
    await Promise.allSettled(deletePromises);
    
    // Delete chunk records from database
    await chunkRepository.deleteChunksByFileId(fileId);
    
    logger.info({ fileId }, 'All chunks deleted');
  }

  async listFiles(options: any = {}) {
    return this.fileRepository.list(options);
  }

  async getCategories(fileType: 'image' | 'video') {
    return this.fileRepository.getCategories(fileType);
  }

  async getFileMetadata(fileId: string): Promise<FileRecord> {
    const file = await this.fileRepository.findById(fileId);
    
    if (!file) {
      throw new FileNotFoundError(fileId);
    }
    
    return file;
  }

  async regenerateThumbnail(fileId: string): Promise<string> {
    const candidates = await this.generateThumbnailCandidates(fileId, 1);
    const thumbnailData = candidates[0];
    await this.fileRepository.update(fileId, { thumbnailData });
    return thumbnailData;
  }

  /**
   * Generate multiple thumbnail candidates (for videos) or a high-res one (for images)
   */
  async generateThumbnailCandidates(fileId: string, count: number = 6): Promise<string[]> {
    const file = await this.fileRepository.findById(fileId);
    if (!file) throw new FileNotFoundError(fileId);

    logger.info({ fileId, filename: file.filename }, `Generating ${count} thumbnail candidates`);

    // For images, we just want one full-res high quality thumbnail
    if (file.mimeType?.startsWith('image/')) {
        const { stream } = await this.downloadFile(fileId);
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const buffer = Buffer.concat(chunks);
        const thumbnail = await this.thumbnailService.generateThumbnailFromBuffer(buffer, file.mimeType);
        return [thumbnail];
    }

    // For videos: download to local temp file first, then extract frames.
    // This is the StashApp/Plex approach — FFmpeg can seek instantly in local files,
    // unlike HTTP streams where seeking to minute 80 means downloading 80 minutes of data.
    if (file.mimeType?.startsWith('video/')) {
        const tempVideoPath = join(tmpdir(), `thumb-video-${uuidv4()}.mp4`);
        
        try {
            // Step 1: Download video to a temp file (tolerant of partial downloads)
            // For thumbnails, we only need the first few seconds of video data.
            // If a late chunk fails (e.g. chunk 69 of 70), we still have enough
            // data to extract thumbnails from the early portion of the video.
            logger.info({ fileId, filename: file.filename, size: file.size }, 'Downloading video to temp file for thumbnail extraction');
            
            const { stream } = await this.downloadFile(fileId);
            const writeStream = createWriteStream(tempVideoPath);
            const reader = stream.getReader();
            let bytesWritten = 0;
            let downloadComplete = true;
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    writeStream.write(Buffer.from(value));
                    bytesWritten += value.length;
                }
            } catch (streamError: any) {
                // A chunk download failed (e.g. missing chunk on cloud).
                // Don't throw — we can still try to extract thumbnails from
                // whatever data we already wrote to the temp file.
                downloadComplete = false;
                logger.warn({ 
                    fileId, 
                    bytesWritten, 
                    totalSize: file.size, 
                    percentDownloaded: file.size > 0 ? Math.round((bytesWritten / file.size) * 100) : 0,
                    error: streamError.message 
                }, 'Video download interrupted during thumbnail extraction, will attempt with partial data');
                
                // Release the reader to clean up rclone processes
                try { reader.cancel(); } catch {}
            }
            
            await new Promise<void>((resolve, reject) => {
                writeStream.end((err: any) => err ? reject(err) : resolve());
            });
            
            // Need at least some data to work with (at least 1MB for a usable video header)
            const MIN_BYTES_FOR_THUMBNAIL = 1024 * 1024; // 1MB
            if (bytesWritten < MIN_BYTES_FOR_THUMBNAIL) {
                throw new Error(`Insufficient video data for thumbnail extraction: only ${bytesWritten} bytes downloaded (need at least ${MIN_BYTES_FOR_THUMBNAIL})`);
            }
            
            logger.info({ fileId, bytesWritten, downloadComplete }, 'Video data ready for thumbnail extraction');
            
            // Step 2: Get duration from LOCAL file (instant)
            // For partial files, ffprobe may return a shorter/estimated duration — that's fine
            let duration = 0;
            try {
                duration = await this.thumbnailService.getVideoDuration(tempVideoPath);
            } catch (durationError: any) {
                logger.warn({ fileId, error: durationError.message }, 'Could not determine video duration, will extract from start');
            }
            
            // Step 3: Extract frames from LOCAL file (fast random-access seeking)
            if (duration > 0) {
                // For partial downloads, limit the seek range to what we actually have
                if (!downloadComplete && file.size > 0) {
                    const downloadedFraction = bytesWritten / file.size;
                    const safeDuration = duration * downloadedFraction * 0.8; // 80% safety margin
                    const effectiveDuration = Math.max(1, safeDuration);
                    logger.debug({ fileId, duration, effectiveDuration, downloadedFraction }, 'Using limited duration for partial download');
                    return await this.thumbnailService.generateMultipleVideoThumbnails(tempVideoPath, effectiveDuration, count);
                }
                return await this.thumbnailService.generateMultipleVideoThumbnails(tempVideoPath, duration, count);
            } else {
                // Duration unknown — just grab the first frame
                const thumb = await this.thumbnailService.generateVideoThumbnail(tempVideoPath, { timestamp: 1 });
                return [thumb];
            }
        } catch (error: any) {
            logger.error({ error: error.message, fileId }, 'Video thumbnail generation failed');
            throw error;
        } finally {
            // Always clean up the temp file
            try { await unlink(tempVideoPath); } catch {}
        }
    }

    throw new Error('Unsupported file type for thumbnails');
  }

  async updateFileThumbnail(fileId: string, thumbnailData: string): Promise<void> {
    await this.fileRepository.update(fileId, { thumbnailData });
    logger.info({ fileId }, 'File thumbnail updated via picker');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
