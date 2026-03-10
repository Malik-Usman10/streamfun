// Rclone-based storage provider adapter
import { exec } from 'child_process';
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

      return {
        success: true,
        sessionData: {
          remoteName,
          remotePath,
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
      // If filename contains path separators, it's a category-based path
      const remoteFilePath = remotePath
        ? `${remoteName}:${remotePath}/${file.filename}`
        : `${remoteName}:${file.filename}`;

      // Extract directory path (everything except the last component)
      const remoteDir = remoteFilePath.replace(/\/[^/]+$/, '');
      
      // Create directory structure if needed (for category-based paths)
      if (file.filename.includes('/')) {
        try {
          await execAsync(`rclone mkdir "${remoteDir}"`, {
            timeout: 30000,
          });
        } catch (error: any) {
          // Ignore errors - directory might already exist
          logger.debug({ error: error.message }, 'Directory creation skipped or failed');
        }
      }

      // Upload file to remote
      await execAsync(`rclone copy "${tempFilePath}" "${remoteDir}" --progress`, {
        timeout: 300000, // 5 minutes
      });

      // Rename the uploaded file to match the desired filename
      const uploadedTempName = tempFilePath.split('/').pop();
      const finalFileName = file.filename.split('/').pop();
      
      if (uploadedTempName !== finalFileName) {
        try {
          await execAsync(
            `rclone moveto "${remoteDir}/${uploadedTempName}" "${remoteFilePath}"`,
            { timeout: 30000 }
          );
        } catch (error: any) {
          logger.warn({ error: error.message }, 'File rename failed, using temp name');
        }
      }

      // Get the uploaded file ID (use filename as ID for rclone)
      const providerFileId = file.filename;

      logger.info({ filename: file.filename, remoteName }, 'File uploaded via rclone');

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
    const tempFilePath = join(tmpdir(), `download-${uuidv4()}`);

    try {
      // Download from rclone remote
      const remoteFilePath = remotePath
        ? `${remoteName}:${remotePath}/${fileId}`
        : `${remoteName}:${fileId}`;

      // Download to a specific temp file instead of tmpdir
      await execAsync(`rclone copyto "${remoteFilePath}" "${tempFilePath}" --progress`, {
        timeout: 300000,
      });

      // Create readable stream from temp file
      const fileStream = createReadStream(tempFilePath);

      return new ReadableStream({
        async start(controller) {
          fileStream.on('data', (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
          });

          fileStream.on('end', () => {
            controller.close();
            // Clean up temp file
            unlink(tempFilePath).catch(() => {});
          });

          fileStream.on('error', (error) => {
            controller.error(error);
          });
        },
      });
    } catch (error: any) {
      logger.error({ error: error.message, fileId }, 'Rclone download failed');
      throw new Error(`Download failed: ${error.message}`);
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
      const remoteFilePath = remotePath
        ? `${remoteName}:${remotePath}/${fileId}`
        : `${remoteName}:${fileId}`;

      // Use rclone serve http to generate a temporary streaming link
      // Note: This is a simplified approach. In production, you'd want a persistent rclone serve process
      const { stdout } = await execAsync(`rclone link "${remoteFilePath}"`, {
        timeout: 10000,
      });

      return {
        url: stdout.trim(),
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
      };
    } catch (error: any) {
      // Fallback: return a local serve URL
      logger.warn({ error: error.message }, 'Rclone link failed, using fallback');
      return {
        url: `http://localhost:8080/serve/${fileId}`,
        expiresAt: new Date(Date.now() + 3600000),
      };
    }
  }

  async getQuotaInfo(account: Account): Promise<QuotaInfo> {
    const remoteName = await this.getRemoteName(account);

    try {
      const { stdout } = await execAsync(`rclone about ${remoteName}: --json`, {
        timeout: 10000,
      });

      const aboutInfo = JSON.parse(stdout);

      return {
        total: aboutInfo.total || 0,
        used: aboutInfo.used || 0,
        available: aboutInfo.free || 0,
        unit: 'bytes',
      };
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to get quota info, using defaults');
      // Return default quota if command fails
      return {
        total: 100 * 1024 * 1024 * 1024, // 100 GB default
        used: 0,
        available: 100 * 1024 * 1024 * 1024,
        unit: 'bytes',
      };
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
      return sessionData.remotePath || '';
    } catch {
      return '';
    }
  }
}
