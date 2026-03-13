import { pool } from '../database/connection.js';
import logger from '../utils/logger.js';

export interface SettingRecord {
  key: string;
  value: string;
  updatedAt: Date;
}

export class SettingsRepository {
  /**
   * Get a setting by key
   */
  async get(key: string): Promise<string | null> {
    const result = await pool.query<SettingRecord>(
      'SELECT value FROM settings WHERE key = $1',
      [key]
    );

    return result.rows.length > 0 ? result.rows[0].value : null;
  }

  /**
   * Set a setting value
   */
  async set(key: string, value: string): Promise<void> {
    await pool.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
     logger.debug({ key }, 'Setting updated');
  }

  /**
   * Delete a setting
   */
  async delete(key: string): Promise<void> {
    await pool.query('DELETE FROM settings WHERE key = $1', [key]);
    logger.debug({ key }, 'Setting deleted');
  }
}
