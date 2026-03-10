// Custom error classes for StreamFun

export class StreamFunError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NoAvailableAccountError extends StreamFunError {
  constructor(message: string) {
    super(message, 503, 'NO_AVAILABLE_ACCOUNT');
  }
}

export class FileNotFoundError extends StreamFunError {
  constructor(fileId: string) {
    super(`File not found: ${fileId}`, 404, 'FILE_NOT_FOUND');
  }
}

export class UploadError extends StreamFunError {
  constructor(message: string, public originalError?: Error) {
    super(message, 500, 'UPLOAD_ERROR');
  }
}

export class DownloadError extends StreamFunError {
  constructor(message: string, public originalError?: Error) {
    super(message, 500, 'DOWNLOAD_ERROR');
  }
}

export class TokenRefreshError extends StreamFunError {
  constructor(message?: string) {
    super(message || 'Token refresh failed', 401, 'TOKEN_REFRESH_ERROR');
  }
}

export class UnsupportedProviderError extends StreamFunError {
  constructor(providerType: string) {
    super(`Unsupported provider: ${providerType}`, 400, 'UNSUPPORTED_PROVIDER');
  }
}

export class AuthenticationError extends StreamFunError {
  constructor(message: string) {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends StreamFunError {
  constructor(message: string) {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class ValidationError extends StreamFunError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class EncryptionError extends StreamFunError {
  constructor(message: string) {
    super(message, 500, 'ENCRYPTION_ERROR');
  }
}

export class ChunkUploadError extends StreamFunError {
  constructor(message: string, public chunkIndex?: number) {
    super(message, 500, 'CHUNK_UPLOAD_ERROR');
  }
}
