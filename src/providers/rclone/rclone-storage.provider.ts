import { spawn, ChildProcess } from 'child_process';
import { createReadStream, createWriteStream } from 'fs';
import { unlink, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { ConcurrencyLimiter } from '../../utils/concurrency-limiter.js';
import { appConfig } from '../../config/index.js';
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

export interface RcloneCredentials {
  remoteName: string; // The rclone remote name (e.g., "gdrive1", "koofr1")
  remotePath?: string; // Optional path within the remote (e.g., "StreamFun")
}

export class RcloneStorageProvider implements IStorageProvider {
  readonly providerName: string;
  readonly providerType: ProviderType;
  private encryptionService: EncryptionService;
  
  // Global limiter to prevent system exhaustion from too many rclone processes
  private static globalLimiter = new ConcurrencyLimiter(appConfig.upload.maxParallelDownloads * 2);

  constructor(providerType: ProviderType) {
    this.providerType = providerType;
    this.providerName = `Rclone ${providerType}`;
    this.encryptionService = new EncryptionService();
  }

  /**
   * Helper to run rclone commands via spawn for better process management and cancellation support.
   */
  private async runRclone(
    args: string[], 
    options: { 
      timeout?: number; 
      signal?: AbortSignal;
      captureOutput?: boolean;
    } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    const { timeout = 300000, signal, captureOutput = true } = options;

    return await RcloneStorageProvider.globalLimiter.run(async () => {
      if (signal?.aborted) throw new Error('Operation aborted');

      return new Promise((resolve, reject) => {
        logger.debug({ args: args.join(' ') }, 'Spawning rclone process');
        
        const child = spawn('rclone', args, {
          env: { ...process.env, PAGER: 'cat' }
        });

        let stdout = '';
        let stderr = '';
        let timer: NodeJS.Timeout | null = null;

        if (captureOutput) {
          child.stdout?.on('data', (data) => { stdout += data.toString(); });
        }
        child.stderr?.on('data', (data) => { stderr += data.toString(); });

        const cleanup = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          signal?.removeEventListener('abort', onAbort);
        };

        const onAbort = () => {
          logger.warn({ args: args.slice(0, 3).join(' ') }, 'Rclone process aborted via signal, killing PID ' + child.pid);
          child.kill('SIGKILL');
          cleanup();
          reject(new Error('Operation aborted'));
        };

        if (signal) {
          signal.addEventListener('abort', onAbort);
        }

        timer = setTimeout(() => {
          logger.error({ args: args.slice(0, 3).join(' '), timeout }, 'Rclone process timed out, killing PID ' + child.pid);
          child.kill('SIGKILL');
          cleanup();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);

        child.on('close', (code) => {
          cleanup();
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            const error = new Error(`Rclone exited with code ${code}`);
            (error as any).stderr = stderr;
            (error as any).stdout = stdout;
            (error as any).code = code;
            reject(error);
          }
        });

        child.on('error', (err) => {
          cleanup();
          reject(err);
        });
      });
    });
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      const rcloneConfig = credentials.data as RcloneCredentials;
      const remoteName = rcloneConfig.remoteName;
      const remotePath = rcloneConfig.remotePath || '';

      // Test if remote exists and is accessible
      const testPath = remotePath
        ? `${remoteName}:${remotePath}`
        : `${remoteName}:`;

      await this.runRclone(['lsd', testPath], { timeout: 15000 });

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
      await this.runRclone(['lsd', `${remoteName}:`, '--max-depth', '1'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async uploadFile(account: Account, file: FileUpload, signal?: AbortSignal): Promise<UploadResult> {
    const remoteName = await this.getRemoteName(account);
    const remotePath = await this.getRemotePath(account);
    const tempFilePath = join(tmpdir(), `upload-${uuidv4()}`);

    try {
      // Write stream to temp file
      const writeStream = createWriteStream(tempFilePath);
      const reader = file.stream.getReader();

      while (true) {
        if (signal?.aborted) throw new Error('Upload aborted');
        const { done, value } = await reader.read();
        if (done) break;
        writeStream.write(Buffer.from(value));
      }

      await new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('Upload aborted'));
        writeStream.end((err: any) => (err ? reject(err) : resolve(null)));
      });

      // Build remote file path
      const remoteFilePath = remotePath
        ? `${remoteName}:${remotePath}/${file.filename}`
        : `${remoteName}:${file.filename}`;

      logger.debug({ tempFilePath, remoteFilePath }, 'Uploading via rclone copyto');

      // Upload file directly to the final path
      await this.runRclone(
        ['copyto', tempFilePath, remoteFilePath, '--progress'],
        { timeout: 600000, signal }
      );

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
      if (error.message === 'Upload aborted' || error.message === 'Operation aborted') {
        logger.info({ filename: file.filename }, 'Upload aborted by user');
        throw error;
      }
      logger.error({ error: error.message, filename: file.filename }, 'Rclone upload failed');
      throw new Error(`Upload failed: ${error.message}`);
    } finally {
      // Clean up temp file
      try {
        await unlink(tempFilePath);
      } catch { }
    }
  }

  async downloadFile(account: Account, fileId: string, signal?: AbortSignal): Promise<ReadableStream> {
    const remoteName = await this.getRemoteName(account);
    const remotePath = await this.getRemotePath(account);

    const remoteFilePath = remotePath
      ? `${remoteName}:${remotePath}/${fileId}`
      : `${remoteName}:${fileId}`;

    const tempFilePath = join(tmpdir(), `download-${uuidv4()}`);
    const maxAttempts = 3;

    logger.debug({ remoteFilePath, tempFilePath }, 'Downloading chunk via rclone copyto');

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw new Error('Download aborted');
      }

      try {
        await this.runRclone(
          ['copyto', remoteFilePath, tempFilePath],
          { timeout: 300000, signal }
        );

        // Verify file exists and has data
        const fileStat = await stat(tempFilePath);
        if (fileStat.size === 0) {
          throw new Error('Downloaded file is 0 bytes');
        }

        logger.debug({ remoteFilePath, size: fileStat.size, attempt }, 'Chunk downloaded to temp file');
        break; // Success
      } catch (err: any) {
        lastError = err;
        
        // Clean up partial temp file
        try { await unlink(tempFilePath); } catch { }

        if (err.message === 'Download aborted' || err.message === 'Operation aborted') {
          throw err;
        }

        const isRcloneError = err.stderr || err.message?.includes('exit code');
        const errorDetail = isRcloneError
          ? `rclone failed: ${(err.stderr || err.message || '').substring(0, 300)}`
          : err.message;
          
        logger.warn({ attempt, maxAttempts, fileId, error: errorDetail, remoteFilePath }, 'Rclone copyto download attempt failed');
        
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, attempt * 2000));
        }
      }
    }

    if (lastError) {
      // Re-verify if rclone returned 0 but file is missing (ENOENT was likely swallowed by stat)
      if (lastError.message?.includes('ENOENT') || lastError.message?.includes('statx')) {
         throw new Error(`Critical download failure: Rclone reported success but temporary file missed at ${tempFilePath}. Check if cloud path exists: ${remoteFilePath}`);
      }
      throw lastError;
    }

    // Stream the temp file and delete it after consumption
    const readStream = createReadStream(tempFilePath);
    let streamClosed = false;

    return new ReadableStream({
      start(controller) {
        readStream.on('data', (chunk: Buffer) => {
          if (streamClosed) return;
          try {
            // Force a deep copy to prevent Node's internal slab pool overwriting
            // the chunk before the Web Stream consumer asynchronously reads it.
            const copy = new Uint8Array(chunk.length);
            copy.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
            controller.enqueue(copy);
          } catch { streamClosed = true; }
        });
        readStream.on('end', () => {
          if (streamClosed) return;
          streamClosed = true;
          try { controller.close(); } catch { }
          // Async cleanup — fire and forget
          unlink(tempFilePath).catch(() => { });
        });
        readStream.on('error', (err) => {
          if (streamClosed) return;
          streamClosed = true;
          try { controller.error(err); } catch { }
          unlink(tempFilePath).catch(() => { });
        });
      },
      cancel() {
        streamClosed = true;
        readStream.destroy();
        unlink(tempFilePath).catch(() => { });
      }
    });
  }





  async deleteFile(account: Account, fileId: string): Promise<DeleteResult> {
    const remoteName = await this.getRemoteName(account);
    const remotePath = await this.getRemotePath(account);

    try {
      const remoteFilePath = remotePath
        ? `${remoteName}:${remotePath}/${fileId}`
        : `${remoteName}:${fileId}`;

      await this.runRclone(['delete', remoteFilePath], { timeout: 30000 });

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

      const { stdout } = await this.runRclone(
        ['lsjson', remoteFullPath, '--max-depth', '1'],
        { timeout: 30000 }
      );

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

    const remoteFilePath = remotePath
      ? `${remoteName}:${remotePath}/${fileId}`
      : `${remoteName}:${fileId}`;

    try {
      // --stat treats the path as a FILE and returns its metadata directly.
      const { stdout } = await this.runRclone(
        ['lsjson', remoteFilePath, '--stat'],
        { timeout: 30000 }
      );

      // --stat returns a single JSON object, not an array
      const file = JSON.parse(stdout) as {
        Path: string;
        Name: string;
        Size: number;
        MimeType: string;
        ModTime: string;
      };

      if (!file || !file.Name) {
        throw new Error('File not found');
      }

      return {
        id: fileId,
        name: file.Name,
        size: file.Size,
        mimeType: file.MimeType,
        createdAt: new Date(file.ModTime),
        modifiedAt: new Date(file.ModTime),
      };
    } catch (error: any) {
      logger.error({ error: error.message, fileId, remoteFilePath }, 'Failed to get file metadata');
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

      const { stdout } = await this.runRclone(['link', remoteFilePath], { timeout: 10000 });

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

    // Use the remote name and path for the about command
    // Swift/Blomp requires a container/bucket name (which we store in remotePath)
    const target = remotePath ? `${remoteName}:${remotePath}` : `${remoteName}:`;

    // Strategy 1: Try `rclone about` (works for GDrive, Blomp, OneDrive etc.)
    try {
      logger.debug({ remoteName, target }, 'Fetching quota info via rclone about');

      const { stdout } = await this.runRclone(['about', target, '--json'], { timeout: 20000 });

      const aboutInfo = JSON.parse(stdout);

      if (typeof aboutInfo.total === 'number') {
        return {
          total: aboutInfo.total,
          used: typeof aboutInfo.used === 'number' ? aboutInfo.used : 0,
          available: typeof aboutInfo.free === 'number' ? aboutInfo.free : Math.max(0, aboutInfo.total - (aboutInfo.used || 0)),
          unit: 'bytes',
        };
      }

      // total is missing — fall through to Strategy 2
      logger.debug({ remoteName }, 'rclone about did not return total, trying rclone size fallback');
    } catch (aboutError: any) {
      logger.debug({ remoteName, error: aboutError.message }, 'rclone about failed, trying rclone size fallback');
    }

    // Strategy 2: Try `rclone size`
    try {
      const { stdout } = await this.runRclone(['size', target, '--json'], { timeout: 60000 });

      const sizeInfo = JSON.parse(stdout);
      const usedBytes = typeof sizeInfo.bytes === 'number' ? sizeInfo.bytes : 0;

      logger.info({ remoteName, usedBytes }, 'Got used space via rclone size (no total quota available from provider)');

      // We know the used space but NOT the total capacity.
      // Return 0 for total so the caller knows it must use the DB fallback for capacity.
      return {
        total: 0,
        used: usedBytes,
        available: 0,
        unit: 'bytes',
      };
    } catch (sizeError: any) {
      logger.warn({ remoteName, error: sizeError.message }, 'Both rclone about and rclone size failed');
      throw new Error(`Failed to get quota info: rclone about and rclone size both failed for ${remoteName}`);
    }
  }

  async healthCheck(account: Account): Promise<HealthStatus> {
    const remoteName = await this.getRemoteName(account);
    const startTime = Date.now();

    try {
      await this.runRclone(['lsd', `${remoteName}:`, '--max-depth', '1'], { timeout: 5000 });

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
