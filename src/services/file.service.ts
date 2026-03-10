// File service for file operations
import { FileRepository } from '../repositories/file.repository.js';
import { AccountRotator } from './account-rotator.service.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import { TokenManager } from './token-manager.service.js';
import { BandwidthTracker } from './bandwidth-tracker.service.js';
import { FileEncryptionService } from './file-encryption.service.js';
import type { ChunkManager } from './chunk-manager.service.js';
import type { FileRecord, ProviderType } from '../types/index.js';
import type { FileUpload } from '../types/provider.js';
import { UploadError, DownloadError, FileNotFoundError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export class FileService {
  constructor(
    private fileRepository: FileRepository,
    private accountRotator: AccountRotator,
    private providerFactory: ProviderFactory,
    private tokenManager: TokenManager,
    private bandwidthTracker: BandwidthTracker,
    private encryptionService: FileEncryptionService,
    private chunkManager?: ChunkManager
  ) {}

  async uploadFile(
    providerType: ProviderType,
    file: FileUpload,
    encrypt: boolean = true
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
    });
    
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

  private async uploadWithRetry(
    provider: any,
    account: any,
    file: FileUpload,
    maxRetries: number = 3
  ): Promise<any> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await provider.uploadFile(account, file);
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

  async downloadFile(fileId: string): Promise<{ stream: ReadableStream; file: FileRecord }> {
    const file = await this.fileRepository.findById(fileId);
    
    if (!file) {
      throw new FileNotFoundError(fileId);
    }
    
    // Handle chunked files differently
    if (file.isChunked) {
      return await this.downloadChunkedFile(fileId, file);
    }
    
    const account = await this.accountRotator.selectAccountForDownload(
      file.providerType,
      file.size
    );
    const provider = this.providerFactory.getProvider(file.providerType);
    
    await this.tokenManager.refreshIfNeeded(account, provider);
    
    let stream = await provider.downloadFile(account, file.providerFileId);
    
    // Decrypt if encrypted
    if (file.encryptionKey && file.encryptionIv) {
      stream = await this.encryptionService.decryptFile(stream, file.encryptionKey, file.encryptionIv);
    }
    
    await this.bandwidthTracker.recordUsage(account.id, 'download', file.size);
    
    return { stream, file };
  }

  private async downloadChunkedFile(fileId: string, file: FileRecord): Promise<{ stream: ReadableStream; file: FileRecord }> {
    if (!this.chunkManager) {
      throw new Error('ChunkManager not available for chunked file download');
    }
    
    logger.info({ fileId }, 'Downloading chunked file');
    
    // Use ChunkManager to download and reconstruct file
    const stream = await this.chunkManager.downloadFileInChunks(fileId);
    
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

  async getFileMetadata(fileId: string): Promise<FileRecord> {
    const file = await this.fileRepository.findById(fileId);
    
    if (!file) {
      throw new FileNotFoundError(fileId);
    }
    
    return file;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
