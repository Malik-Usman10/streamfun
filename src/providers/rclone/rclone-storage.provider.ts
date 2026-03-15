// Rclone-based storage provider adapter
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { createReadStream, createWriteStream } from 'fs';
import { unlink, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type {
  IStorageProvider,
  ProviderCredentials,
  AuthResult,
  TokenRefreshResult,
  FileUpload,
  UploadResult,
  DeleteResult,
  ListOptions,
  FileList,
  FileMetadata,
  StreamingLink,
  QuotaInfo,
  HealthStatus,
} from '../../types/provider.js';
import type { Account, ProviderType } from '../../types/index.js';
import logger from '../../utils/logger.js';
import { EncryptionService } from '../../services/encryption.service.js';

const execAsync = promisify(exec);

export interface RcloneCredentials {
  remoteName: string; // The rclone remote name (e.g., "gdrive1", "koofr1")
  remotePath?: string; // Optional path within the remote (e.g., "StreamFun")
}

export class RcloneStorageProvider implements IStorageProvider {
  readonly providerName: string;
  readonly providerType: ProviderType;
  private encryptionService: EncryptionService;

  constructor(providerType: ProviderType) {
    this.providerType = providerType;
    this.providerName = `Rclone ${providerType}`;
    this.encryptionService = new EncryptionService();
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      const rcloneConfig = credentials.data as RcloneCredentials;
      const remoteName = rcloneConfig.remoteName;
      const remotePath = rcloneConfig.remotePath || '';

      // Test if remote exists and is accessible
      // For Blomp, we need to include the bucket name in the path
      const testPath = remotePath 
        ? `${remoteName}:${remotePath}`
        : `${remoteName}:`;
      
      const { stdout } = await execAsync(`rclone lsd ${testPath}`, {
        timeout: 10000,
      });

      logger.info({ remoteName, remotePath }, 'Rclone remote authenticated successfully');

      // For Blomp/Swift, if remotePath is not set, use the user email as the default bucket
      let finalRemotePath = remotePath;
      if (!finalRemotePath && this.providerType === 'blomp' && (credentials.data as any).user) {
        finalRemotePath = (credentials.data as any).user;
        logger.info({ remoteName, finalRemotePath }, 'Using Blomp user as default remotePath');
      }

      return {
        success: true,
        sessionData: {
          remoteName,
          remotePath: finalRemotePath,
        },
      };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Rclone authentication failed');
      return {
        success: false,
        error: error.message || 'Failed to authenticate with rclone remote',
      };
    }
  }

  async refreshToken(account: Account): Promise<TokenRefreshResult> {
    // Rclone handles token refresh automatically
    return {
      success: true,
    };
  }

  async validateToken(account: Account): Promise<boolean> {
    try {
      const remoteName = await this.getRemoteName(account);
      await execAsync(`rclone lsd ${remoteName}: --max-depth 1`, {
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  async uploadFile(account: Account, file: FileUpload): Promise<UploadResult> {
    const remoteName = await this.getRemoteName(account);
    const remotePath = await this.getRemotePath(account);
    const tempFilePath = join(tmpdir(), `upload-${uuidv4()}`);

    try {
      // Write stream to temp file
      const writeStream = createWriteStream(tempFilePath);
      const reader = file.stream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writeStream.write(Buffer.from(value));
      }

      await new Promise((resolve, reject) => {
        writeStream.end((err: any) => (err ? reject(err) : resolve(null)));
      });

      // Build remote file path
      const remoteFilePath = remotePath
        ? `${remoteName}:${remotePath}/${file.filename}`
        : `${remoteName}:${file.filename}`;

      // Extract directory path
      const remoteDir = remoteFilePath.includes('/') 
        ? remoteFilePath.substring(0, remoteFilePath.lastIndexOf('/'))
        : remoteFilePath.substring(0, remoteFilePath.lastIndexOf(':') + 1);
      
      logger.debug({ tempFilePath, remoteFilePath, remoteDir }, 'Uploading via rclone copyto');

      // Upload file directly to the final path
      // This is more atomic than copy + moveto
      await execAsync(`rclone copyto "${tempFilePath}" "${remoteFilePath}" --progress`, {
        timeout: 600000, // 10 minutes for large files
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for logs
      });

      // Get the uploaded file ID
      const providerFileId = file.filename;
      logger.info({ filename: file.filename, remoteName, remoteFilePath }, 'File uploaded via rclone copyto');

      return {
        success: true,
        fileId: providerFileId,
        providerFileId,
        size: file.size,
        uploadedAt: new Date(),
      };
    } catch (error: any) {
      logger.error({ error: error.message, filename: file.filename }, 'Rclone upload failed');
      throw new Error(`Upload failed: ${error.message}`);
    } finally {
      // Clean up temp file
      try {
        await unlink(tempFilePath);
      } catch {}
    }
  }

  async downloadFile(account: Account, fileId: string): Promise<ReadableStream> {
    const remoteName = await this.getRemoteName(account);
    const remotePath = await this.getRemotePath(account);

    try {
      // Download from rclone remote
      const remoteFilePath = remotePath
        ? `${remoteName}:${remotePath}/${fileId}`
        : `${remoteName}:${fileId}`;

      logger.debug({ remoteFilePath }, 'Streaming via rclone cat');

      // Spawn rclone cat with increased timeouts for slower providers (like Blomp)
      const args = [
        'cat',
        remoteFilePath,
        '--low-level-retries', '2',
        '--contimeout', '30s',
        '--timeout', '60s'
      ];
      
      logger.info({ command: `rclone ${args.join(' ')}` }, 'Executing buffered rclone streaming command');
      const child = spawn('rclone', args);

      return new ReadableStream({
        start(controller) {
          let hasReceivedData = false;
          let stderrBuffer = '';

          child.stdout.on('data', (chunk: Buffer) => {
            hasReceivedData = true;
            if (controller.desiredSize !== null) {
              controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
            }
          });

          child.stdout.on('end', () => {
            try { controller.close(); } catch {}
          });

          child.stderr.on('data', (data: Buffer) => {
            const errorMsg = data.toString();
            stderrBuffer += errorMsg;
            if (errorMsg.includes('ERROR') || errorMsg.includes('Failed') || errorMsg.includes('directory not found')) {
              logger.warn({ error: errorMsg, fileId }, 'Rclone cat stderr activity');
            }
          });

          child.on('error', (error: Error) => {
            logger.error({ error, fileId }, 'Rclone process spawn failure');
            try { controller.error(error); } catch {}
          });

          child.on('close', (code: number | null) => {
            if (code !== 0 && code !== null) {
              const errorMessage = stderrBuffer.trim() || `Rclone cat exited with code ${code}`;
              logger.error({ code, fileId, stderr: stderrBuffer }, `Rclone cat process failed`);
              
              if (!hasReceivedData) {
                // If it failed before any data, it's likely an auth or network error
                try { controller.error(new Error(`Connection failed: ${errorMessage}`)); } catch {}
              } else {
                try { controller.error(new Error(`Stream interrupted: ${errorMessage}`)); } catch {}
              }
            }
          });
        },
        cancel() {
          logger.debug({ fileId }, 'Killing rclone cat process due to stream cancellation');
          child.kill();
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message, fileId, remotePath }, 'Rclone streaming download failed to initialize');
      throw new Error(`Download initialization failed: ${error.message}`);
    }
  }

  async deleteFile(account: Account, fileId: string): Promise<DeleteResult> {
    const remoteName = await this.getRemoteName(account);
    const remotePath = await this.getRemotePath(account);

    try {
      const remoteFilePath = remotePath
        ? `${remoteName}:${remotePath}/${fileId}`
        : `${remoteName}:${fileId}`;

      await execAsync(`rclone delete "${remoteFilePath}"`, {
        timeout: 30000,
      });

      logger.info({ fileId, remoteName }, 'File deleted via rclone');

      return { success: true };
    } catch (error: any) {
      logger.error({ error: error.message, fileId }, 'Rclone delete failed');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async listFiles(account: Account, options: ListOptions): Promise<FileList> {
    const remoteName = await this.getRemoteName(account);
    const remotePath = await this.getRemotePath(account);

    try {
      const remoteFullPath = remotePath
        ? `${remoteName}:${remotePath}`
        : `${remoteName}:`;

      const { stdout } = await execAsync(`rclone lsjson "${remoteFullPath}" --max-depth 1`, {
        timeout: 30000,
      });

      const files = JSON.parse(stdout) as Array<{
        Path: string;
        Name: string;
        Size: number;
        MimeType: string;
        ModTime: string;
        IsDir: boolean;
      }>;

      const fileMetadata: FileMetadata[] = files
        .filter((f) => !f.IsDir)
        .map((f) => ({
          id: f.Name,
          name: f.Name,
          size: f.Size,
          mimeType: f.MimeType,
          createdAt: new Date(f.ModTime),
          modifiedAt: new Date(f.ModTime),
        }));

      return {
        files: fileMetadata.slice(0, options.pageSize || 50),
        nextPageToken: undefined,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Rclone list failed');
      return { files: [] };
    }
  }

  async getFileMetadata(account: Account, fileId: string): Promise<FileMetadata> {
    const remoteName = await this.getRemoteName(account);
    const remotePath = await this.getRemotePath(account);

    try {
      const remoteFilePath = remotePath
        ? `${remoteName}:${remotePath}/${fileId}`
        : `${remoteName}:${fileId}`;

      const { stdout } = await execAsync(`rclone lsjson "${remoteFilePath}"`, {
        timeout: 10000,
      });

      const files = JSON.parse(stdout) as Array<{
        Path: string;
        Name: string;
        Size: number;
        MimeType: string;
        ModTime: string;
      }>;

      if (files.length === 0) {
        throw new Error('File not found');
      }

      const file = files[0];
      return {
        id: fileId,
        name: file.Name,
        size: file.Size,
        mimeType: file.MimeType,
        createdAt: new Date(file.ModTime),
        modifiedAt: new Date(file.ModTime),
      };
    } catch (error: any) {
      logger.error({ error: error.message, fileId }, 'Failed to get file metadata');
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  }

  async generateStreamingLink(account: Account, fileId: string): Promise<StreamingLink> {
    const remoteName = await this.getRemoteName(account);
    const remotePath = await this.getRemotePath(account);

    try {
      // Swift/Blomp doesn't support public links via rclone link
      if (account.providerType === 'blomp') {
        throw new Error('Public links not supported for this provider');
      }

      const remoteFilePath = remotePath
        ? `${remoteName}:${remotePath}/${fileId}`
        : `${remoteName}:${fileId}`;

      const { stdout } = await execAsync(`rclone link "${remoteFilePath}"`, {
        timeout: 10000,
      });

      return {
        url: stdout.trim(),
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
      };
    } catch (error: any) {
      // Fallback: return a local serve URL that our app handles
      logger.info({ fileId, provider: account.providerType }, 'Using internal streaming fallback');
      
      // In a real environment, this should be the public URL of the app
      const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
      return {
        url: `${baseUrl}/api/files/${fileId}/play`,
        expiresAt: new Date(Date.now() + 86400000), // 24 hours
      };
    }
  }

  async getQuotaInfo(account: Account): Promise<QuotaInfo> {
    const remoteName = await this.getRemoteName(account);
    const remotePath = await this.getRemotePath(account);

    try {
      // Use the remote name and path for the about command
      // Swift/Blomp requires a container/bucket name (which we store in remotePath)
      const target = remotePath ? `${remoteName}:${remotePath}` : `${remoteName}:`;
      
      logger.debug({ remoteName, target }, 'Fetching quota info for remote');
      
      const { stdout, stderr } = await execAsync(`rclone about "${target}" --json`, {
        timeout: 20000, // Increased timeout to 20s for slow providers like GDrive
      });

      if (stderr && stderr.includes('NOTICE')) {
         logger.debug({ stderr }, 'Rclone about notice');
      }

      const aboutInfo = JSON.parse(stdout);

      return {
        total: aboutInfo.total || 0,
        used: aboutInfo.used || 0,
        available: aboutInfo.free || 0,
        unit: 'bytes',
      };
    } catch (error: any) {
      logger.error({ error: error.message, remoteName }, 'Failed to get quota info from rclone');
      throw new Error(`Failed to get quota info: ${error.message}`);
    }
  }

  async healthCheck(account: Account): Promise<HealthStatus> {
    const remoteName = await this.getRemoteName(account);
    const startTime = Date.now();

    try {
      await execAsync(`rclone lsd ${remoteName}: --max-depth 1`, {
        timeout: 5000,
      });

      const latency = Date.now() - startTime;

      return {
        healthy: true,
        latency,
      };
    } catch (error: any) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  private async getRemoteName(account: Account): Promise<string> {
    if (!account.tokensEncrypted) {
      throw new Error('Account session data not found');
    }
    
    try {
      // Decrypt session data to get remote name
      const decrypted = await this.encryptionService.decrypt(account.tokensEncrypted);
      const sessionData = JSON.parse(decrypted);
      return sessionData.remoteName;
    } catch (error) {
      logger.error({ error, accountId: account.id }, 'Failed to decrypt session data');
      throw new Error('Invalid account session data');
    }
  }

  private async getRemotePath(account: Account): Promise<string> {
    if (!account.tokensEncrypted) {
      return '';
    }
    
    try {
      const decrypted = await this.encryptionService.decrypt(account.tokensEncrypted);
      const sessionData = JSON.parse(decrypted);
      
      if (sessionData.remotePath) {
        return sessionData.remotePath;
      }

      // Fallback for Blomp/Swift existing accounts
      if (account.providerType === 'blomp' && account.credentialsEncrypted) {
        const credsDecrypted = await this.encryptionService.decrypt(account.credentialsEncrypted);
        const credentials = JSON.parse(credsDecrypted);
        if (credentials.data && credentials.data.user) {
          logger.info({ accountId: account.id }, 'Using legacy Blomp user fallback for remotePath');
          return credentials.data.user;
        }
      }

      return '';
    } catch {
      return '';
    }
  }
}
