// Rclone configuration management service
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileLockManager } from '../../../shared/utils/file-lock.js';
import logger from '../../../shared/utils/logger.js';

export interface RcloneRemote {
  name: string;
  type: string;
  config: Record<string, string>;
}

export interface RcloneConfig {
  remotes: RcloneRemote[];
}

export class RcloneConfigService {
  private configPath: string;
  private lockFile: string;

  constructor(configPath?: string) {
    // Default to standard rclone config location
    this.configPath = configPath || path.join(os.homedir(), '.config', 'rclone', 'rclone.conf');
    this.lockFile = `${this.configPath}.lock`;
  }

  /**
   * Parse rclone config file (INI format)
   * Format:
   * [remote_name]
   * type = drive
   * client_id = xxx
   * client_secret = yyy
   */
  async parseConfig(): Promise<RcloneConfig> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const remotes: RcloneRemote[] = [];
      
      const lines = content.split('\n');
      let currentRemote: RcloneRemote | null = null;
      let lineNumber = 0;
      
      for (let line of lines) {
        lineNumber++;
        // Trim whitespace
        line = line.trim();
        
        // Skip empty lines and comments
        if (!line || line.startsWith('#') || line.startsWith(';')) {
          continue;
        }
        
        // Check for section header [remote_name]
        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
          // Save previous remote if exists and valid
          if (currentRemote) {
            if (currentRemote.type) {
              remotes.push(currentRemote);
            } else {
              logger.warn({ remoteName: currentRemote.name, lineNumber }, 'Skipping remote with no type');
            }
          }
          
          // Start new remote
          currentRemote = {
            name: sectionMatch[1],
            type: '',
            config: {}
          };
          continue;
        }
        
        // Parse key = value pairs
        const keyValueMatch = line.match(/^([^=]+)=(.*)$/);
        if (keyValueMatch && currentRemote) {
          const key = keyValueMatch[1].trim();
          const value = keyValueMatch[2].trim();
          
          if (key === 'type') {
            currentRemote.type = value;
          } else {
            currentRemote.config[key] = value;
          }
        } else if (!keyValueMatch && currentRemote) {
          // Invalid line format - log and skip
          logger.warn({ line, lineNumber }, 'Skipping invalid config line');
        }
      }
      
      // Don't forget the last remote
      if (currentRemote) {
        if (currentRemote.type) {
          remotes.push(currentRemote);
        } else {
          logger.warn({ remoteName: currentRemote.name }, 'Skipping last remote with no type');
        }
      }
      
      logger.info({ remoteCount: remotes.length }, 'Parsed rclone config');
      
      return { remotes };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Config file doesn't exist yet - return empty config
        logger.info('Rclone config file not found, returning empty config');
        return { remotes: [] };
      }
      
      logger.error({ error }, 'Failed to parse rclone config');
      throw new Error(`Failed to parse rclone config: ${error.message}`);
    }
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Check if config file exists
   */
  async configExists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure config directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    const configDir = path.dirname(this.configPath);
    await fs.mkdir(configDir, { recursive: true });
  }

  /**
   * Serialize config to INI format
   */
  private serializeConfig(config: RcloneConfig): string {
    const lines: string[] = [];
    
    for (const remote of config.remotes) {
      // Add section header
      lines.push(`[${remote.name}]`);
      
      // Add type first
      lines.push(`type = ${remote.type}`);
      
      // Add other config values
      for (const [key, value] of Object.entries(remote.config)) {
        lines.push(`${key} = ${value}`);
      }
      
      // Add blank line between remotes
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Write config file atomically
   * Uses temp file + rename strategy to prevent corruption
   * Uses file lock to prevent concurrent writes
   */
  async writeConfig(config: RcloneConfig): Promise<void> {
    await this.ensureConfigDir();
    
    // Acquire lock for this config file
    return fileLockManager.withLock(this.configPath, async () => {
      const tempPath = `${this.configPath}.tmp`;
      const content = this.serializeConfig(config);
      
      try {
        // Write to temp file
        await fs.writeFile(tempPath, content, 'utf-8');
        
        // Validate the temp file can be parsed
        const testConfig = await this.parseConfigFromFile(tempPath);
        if (testConfig.remotes.length !== config.remotes.length) {
          throw new Error('Config validation failed: remote count mismatch');
        }
        
        // Atomic rename
        await fs.rename(tempPath, this.configPath);
        
        // Ensure secure permissions (600)
        await this.ensureSecurePermissions();
        
        logger.info({ remoteCount: config.remotes.length }, 'Wrote rclone config atomically');
      } catch (error: any) {
        // Clean up temp file on error
        try {
          await fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
        
        logger.error({ error }, 'Failed to write rclone config');
        throw new Error(`Failed to write rclone config: ${error.message}`);
      }
    });
  }

  /**
   * Parse config from a specific file path
   */
  private async parseConfigFromFile(filePath: string): Promise<RcloneConfig> {
    const originalPath = this.configPath;
    this.configPath = filePath;
    try {
      return await this.parseConfig();
    } finally {
      this.configPath = originalPath;
    }
  }

  /**
   * Add a new remote to the config
   */
  async addRemote(remote: RcloneRemote): Promise<void> {
    const config = await this.parseConfig();
    
    // Check if remote already exists
    if (config.remotes.some(r => r.name === remote.name)) {
      throw new Error(`Remote '${remote.name}' already exists`);
    }
    
    config.remotes.push(remote);
    await this.writeConfig(config);
    
    logger.info({ remoteName: remote.name, type: remote.type }, 'Added rclone remote');
  }

  /**
   * Update an existing remote
   */
  async updateRemote(remoteName: string, updates: Partial<Omit<RcloneRemote, 'name'>>): Promise<void> {
    const config = await this.parseConfig();
    
    const remoteIndex = config.remotes.findIndex(r => r.name === remoteName);
    if (remoteIndex === -1) {
      throw new Error(`Remote '${remoteName}' not found`);
    }
    
    // Apply updates
    if (updates.type) {
      config.remotes[remoteIndex].type = updates.type;
    }
    if (updates.config) {
      config.remotes[remoteIndex].config = {
        ...config.remotes[remoteIndex].config,
        ...updates.config
      };
    }
    
    await this.writeConfig(config);
    
    logger.info({ remoteName }, 'Updated rclone remote');
  }

  /**
   * Delete a remote from the config
   */
  async deleteRemote(remoteName: string): Promise<void> {
    const config = await this.parseConfig();
    
    const initialCount = config.remotes.length;
    config.remotes = config.remotes.filter(r => r.name !== remoteName);
    
    if (config.remotes.length === initialCount) {
      throw new Error(`Remote '${remoteName}' not found`);
    }
    
    await this.writeConfig(config);
    
    logger.info({ remoteName }, 'Deleted rclone remote');
  }

  /**
   * Get a specific remote by name
   */
  async getRemote(remoteName: string): Promise<RcloneRemote | null> {
    const config = await this.parseConfig();
    return config.remotes.find(r => r.name === remoteName) || null;
  }

  /**
   * List all remotes
   */
  async listRemotes(): Promise<RcloneRemote[]> {
    const config = await this.parseConfig();
    return config.remotes;
  }

  /**
   * Encrypt a sensitive field using rclone obscure
   */
  async encryptField(value: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('rclone', ['obscure', value]);
      
      let output = '';
      let error = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`rclone obscure failed: ${error}`));
        }
      });
    });
  }

  /**
   * Decrypt a sensitive field using rclone reveal
   */
  async decryptField(obscuredValue: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('rclone', ['reveal', obscuredValue]);
      
      let output = '';
      let error = '';
      
      process.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`rclone reveal failed: ${error}`));
        }
      });
    });
  }

  /**
   * Check and set config file permissions to 600 (user read/write only)
   */
  async ensureSecurePermissions(): Promise<void> {
    try {
      // Set permissions to 600 (rw-------)
      await fs.chmod(this.configPath, 0o600);
      logger.debug({ configPath: this.configPath }, 'Set config file permissions to 600');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error({ error }, 'Failed to set config file permissions');
        throw new Error(`Failed to set config file permissions: ${error.message}`);
      }
    }
  }

  /**
   * Verify config file has secure permissions (600)
   */
  async verifySecurePermissions(): Promise<boolean> {
    try {
      const stats = await fs.stat(this.configPath);
      const mode = stats.mode & 0o777;
      
      // Check if permissions are exactly 600
      const isSecure = mode === 0o600;
      
      if (!isSecure) {
        logger.warn({ mode: mode.toString(8), configPath: this.configPath }, 'Config file has insecure permissions');
      }
      
      return isSecure;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return true; // File doesn't exist yet, that's okay
      }
      
      logger.error({ error }, 'Failed to check config file permissions');
      return false;
    }
  }

    /**
     * Check if rclone is installed and available
     * @returns Promise<boolean> True if rclone is installed
     */
    async checkRcloneInstalled(): Promise<boolean> {
      return new Promise((resolve) => {
        const rclone = spawn('rclone', ['version']);

        rclone.on('error', (error) => {
          logger.error({ error }, 'Rclone is not installed or not in PATH');
          resolve(false);
        });

        rclone.on('close', (code) => {
          if (code === 0) {
            logger.info('Rclone is installed and available');
            resolve(true);
          } else {
            logger.error({ code }, 'Rclone command failed');
            resolve(false);
          }
        });
      });
    }

    /**
     * Initialize rclone service - check installation and create config if needed
     * @throws Error if rclone is not installed
     */
    async initialize(): Promise<void> {
      // Check if rclone is installed
      const isInstalled = await this.checkRcloneInstalled();
      if (!isInstalled) {
        const error = new Error(
          'Rclone is not installed or not in PATH. Please install rclone to use cloud storage features. ' +
          'Visit https://rclone.org/install/ for installation instructions.'
        );
        logger.error('Rclone initialization failed - not installed');
        throw error;
      }

      // Check if config file exists, create if not
      const exists = await this.configExists();
      if (!exists) {
        logger.info('Creating empty rclone config file');
        await this.ensureConfigDir();
        await this.writeConfig({ remotes: [] });
        await this.ensureSecurePermissions();
      } else {
        // Verify permissions on existing config
        const hasSecurePermissions = await this.verifySecurePermissions();
        if (!hasSecurePermissions) {
          logger.warn('Rclone config file has insecure permissions, fixing...');
          await this.ensureSecurePermissions();
        }
      }

      logger.info('Rclone service initialized successfully');
    }
}
