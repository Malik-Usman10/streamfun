// Core type definitions for StreamFun

export enum ProviderType {
  GOOGLE_DRIVE = 'google_drive',
  DROPBOX = 'dropbox',
  ONEDRIVE = 'onedrive',
  KOOFR = 'koofr',
  TERABOX = 'terabox',
  FILEN = 'filen',
  BLOMP = 'blomp',
  WEBDAV = 'webdav'
}

export enum AccountStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error'
}

export interface Account {
  id: string;
  providerType: ProviderType;
  credentialsEncrypted: string;
  tokensEncrypted?: string;
  accountIdentifier?: string;
  status: AccountStatus;
  quotaTotal?: number;
  quotaUsed?: number;
  quotaAvailable?: number;
  quotaUsagePercent?: number;
  quotaLastCheckedAt?: Date;
  lastUsedAt?: Date;
  lastHealthCheckAt?: Date;
  healthLatency?: number;
  healthError?: string;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FileRecord {
  id: string;
  filename: string;
  mimeType?: string;
  size: number;
  providerType: ProviderType;
  accountId: string;
  providerFileId: string;
  isChunked: boolean;
  encryptionKey?: string;
  encryptionIv?: string;
  category?: string;
  collectionName?: string;
  chunkSize?: number;
  thumbnailData?: string;
  metadata?: Record<string, any>;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChunkMetadata {
  id: string;
  fileId: string;
  chunkIndex: number;
  chunkSize: number;
  accountId: string;
  providerType: ProviderType;
  providerFileId: string;
  uploadedAt: Date;
}

export interface BandwidthUsage {
  id: string;
  accountId: string;
  operationType: 'upload' | 'download';
  bytesTransferred: number;
  timestamp: Date;
  timeWindow: 'hourly' | 'daily' | 'monthly';
}

export interface ApiKey {
  id: string;
  keyHash: string;
  name: string;
  permissions: Record<string, boolean>;
  isAdmin: boolean;
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  eventType: string;
  accountId?: string;
  fileId?: string;
  apiKeyId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  timestamp: Date;
}
