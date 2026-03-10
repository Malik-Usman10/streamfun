// Circuit breaker pattern implementation
import logger from './logger.js';

export enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Failing, reject requests
  HALF_OPEN = 'half_open' // Testing if service recovered
}

export interface CircuitBreakerOptions {
  failureThreshold: number;    // Number of failures before opening
  resetTimeout: number;         // Milliseconds before trying half-open
  successThreshold?: number;    // Successes needed in half-open to close (default: 1)
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptTime = 0;
  private readonly name: string;

  constructor(
    name: string,
    private options: CircuitBreakerOptions
  ) {
    this.name = name;
    this.options.successThreshold = options.successThreshold || 1;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error(`Circuit breaker is OPEN for ${this.name}`);
      }
      
      // Transition to half-open to test
      this.state = CircuitState.HALF_OPEN;
      this.successCount = 0;
      logger.info({ name: this.name }, 'Circuit breaker transitioning to HALF_OPEN');
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      
      if (this.successCount >= this.options.successThreshold!) {
        this.state = CircuitState.CLOSED;
        logger.info({ name: this.name }, 'Circuit breaker CLOSED after recovery');
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.successCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      // Failed during testing, go back to open
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.options.resetTimeout;
      logger.warn({ name: this.name }, 'Circuit breaker back to OPEN after half-open failure');
    } else if (this.failureCount >= this.options.failureThreshold) {
      // Too many failures, open the circuit
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.options.resetTimeout;
      logger.error(
        { name: this.name, failures: this.failureCount },
        'Circuit breaker OPENED due to failures'
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = 0;
    logger.info({ name: this.name }, 'Circuit breaker manually reset');
  }
}
