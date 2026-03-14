// Integration service between rclone configs and StreamFun accounts
import { spawn } from 'child_process';
import { RcloneConfigService, RcloneRemote } from './rclone-config.service.js';
import { AccountService } from './account.service.js';
import type { ProviderType } from '../types/index.js';
import logger from '../utils/logger.js';

export interface CreateRemoteParams {
  remoteName: string;
  providerType: ProviderType;
  remoteConfig: RcloneRemote;
  accountIdentifier?: string;
  remotePath?: string; // Optional path within the remote (e.g., bucket name for Blomp)
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  error?: string;
}

export class RcloneIntegrationService {
  constructor(
    private rcloneConfigService: RcloneConfigService,
    private accountService: AccountService
  ) {}

  /**
   * Create rclone remote and corresponding account entry
   */
  async createRemoteWithAccount(params: CreateRemoteParams): Promise<{ remote: RcloneRemote; accountId: string }> {
    const { remoteName, providerType, remoteConfig, accountIdentifier, remotePath } = params;

    try {
      // First, add the remote to rclone config
      await this.rcloneConfigService.addRemote(remoteConfig);

      logger.info({ remoteName, providerType }, 'Created rclone remote');

      // Then create the account entry in database using registerAccount
      const credentials = {
        type: 'session' as const,
        data: {
          remoteName,
          ...(remotePath && { remotePath }), // Include remotePath if provided (e.g., for Blomp bucket)
          ...remoteConfig.config
        }
      };

      const account = await this.accountService.registerAccount(providerType, credentials);

      logger.info({ remoteName, accountId: account.id }, 'Created account entry for rclone remote');

      return {
        remote: remoteConfig,
        accountId: account.id
      };
    } catch (error: any) {
      // Rollback: try to remove the remote if account creation failed
      try {
        await this.rcloneConfigService.deleteRemote(remoteName);
        logger.info({ remoteName }, 'Rolled back rclone remote after account creation failure');
      } catch (rollbackError) {
        logger.error({ rollbackError, remoteName }, 'Failed to rollback rclone remote');
      }

      logger.error({ error, remoteName }, 'Failed to create remote with account');
      throw new Error(`Failed to create remote with account: ${error.message}`);
    }
  }

  /**
   * Delete rclone remote and corresponding account entry (cascading delete)
   */
  async deleteRemoteWithAccount(remoteName: string): Promise<void> {
    try {
      // First, find the account by account identifier (which is the remote name)
      const accounts = await this.accountService.listAccounts();
      const account = accounts.find(a => a.accountIdentifier === remoteName);

      // Delete the rclone remote
      await this.rcloneConfigService.deleteRemote(remoteName);
      logger.info({ remoteName }, 'Deleted rclone remote');

      // Delete the account if found
      if (account) {
        await this.accountService.deleteAccount(account.id);
        logger.info({ remoteName, accountId: account.id }, 'Deleted account entry');
      } else {
        logger.warn({ remoteName }, 'No account found for remote, skipping account deletion');
      }
    } catch (error: any) {
      logger.error({ error, remoteName }, 'Failed to delete remote with account');
      throw new Error(`Failed to delete remote with account: ${error.message}`);
    }
  }

  /**
   * Update rclone remote and synchronize with account entry
   */
  async updateRemoteWithAccount(
    remoteName: string,
    updates: Partial<Omit<RcloneRemote, 'name'>>,
    accountUpdates?: { credentials: any }
  ): Promise<void> {
    try {
      // Update rclone remote
      await this.rcloneConfigService.updateRemote(remoteName, updates);
      logger.info({ remoteName }, 'Updated rclone remote');

      // Update account if updates provided
      if (accountUpdates && accountUpdates.credentials) {
        const accounts = await this.accountService.listAccounts();
        const account = accounts.find(a => a.accountIdentifier === remoteName);

        if (account) {
          await this.accountService.updateAccount(account.id, accountUpdates.credentials);
          logger.info({ remoteName, accountId: account.id }, 'Updated account entry');
        } else {
          logger.warn({ remoteName }, 'No account found for remote, skipping account update');
        }
      }
    } catch (error: any) {
      logger.error({ error, remoteName }, 'Failed to update remote with account');
      throw new Error(`Failed to update remote with account: ${error.message}`);
    }
  }

  /**
   * Test connection to a remote using rclone lsd command
   */
  async testConnection(remoteName: string, timeoutMs: number = 10000, remotePath?: string): Promise<ConnectionTestResult> {
    return new Promise((resolve) => {
      // rclone requires a colon after the remote name to list its contents
      // e.g. `rclone lsd myremote:` or `rclone lsd myremote:path/to/dir`
      const targetPath = remotePath ? (remotePath.startsWith('/') ? remotePath.substring(1) : remotePath) : '';
      const remoteTarget = `${remoteName}:${targetPath}`;
      logger.debug({ remoteName, remotePath, remoteTarget }, 'Testing connection with target');
      const process = spawn('rclone', ['lsd', remoteTarget]);

      let output = '';
      let error = '';
      let timedOut = false;

      // Set timeout
      const timeout = setTimeout(() => {
        timedOut = true;
        process.kill();
        resolve({
          success: false,
          message: 'Connection test timed out',
          error: 'Timeout after 10 seconds'
        });
      }, timeoutMs);

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        error += data.toString();
      });

      process.on('close', (code) => {
        if (timedOut) return;

        clearTimeout(timeout);

        if (code === 0) {
          logger.info({ remoteName }, 'Connection test successful');
          resolve({
            success: true,
            message: 'Connection successful'
          });
        } else {
          logger.warn({ remoteName, error }, 'Connection test failed');
          resolve({
            success: false,
            message: 'Connection failed',
            error: error.trim() || 'Unknown error'
          });
        }
      });

      process.on('error', (err) => {
        if (timedOut) return;

        clearTimeout(timeout);
        logger.error({ error: err, remoteName }, 'Connection test error');
        resolve({
          success: false,
          message: 'Connection test error',
          error: err.message
        });
      });
    });
  }

  /**
   * Get remote info including connection status
   * @param remoteName Name of the remote
   * @param skipTest If true, don't run active connection test, use cached info
   */
  async getRemoteInfo(remoteName: string, skipTest: boolean = false): Promise<{
    remote: RcloneRemote | null;
    account: any | null;
    connectionStatus: ConnectionTestResult;
  }> {
    try {
      // Get remote from rclone config
      const remote = await this.rcloneConfigService.getRemote(remoteName);

      // Get account from database
      const accounts = await this.accountService.listAccounts();
      const account = accounts.find(a => a.accountIdentifier === remoteName) || null;

      // Extract remotePath from rclone config if available
      // For Swift/Blomp, use the user field (email) as fallback
      let remotePath = remote?.config.remotePath;
      if (!remotePath && remote?.type === 'swift' && remote.config.user) {
        remotePath = remote.config.user;
        logger.debug({ remoteName, remotePath }, 'Using user field as remotePath for Swift remote');
      }

      // Determine connection status
      let connectionStatus: ConnectionTestResult;
      
      if (!remote) {
        connectionStatus = { success: false, message: 'Remote not found', error: 'Remote does not exist' };
      } else if (skipTest && account) {
        // Use cached status from database
        connectionStatus = {
          success: account.status === 'active',
          message: account.healthError || (account.status === 'active' ? 'Online' : 'Offline'),
          error: account.healthError
        };
      } else {
        // Run active connection test
        connectionStatus = await this.testConnection(remoteName, 10000, remotePath);
      }

      return {
        remote,
        account,
        connectionStatus
      };
    } catch (error: any) {
      logger.error({ error, remoteName }, 'Failed to get remote info');
      throw new Error(`Failed to get remote info: ${error.message}`);
    }
  }

  /**
   * List all remotes with their account info (quick fetch, no connection test)
   */
  async listRemotesWithAccounts(): Promise<Array<{
    remote: RcloneRemote;
    account: any | null;
  }>> {
    try {
      const remotes = await this.rcloneConfigService.listRemotes();
      
      // Try to get accounts, but don't fail if it doesn't work
      let accounts: any[] = [];
      try {
        accounts = await this.accountService.listAccounts();
      } catch (accountError: any) {
        logger.warn({ error: accountError.message }, 'Failed to list accounts, continuing without account data');
      }

      const results = await Promise.all(
        remotes.map(async (remote) => {
          const account = accounts.find(a => a.accountIdentifier === remote.name) || null;
          
          return {
            remote,
            account
          };
        })
      );

      return results;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, 'Failed to list remotes with status');
      throw new Error(`Failed to list remotes with status: ${error.message}`);
    }
  }

  /**
   * Get quota information for a remote using rclone about command
   * Note: Many WebDAV providers don't support the 'about' command
   */
  async getQuotaInfo(remoteName: string, remotePath?: string): Promise<{
    total?: number;
    used?: number;
    free?: number;
    available: boolean;
  }> {
    return new Promise((resolve) => {
      // Set a timeout for the about command (15 seconds, increased to prevent initial auth timeout failures)
      const timeoutMs = 15000;
      let timedOut = false;

      const remoteTarget = remotePath ? `${remoteName}:${remotePath}` : `${remoteName}:`;
      const process = spawn('rclone', ['about', remoteTarget, '--json']);

      let output = '';
      let error = '';

      const timeout = setTimeout(() => {
        timedOut = true;
        process.kill();
        logger.debug({ remoteName }, 'Quota check timed out - provider may not support about command');
        resolve({ available: false });
      }, timeoutMs);

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        error += data.toString();
      });

      process.on('close', (code) => {
        if (timedOut) return;
        clearTimeout(timeout);

        if (code === 0 && output) {
          try {
            const data = JSON.parse(output);
            
            logger.info({ remoteName, quota: data }, 'Retrieved quota information');
            
            resolve({
              total: typeof data.total === 'number' ? data.total : (data.total ? Number(data.total) : undefined),
              used: typeof data.used === 'number' ? data.used : (data.used ? Number(data.used) : undefined),
              free: typeof data.free === 'number' ? data.free : (data.free ? Number(data.free) : undefined),
              available: true
            });
          } catch (parseError) {
            logger.debug({ remoteName, parseError }, 'Failed to parse quota information');
            resolve({ available: false });
          }
        } else {
          // Check if error indicates unsupported operation
          const errorLower = error.toLowerCase();
          if (errorLower.includes('forbidden') || 
              errorLower.includes('not supported') || 
              errorLower.includes('not implemented')) {
            logger.debug({ remoteName }, 'Provider does not support quota information');
          } else {
            logger.debug({ remoteName, error: error.substring(0, 200) }, 'Quota information not available');
          }
          resolve({ available: false });
        }
      });

      process.on('error', (err) => {
        if (timedOut) return;
        clearTimeout(timeout);
        logger.debug({ error: err.message, remoteName }, 'Error fetching quota information');
        resolve({ available: false });
      });
    });
  }
}
