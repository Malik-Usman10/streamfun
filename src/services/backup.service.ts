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
      await unlink(localPath).catch(() => {});

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
      logger.info('Starting database dump');
      
      // Try standard pg_dump first (best for container-to-container or local)
      // If DATABASE_HOST is localhost and fails, we might be in a weird hybrid state
      const env = {
        ...process.env,
        PGPASSWORD: appConfig.database.password,
      };

      // Construct pg_dump command and pipe to gzip
      // Using --no-owner --no-privileges to make backups more portable
      const command = `pg_dump -h ${appConfig.database.host} -p ${appConfig.database.port} -U ${appConfig.database.user} -d ${appConfig.database.name} --no-owner --no-privileges | gzip > ${outputPath}`;
      
      logger.debug({ command: command.replace(appConfig.database.password, '********') }, 'Executing backup command');
      
      const dumpProcess = spawn('sh', ['-c', command], { env });

      let errorOutput = '';
      dumpProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        logger.debug({ stderr: data.toString() }, 'pg_dump stderr');
      });

      // 5 minute timeout
      const timeout = setTimeout(() => {
        logger.error('Database dump timed out after 5 minutes');
        dumpProcess.kill();
        reject(new Error('Database dump timed out'));
      }, 5 * 60 * 1000);

      dumpProcess.on('close', async (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          logger.info('Database dump completed successfully');
          resolve();
        } else {
          // If pg_dump failed and we are in a dev environment with docker, maybe try docker exec as fallback?
          // No, better to log why it failed. Most likely 'pg_dump: command not found'
          logger.error({ code, errorOutput }, 'Database dump failed');
          
          if (errorOutput.includes('not found') || errorOutput.includes('No such file')) {
            logger.info('pg_dump not found on host, trying docker exec fallback...');
            try {
              await this.dumpViaDocker(outputPath);
              resolve();
            } catch (dockerErr: any) {
              reject(new Error(`Both pg_dump and docker exec failed. pg_dump error: ${errorOutput.trim()}. Docker error: ${dockerErr.message}`));
            }
          } else {
            reject(new Error(`Database dump failed with code ${code}: ${errorOutput.trim()}`));
          }
        }
      });

      dumpProcess.on('error', (err) => {
        clearTimeout(timeout);
        logger.error({ err }, 'Failed to start database dump process');
        reject(err);
      });
    });
  }

  private async dumpViaDocker(outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const containerName = 'streamfun-postgres';
      const command = `docker exec -e PGPASSWORD=${appConfig.database.password} ${containerName} pg_dump -U ${appConfig.database.user} -d ${appConfig.database.name} --no-owner --no-privileges | gzip > ${outputPath}`;
      
      logger.info({ containerName }, 'Executing dump via docker exec');
      const dockerProc = spawn('sh', ['-c', command]);
      
      let errorOutput = '';
      dockerProc.stderr.on('data', (data) => { errorOutput += data.toString(); });
      
      dockerProc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Docker dump failed: ${errorOutput.trim()}`));
      });
    });
  }

  private async uploadToCloud(localPath: string, remoteTarget: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info({ localPath, remoteTarget }, 'Starting upload to cloud');
      
      const uploadProcess = spawn('rclone', [
        'copyto',
        localPath,
        remoteTarget,
        '--low-level-retries', '3',
        '--contimeout', '60s'
      ]);

      let errorOutput = '';
      uploadProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        logger.debug({ stderr: data.toString() }, 'rclone stderr');
      });

      // 10 minute timeout
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

  /**
   * Restore database from a dump file
   * @param dumpFilePath - Path to the uploaded file
   * @param originalFilename - Original filename to detect format
   */
  async restoreDatabase(dumpFilePath: string, originalFilename?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info({ dumpFilePath, originalFilename }, 'Starting database restore');

      const env = {
        ...process.env,
        PGPASSWORD: appConfig.database.password,
      };

      // Determine file type from original filename (multer strips extensions)
      const filename = originalFilename || dumpFilePath;
      const isGzipped = filename.endsWith('.gz');
      const isCustomFormat = filename.endsWith('.dump') || filename.endsWith('.backup');

      let command: string;

      if (isCustomFormat) {
        // Use pg_restore for custom format dumps
        // --clean: drop database objects before recreating
        // --if-exists: use IF EXISTS when dropping objects
        // --no-owner: skip restoration of object ownership
        // --no-privileges: skip restoration of access privileges
        command = `pg_restore -h ${appConfig.database.host} -p ${appConfig.database.port} -U ${appConfig.database.user} -d ${appConfig.database.name} --clean --if-exists --no-owner --no-privileges ${dumpFilePath}`;
      } else if (isGzipped) {
        // Gzipped SQL file: decompress and pipe to psql
        command = `gunzip -c ${dumpFilePath} | psql -h ${appConfig.database.host} -p ${appConfig.database.port} -U ${appConfig.database.user} -d ${appConfig.database.name}`;
      } else {
        // Plain SQL file: pipe to psql
        command = `psql -h ${appConfig.database.host} -p ${appConfig.database.port} -U ${appConfig.database.user} -d ${appConfig.database.name} < ${dumpFilePath}`;
      }

      logger.debug({ command: command.replace(appConfig.database.password, '********'), isCustomFormat, isGzipped, filename }, 'Executing restore command');

      const restoreProcess = spawn('sh', ['-c', command], { env });

      let errorOutput = '';
      restoreProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        logger.debug({ stderr: data.toString() }, 'restore stderr');
      });

      let stdoutOutput = '';
      restoreProcess.stdout.on('data', (data) => {
        stdoutOutput += data.toString();
        logger.debug({ stdout: data.toString() }, 'restore stdout');
      });

      // 10 minute timeout for restore
      const timeout = setTimeout(() => {
        logger.error('Database restore timed out after 10 minutes');
        restoreProcess.kill();
        reject(new Error('Database restore timed out'));
      }, 10 * 60 * 1000);

      restoreProcess.on('close', async (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          logger.info('Database restore completed successfully');
          resolve();
        } else {
          logger.error({ code, errorOutput, stdoutOutput }, 'Database restore failed');

          // Try docker exec fallback if command not found
          if (errorOutput.includes('not found') || errorOutput.includes('No such file')) {
            logger.info('Restore command not found on host, trying docker exec fallback...');
            try {
              await this.restoreViaDocker(dumpFilePath, isGzipped, isCustomFormat);
              resolve();
            } catch (dockerErr: any) {
              reject(new Error(`Both host and docker exec failed. Host error: ${errorOutput.trim()}. Docker error: ${dockerErr.message}`));
            }
          } else {
            reject(new Error(`Database restore failed with code ${code}: ${errorOutput.trim()}`));
          }
        }
      });

      restoreProcess.on('error', (err) => {
        clearTimeout(timeout);
        logger.error({ err }, 'Failed to start database restore process');
        reject(err);
      });
    });
  }

  private async restoreViaDocker(dumpFilePath: string, isGzipped: boolean, isCustomFormat: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const containerName = 'streamfun-postgres';
      
      // Copy file into container first
      const copyCommand = `docker cp ${dumpFilePath} ${containerName}:/tmp/restore.dump`;
      const copyProc = spawn('sh', ['-c', copyCommand]);

      copyProc.on('close', (copyCode) => {
        if (copyCode !== 0) {
          return reject(new Error('Failed to copy dump file into container'));
        }

        // Now restore from inside the container
        let restoreCommand: string;
        
        if (isCustomFormat) {
          // Use pg_restore for custom format
          restoreCommand = `docker exec -e PGPASSWORD=${appConfig.database.password} ${containerName} pg_restore -U ${appConfig.database.user} -d ${appConfig.database.name} --clean --if-exists --no-owner --no-privileges /tmp/restore.dump`;
        } else if (isGzipped) {
          // Decompress and pipe to psql
          restoreCommand = `docker exec -e PGPASSWORD=${appConfig.database.password} ${containerName} sh -c "gunzip -c /tmp/restore.dump | psql -U ${appConfig.database.user} -d ${appConfig.database.name}"`;
        } else {
          // Plain SQL file
          restoreCommand = `docker exec -e PGPASSWORD=${appConfig.database.password} ${containerName} psql -U ${appConfig.database.user} -d ${appConfig.database.name} -f /tmp/restore.dump`;
        }

        logger.info({ containerName, isCustomFormat, isGzipped }, 'Executing restore via docker exec');
        const dockerProc = spawn('sh', ['-c', restoreCommand]);

        let errorOutput = '';
        dockerProc.stderr.on('data', (data) => { errorOutput += data.toString(); });

        dockerProc.on('close', (code) => {
          // Cleanup temp file in container
          spawn('sh', ['-c', `docker exec ${containerName} rm -f /tmp/restore.dump`]);

          if (code === 0) resolve();
          else reject(new Error(`Docker restore failed: ${errorOutput.trim()}`));
        });
      });
    });
  }
}
