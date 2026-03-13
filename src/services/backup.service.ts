import { spawn } from 'child_process';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { appConfig } from '../config/index.js';
import { AccountService } from './account.service.js';
import { SettingsRepository } from '../repositories/settings.repository.js';
import { ProviderType } from '../types/index.js';
import logger from '../utils/logger.js';

export class BackupService {
  constructor(
    private accountService: AccountService,
    private settingsRepo: SettingsRepository
  ) {}

  /**
   * Perform a manual or scheduled backup to the configured cloud storage
   */
  async performBackup(): Promise<void> {
    const remoteId = await this.settingsRepo.get('backup_destination');
    if (!remoteId) {
      throw new Error('Backup destination not configured');
    }

    const account = await this.accountService.getAccountStatus(remoteId);
    if (!account) {
      throw new Error(`Selected backup account (ID: ${remoteId}) not found`);
    }

    const remoteName = account.accountIdentifier;
    if (!remoteName) {
      throw new Error('Account identifier (remote name) missing for backup account');
    }

    // Get decrypted credentials to extract remotePath (bucket name)
    const credentials = await this.accountService.getCredentials(remoteId);
    let remotePath = credentials.data.remotePath || '';
    
    // Fallback for Swift/Blomp if remotePath is missing but user (email) exists
    if (!remotePath && account.providerType === ProviderType.BLOMP && credentials.data.user) {
      remotePath = credentials.data.user;
      logger.debug({ remoteName, remotePath }, 'Using user field as remotePath for Blomp backup');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `streamfun-db-backup-${timestamp}.sql.gz`;
    const localPath = join('/tmp', filename);

    // Construct the full rclone remote path
    const remoteTarget = remotePath 
      ? `${remoteName}:${remotePath}/backups/${filename}` 
      : `${remoteName}:backups/${filename}`;

    try {
      await this.settingsRepo.set('backup_status', 'running');
      logger.info({ remoteName, remoteTarget, localPath }, 'Starting database backup workflow');

      // 1. Dump database and compress
      await this.dumpDatabase(localPath);

      // 2. Upload to cloud
      await this.uploadToCloud(localPath, remoteTarget);

      // 3. Cleanup local file
      await unlink(localPath);

      await this.settingsRepo.set('backup_last_run', new Date().toISOString());
      await this.settingsRepo.set('backup_status', 'success');
      logger.info({ filename, remoteTarget }, 'Database backup completed successfully');
    } catch (error: any) {
      await this.settingsRepo.set('backup_status', 'failed');
      logger.error({ error: error.message, stack: error.stack }, 'Database backup workflow failed');
      
      // Cleanup local file if it exists
      try {
        await unlink(localPath);
      } catch (cleanupErr) {
        // Ignore cleanup errors
      }
      
      throw error;
    }
  }

  private async dumpDatabase(outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('Starting database dump via Docker exec');
      
      // Use docker exec since database is in a container and pg_dump might not be on host
      const containerName = 'streamfun-postgres';
      
      // Use sh -c to allow pipe to gzip on the host
      const command = `docker exec -e PGPASSWORD=${appConfig.database.password} ${containerName} pg_dump -U ${appConfig.database.user} -d ${appConfig.database.name} | gzip > ${outputPath}`;
      
      logger.debug({ command: command.replace(appConfig.database.password, '********') }, 'Executing backup command');
      
      const dumpProcess = spawn('sh', ['-c', command]);

      let errorOutput = '';
      dumpProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        logger.debug({ stderr: data.toString() }, 'pg_dump stderr');
      });

      // Add a safety timeout of 5 minutes for the dump
      const timeout = setTimeout(() => {
        logger.error('Database dump timed out after 5 minutes');
        dumpProcess.kill();
        reject(new Error('Database dump timed out'));
      }, 5 * 60 * 1000);

      dumpProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          logger.info('Database dump completed successfully');
          resolve();
        } else {
          logger.error({ code, errorOutput }, 'Database dump failed');
          reject(new Error(`Database dump failed with code ${code}: ${errorOutput.trim()}`));
        }
      });

      dumpProcess.on('error', (err) => {
        clearTimeout(timeout);
        logger.error({ err }, 'Failed to start database dump process');
        reject(err);
      });
    });
  }

  private async uploadToCloud(localPath: string, remoteTarget: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info({ localPath, remoteTarget }, 'Starting upload to cloud');
      
      const uploadProcess = spawn('rclone', [
        'copyto',
        localPath,
        remoteTarget
      ]);

      let errorOutput = '';
      uploadProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        logger.debug({ stderr: data.toString() }, 'rclone stderr');
      });

      // Add a safety timeout of 10 minutes for the upload
      const timeout = setTimeout(() => {
        logger.error('Cloud upload timed out after 10 minutes');
        uploadProcess.kill();
        reject(new Error('Cloud upload timed out'));
      }, 10 * 60 * 1000);

      uploadProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          logger.info('Cloud upload completed successfully');
          resolve();
        } else {
          logger.error({ code, errorOutput }, 'Cloud upload failed');
          reject(new Error(`rclone backup upload failed with code ${code}: ${errorOutput.trim()}`));
        }
      });

      uploadProcess.on('error', (err) => {
        clearTimeout(timeout);
        logger.error({ err }, 'Failed to start cloud upload process');
        reject(err);
      });
    });
  }
}
