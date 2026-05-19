// Account repository for managing storage provider accounts
import { pool } from '../../../database/connection.js';
import type { Account, ProviderType, AccountStatus } from '../../shared/types/index.js';
import logger from '../../shared/utils/logger.js';

export class AccountRepository {
  async create(data: {
    providerType: ProviderType;
    credentialsEncrypted: string;
    tokensEncrypted?: string;
    accountIdentifier?: string;
  }): Promise<Account> {
    const result = await pool.query<Account>(
      `INSERT INTO accounts (provider_type, credentials_encrypted, tokens_encrypted, account_identifier)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.providerType, data.credentialsEncrypted, data.tokensEncrypted, data.accountIdentifier]
    );
    
    return this.mapRow(result.rows[0]);
  }

  async findByIdentifier(providerType: ProviderType, accountIdentifier: string): Promise<Account | null> {
    const result = await pool.query<Account>(
      'SELECT * FROM accounts WHERE provider_type = $1 AND account_identifier = $2',
      [providerType, accountIdentifier]
    );
    
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async findById(id: string): Promise<Account | null> {
    const result = await pool.query<Account>(
      'SELECT * FROM accounts WHERE id = $1',
      [id]
    );
    
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async findAll(): Promise<Account[]> {
    const result = await pool.query<Account>('SELECT * FROM accounts ORDER BY created_at DESC');
    return result.rows.map(this.mapRow);
  }

  async findActiveByProvider(providerType: ProviderType): Promise<Account[]> {
    const result = await pool.query<Account>(
      `SELECT * FROM accounts 
       WHERE provider_type = $1 AND status = 'active'
       ORDER BY last_used_at ASC NULLS FIRST`,
      [providerType]
    );
    
    return result.rows.map(this.mapRow);
  }

  async findWithExpiringTokens(minutesUntilExpiry: number): Promise<Account[]> {
    const result = await pool.query<Account>(
      `SELECT * FROM accounts 
       WHERE tokens_encrypted IS NOT NULL 
       AND status = 'active'`
    );
    
    return result.rows.map(this.mapRow);
  }

  async updateTokens(accountId: string, tokensEncrypted: string): Promise<void> {
    await pool.query(
      'UPDATE accounts SET tokens_encrypted = $1, updated_at = NOW() WHERE id = $2',
      [tokensEncrypted, accountId]
    );
  }

  async getTokens(accountId: string): Promise<string> {
    const result = await pool.query<{ tokens_encrypted: string }>(
      'SELECT tokens_encrypted FROM accounts WHERE id = $1',
      [accountId]
    );
    
    if (result.rows.length === 0 || !result.rows[0].tokens_encrypted) {
      throw new Error('No tokens found for account');
    }
    
    return result.rows[0].tokens_encrypted;
  }

  async updateQuota(
    accountId: string,
    quota: {
      total: number;
      used: number;
      available: number;
      usagePercent: number;
      lastCheckedAt: Date;
    }
  ): Promise<void> {
    await pool.query(
      `UPDATE accounts 
       SET quota_total = $1, quota_used = $2, quota_available = $3, 
           quota_usage_percent = $4, quota_last_checked_at = $5, updated_at = NOW()
       WHERE id = $6`,
      [
        quota.total,
        quota.used,
        quota.available,
        quota.usagePercent,
        quota.lastCheckedAt,
        accountId,
      ]
    );
  }

  async updateHealth(
    accountId: string,
    health: {
      status: AccountStatus;
      lastCheckedAt: Date;
      latency?: number;
      error?: string;
    }
  ): Promise<void> {
    await pool.query(
      `UPDATE accounts 
       SET status = $1, last_health_check_at = $2, health_latency = $3, 
           health_error = $4, updated_at = NOW()
       WHERE id = $5`,
      [health.status, health.lastCheckedAt, health.latency, health.error, accountId]
    );
  }

  async markInactive(accountId: string): Promise<void> {
    await pool.query(
      `UPDATE accounts SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [accountId]
    );
  }

  async updateLastUsed(accountId: string): Promise<void> {
    await pool.query(
      'UPDATE accounts SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1',
      [accountId]
    );
  }

  async incrementFailures(accountId: string): Promise<void> {
    await pool.query(
      `UPDATE accounts 
       SET consecutive_failures = consecutive_failures + 1, updated_at = NOW()
       WHERE id = $1`,
      [accountId]
    );
  }

  async resetFailures(accountId: string): Promise<void> {
    await pool.query(
      'UPDATE accounts SET consecutive_failures = 0, updated_at = NOW() WHERE id = $1',
      [accountId]
    );
  }

  async delete(accountId: string): Promise<void> {
    await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
  }

  private mapRow(row: any): Account {
    return {
      id: row.id,
      providerType: row.provider_type,
      credentialsEncrypted: row.credentials_encrypted,
      tokensEncrypted: row.tokens_encrypted,
      accountIdentifier: row.account_identifier,
      status: row.status,
      quotaTotal: row.quota_total,
      quotaUsed: row.quota_used,
      quotaAvailable: row.quota_available,
      quotaUsagePercent: row.quota_usage_percent ? parseFloat(row.quota_usage_percent) : undefined,
      quotaLastCheckedAt: row.quota_last_checked_at,
      lastUsedAt: row.last_used_at,
      lastHealthCheckAt: row.last_health_check_at,
      healthLatency: row.health_latency,
      healthError: row.health_error,
      consecutiveFailures: row.consecutive_failures,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
