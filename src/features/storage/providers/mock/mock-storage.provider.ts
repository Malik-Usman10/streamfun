// Mock storage provider for testing
import type {
  IStorageProvider,
  ProviderCredentials,
  AuthResult,
  TokenRefreshResult,
  FileUpload,
  UploadResult,
  DeleteResult,
  ListOptions,
  FileList,
  FileMetadata,
  StreamingLink,
  QuotaInfo,
  HealthStatus,
} from '../../../shared/types/provider.js';
import type { Account, ProviderType } from '../../../shared/types/index.js';
import { v4 as uuidv4 } from 'uuid';

export class MockStorageProvider implements IStorageProvider {
  readonly providerName: string;
  readonly providerType: ProviderType;
  
  private files: Map<string, { data: Buffer; metadata: FileMetadata }> = new Map();
  private quotaUsed = 0;
  private quotaTotal = 100 * 1024 * 1024 * 1024; // 100 GB

  constructor(providerType: ProviderType) {
    this.providerType = providerType;
    this.providerName = `Mock ${providerType}`;
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    return {
      success: true,
      tokens: {
        accessToken: 'mock_access_token',
        refreshToken: 'mock_refresh_token',
        expiresAt: new Date(Date.now() + 3600000),
      },
    };
  }

  async refreshToken(account: Account): Promise<TokenRefreshResult> {
    return {
      success: true,
      newAccessToken: 'mock_refreshed_token',
      expiresAt: new Date(Date.now() + 3600000),
    };
  }

  async validateToken(account: Account): Promise<boolean> {
    return true;
  }

  async uploadFile(account: Account, file: FileUpload, signal?: AbortSignal): Promise<UploadResult> {
    const fileId = uuidv4();
    const chunks: Buffer[] = [];
    
    // Read stream into buffer
    const reader = file.stream.getReader();
    while (true) {
      if (signal?.aborted) {
        throw new Error('Upload aborted');
      }
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    
    const data = Buffer.concat(chunks);
    
    this.files.set(fileId, {
      data,
      metadata: {
        id: fileId,
        name: file.filename,
        size: file.size,
        mimeType: file.mimeType,
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
    });
    
    this.quotaUsed += file.size;
    
    return {
      success: true,
      fileId,
      providerFileId: fileId,
      size: file.size,
      uploadedAt: new Date(),
    };
  }

  async downloadFile(account: Account, fileId: string, signal?: AbortSignal): Promise<ReadableStream> {
    const file = this.files.get(fileId);
    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }
    
    if (signal?.aborted) {
       throw new Error('Download aborted');
    }
    
    return new ReadableStream({
      start(controller) {
        controller.enqueue(file.data);
        controller.close();
      },
    });
  }

  async deleteFile(account: Account, fileId: string): Promise<DeleteResult> {
    const file = this.files.get(fileId);
    if (file) {
      this.quotaUsed -= file.metadata.size;
      this.files.delete(fileId);
    }
    
    return { success: true };
  }

  async listFiles(account: Account, options: ListOptions): Promise<FileList> {
    const files = Array.from(this.files.values()).map((f) => f.metadata);
    
    return {
      files: files.slice(0, options.pageSize || 50),
      nextPageToken: undefined,
    };
  }

  async getFileMetadata(account: Account, fileId: string): Promise<FileMetadata> {
    const file = this.files.get(fileId);
    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }
    
    return file.metadata;
  }

  async generateStreamingLink(account: Account, fileId: string): Promise<StreamingLink> {
    return {
      url: `https://mock-cdn.example.com/stream/${fileId}`,
      expiresAt: new Date(Date.now() + 3600000),
    };
  }

  async getQuotaInfo(account: Account): Promise<QuotaInfo> {
    return {
      total: this.quotaTotal,
      used: this.quotaUsed,
      available: this.quotaTotal - this.quotaUsed,
      unit: 'bytes',
    };
  }

  async healthCheck(account: Account): Promise<HealthStatus> {
    return {
      healthy: true,
      latency: 50,
    };
  }
}
