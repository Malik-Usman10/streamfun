// Error parsing utilities for rclone errors

export enum RcloneErrorType {
  TIMEOUT = 'timeout',
  AUTH_FAILURE = 'auth_failure',
  QUOTA_EXCEEDED = 'quota_exceeded',
  NOT_FOUND = 'not_found',
  NETWORK_ERROR = 'network_error',
  PERMISSION_DENIED = 'permission_denied',
  INVALID_CONFIG = 'invalid_config',
  RATE_LIMIT = 'rate_limit',
  UNKNOWN = 'unknown'
}

export interface ParsedError {
  type: RcloneErrorType;
  originalMessage: string;
  userFriendlyMessage: string;
  suggestions?: string[];
}

export class ErrorParser {
  /**
   * Parse rclone error output and generate user-friendly message
   */
  static parseRcloneError(stderr: string): ParsedError {
    const lowerError = stderr.toLowerCase();

    // Timeout errors
    if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
      return {
        type: RcloneErrorType.TIMEOUT,
        originalMessage: stderr,
        userFriendlyMessage: 'Connection timed out. The remote server is not responding.',
        suggestions: [
          'Check your internet connection',
          'Verify the remote URL is correct',
          'Try again in a few moments'
        ]
      };
    }

    // Authentication failures
    if (
      lowerError.includes('auth') ||
      lowerError.includes('unauthorized') ||
      lowerError.includes('401') ||
      lowerError.includes('403') ||
      lowerError.includes('invalid credentials') ||
      lowerError.includes('access denied')
    ) {
      return {
        type: RcloneErrorType.AUTH_FAILURE,
        originalMessage: stderr,
        userFriendlyMessage: 'Authentication failed. Your credentials are invalid or expired.',
        suggestions: [
          'Verify your username and password are correct',
          'Check if your access token has expired',
          'Re-authenticate with the provider'
        ]
      };
    }

    // Quota exceeded
    if (
      lowerError.includes('quota') ||
      lowerError.includes('storage full') ||
      lowerError.includes('insufficient storage') ||
      lowerError.includes('out of space')
    ) {
      return {
        type: RcloneErrorType.QUOTA_EXCEEDED,
        originalMessage: stderr,
        userFriendlyMessage: 'Storage quota exceeded. The remote storage is full.',
        suggestions: [
          'Free up space on the remote storage',
          'Upgrade your storage plan',
          'Use a different storage account'
        ]
      };
    }

    // Not found errors
    if (
      lowerError.includes('not found') ||
      lowerError.includes('404') ||
      lowerError.includes('no such') ||
      lowerError.includes('doesn\'t exist')
    ) {
      return {
        type: RcloneErrorType.NOT_FOUND,
        originalMessage: stderr,
        userFriendlyMessage: 'Remote or file not found.',
        suggestions: [
          'Verify the remote name is correct',
          'Check if the remote still exists',
          'Ensure the file path is valid'
        ]
      };
    }

    // Network errors
    if (
      lowerError.includes('network') ||
      lowerError.includes('connection refused') ||
      lowerError.includes('connection reset') ||
      lowerError.includes('no route to host') ||
      lowerError.includes('dns')
    ) {
      return {
        type: RcloneErrorType.NETWORK_ERROR,
        originalMessage: stderr,
        userFriendlyMessage: 'Network error. Unable to connect to the remote server.',
        suggestions: [
          'Check your internet connection',
          'Verify the remote URL is accessible',
          'Check if a firewall is blocking the connection'
        ]
      };
    }

    // Permission denied
    if (
      lowerError.includes('permission denied') ||
      lowerError.includes('forbidden') ||
      lowerError.includes('access is denied')
    ) {
      return {
        type: RcloneErrorType.PERMISSION_DENIED,
        originalMessage: stderr,
        userFriendlyMessage: 'Permission denied. You don\'t have access to this resource.',
        suggestions: [
          'Check if you have the necessary permissions',
          'Verify your account has access to this folder',
          'Contact the storage administrator'
        ]
      };
    }

    // Invalid configuration
    if (
      lowerError.includes('invalid config') ||
      lowerError.includes('bad config') ||
      lowerError.includes('config error') ||
      lowerError.includes('unknown backend')
    ) {
      return {
        type: RcloneErrorType.INVALID_CONFIG,
        originalMessage: stderr,
        userFriendlyMessage: 'Invalid configuration. The remote settings are incorrect.',
        suggestions: [
          'Check your configuration parameters',
          'Verify the provider type is correct',
          'Re-create the remote with correct settings'
        ]
      };
    }

    // Rate limiting
    if (
      lowerError.includes('rate limit') ||
      lowerError.includes('too many requests') ||
      lowerError.includes('429')
    ) {
      return {
        type: RcloneErrorType.RATE_LIMIT,
        originalMessage: stderr,
        userFriendlyMessage: 'Rate limit exceeded. Too many requests to the server.',
        suggestions: [
          'Wait a few minutes before trying again',
          'Reduce the number of concurrent operations',
          'Check your API usage limits'
        ]
      };
    }

    // Unknown error
    return {
      type: RcloneErrorType.UNKNOWN,
      originalMessage: stderr,
      userFriendlyMessage: 'An unexpected error occurred.',
      suggestions: [
        'Check the error details below',
        'Try the operation again',
        'Contact support if the problem persists'
      ]
    };
  }

  /**
   * Generate user-friendly error message from any error
   */
  static getUserFriendlyMessage(error: any): string {
    if (typeof error === 'string') {
      const parsed = this.parseRcloneError(error);
      return parsed.userFriendlyMessage;
    }

    if (error instanceof Error) {
      const parsed = this.parseRcloneError(error.message);
      return parsed.userFriendlyMessage;
    }

    return 'An unexpected error occurred. Please try again.';
  }

  /**
   * Check if error is retryable
   */
  static isRetryable(errorType: RcloneErrorType): boolean {
    const retryableErrors = [
      RcloneErrorType.TIMEOUT,
      RcloneErrorType.NETWORK_ERROR,
      RcloneErrorType.RATE_LIMIT
    ];

    return retryableErrors.includes(errorType);
  }

  /**
   * Get retry delay in milliseconds based on error type
   */
  static getRetryDelay(errorType: RcloneErrorType, attemptNumber: number): number {
    switch (errorType) {
      case RcloneErrorType.RATE_LIMIT:
        // Exponential backoff for rate limits
        return Math.min(1000 * Math.pow(2, attemptNumber), 60000);
      case RcloneErrorType.TIMEOUT:
      case RcloneErrorType.NETWORK_ERROR:
        // Linear backoff for network issues
        return Math.min(2000 * attemptNumber, 10000);
      default:
        return 1000;
    }
  }
}
