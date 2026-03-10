// Retry utility with exponential backoff
import logger from './logger.js';

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay?: number; // milliseconds
  onRetry?: (error: Error, attempt: number) => void;
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelay, maxDelay = 30000, onRetry } = options;
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        logger.error(
          { error: lastError.message, attempts: attempt + 1 },
          'Operation failed after max retries'
        );
        throw new Error(
          `Operation failed after ${maxRetries + 1} attempts: ${lastError.message}`
        );
      }

      // Calculate exponential backoff delay: baseDelay * 2^attempt
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      logger.warn(
        { error: lastError.message, attempt: attempt + 1, nextRetryIn: delay },
        'Operation failed, retrying with backoff'
      );

      if (onRetry) {
        onRetry(lastError, attempt + 1);
      }

      await sleep(delay);
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
