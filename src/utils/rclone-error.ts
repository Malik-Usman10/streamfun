// Custom error class for rclone operations

export class RcloneError extends Error {
  public readonly type: string;
  public readonly retryable: boolean;
  public readonly details?: Record<string, any>;

  constructor(
    message: string,
    type: string,
    retryable: boolean = true,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'RcloneError';
    this.type = type;
    this.retryable = retryable;
    this.details = details;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RcloneError);
    }
  }
}
