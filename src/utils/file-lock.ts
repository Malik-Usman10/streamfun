// File lock manager for concurrent access control
import fs from 'fs/promises';
import logger from './logger.js';

export class FileLockManager {
  private locks: Map<string, Promise<void>> = new Map();

  /**
   * Acquire a lock for a file path
   * Returns a release function that must be called when done
   */
  async acquireLock(filePath: string): Promise<() => void> {
    // Wait for any existing lock on this file
    while (this.locks.has(filePath)) {
      await this.locks.get(filePath);
      // Small delay to prevent tight loop
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Create a new lock promise
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(filePath, lockPromise);

    logger.debug({ filePath }, 'Acquired file lock');

    // Return the release function
    return () => {
      this.locks.delete(filePath);
      releaseLock!();
      logger.debug({ filePath }, 'Released file lock');
    };
  }

  /**
   * Execute a function with a file lock
   */
  async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquireLock(filePath);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// Singleton instance
export const fileLockManager = new FileLockManager();
