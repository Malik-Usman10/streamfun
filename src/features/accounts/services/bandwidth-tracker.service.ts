// Bandwidth tracker for monitoring account usage
import { pool } from '../../../database/connection.js';
import logger from '../../../shared/utils/logger.js';

export type TimeWindow = 'hourly' | 'daily' | 'monthly';
export type OperationType = 'upload' | 'download';

export class BandwidthTracker {
  async recordUsage(
    accountId: string,
    operationType: OperationType,
    bytesTransferred: number
  ): Promise<void> {
    const timestamp = new Date();
    
    // Record for all time windows
    const windows: TimeWindow[] = ['hourly', 'daily', 'monthly'];
    
    for (const window of windows) {
      await pool.query(
        `INSERT INTO bandwidth_usage 
         (account_id, operation_type, bytes_transferred, timestamp, time_window)
         VALUES ($1, $2, $3, $4, $5)`,
        [accountId, operationType, bytesTransferred, timestamp, window]
      );
    }
    
    logger.debug(
      { accountId, operationType, bytesTransferred },
      'Bandwidth usage recorded'
    );
  }

  async getUsagePercent(
    accountId: string,
    window: TimeWindow = 'hourly',
    limit: number = 10 * 1024 * 1024 * 1024 // 10 GB default
  ): Promise<number> {
    const windowStart = this.getWindowStart(window);
    
    const result = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(bytes_transferred), 0) as total
       FROM bandwidth_usage
       WHERE account_id = $1 
       AND time_window = $2 
       AND timestamp >= $3`,
      [accountId, window, windowStart]
    );
    
    const totalBytes = parseInt(result.rows[0].total, 10);
    return (totalBytes / limit) * 100;
  }

  async getTotalUsage(
    accountId: string,
    window: TimeWindow = 'hourly'
  ): Promise<number> {
    const windowStart = this.getWindowStart(window);
    
    const result = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(bytes_transferred), 0) as total
       FROM bandwidth_usage
       WHERE account_id = $1 
       AND time_window = $2 
       AND timestamp >= $3`,
      [accountId, window, windowStart]
    );
    
    return parseInt(result.rows[0].total, 10);
  }

  private getWindowStart(window: TimeWindow): Date {
    const now = new Date();
    
    switch (window) {
      case 'hourly':
        return new Date(now.getTime() - 60 * 60 * 1000);
      case 'daily':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case 'monthly':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }
}
