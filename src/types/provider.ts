// Provider abstraction types
import type { Account, ProviderType } from './index.js';

export interface ProviderCredentials {
  type: 'oauth' | 'session' | 'api_key';
  data: Record<string, any>;
}

export interface AuthResult {
  success: boolean;
  tokens?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: Date;
  };
  sessionData?: Record<string, any>;
  error?: string;
}

export interface TokenRefreshResult {
  success: boolean;
  newAccessToken?: string;
  expiresAt?: Date;
  error?: string;
}

export interface FileUpload {
  filename: string;
  mimeType: string;
  size: number;
  stream: ReadableStream;
  metadata?: Record<string, any>;
}

export interface UploadResult {
  success: boolean;
  fileId: string;
  providerFileId: string;
  size: number;
  uploadedAt: Date;
  error?: string;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export interface ListOptions {
  pageSize?: number;
  pageToken?: string;
}

export interface FileList {
  files: FileMetadata[];
  nextPageToken?: string;
}

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  createdAt: Date;
  modifiedAt: Date;
}

export interface StreamingLink {
  url: string;
  expiresAt: Date;
  headers?: Record<string, string>;
}

export interface QuotaInfo {
  total: number;
  used: number;
  available: number;
  unit: 'bytes';
}

export interface HealthStatus {
  healthy: boolean;
  latency: number;
  error?: string;
}

export interface IStorageProvider {
  readonly providerName: string;
  readonly providerType: ProviderType;
  
  authenticate(credentials: ProviderCredentials): Promise<AuthResult>;
  refreshToken(account: Account): Promise<TokenRefreshResult>;
  validateToken(account: Account): Promise<boolean>;
  
  uploadFile(account: Account, file: FileUpload): Promise<UploadResult>;
  uploadFromUrl?(account: Account, url: string, filename: string): Promise<UploadResult>;
  downloadFile(account: Account, fileId: string): Promise<ReadableStream>;
  deleteFile(account: Account, fileId: string): Promise<DeleteResult>;
  listFiles(account: Account, options: ListOptions): Promise<FileList>;
  getFileMetadata(account: Account, fileId: string): Promise<FileMetadata>;
  
  generateStreamingLink(account: Account, fileId: string): Promise<StreamingLink>;
  getQuotaInfo(account: Account): Promise<QuotaInfo>;
  healthCheck(account: Account): Promise<HealthStatus>;
}
