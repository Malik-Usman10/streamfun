// File content encryption service
import crypto from 'crypto';
import { Transform } from 'stream';
import { appConfig } from '../config/index.js';
import { EncryptionError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export interface FileEncryptionResult {
  encryptedStream: ReadableStream;
  encryptionKey: string;
  iv: string;
}

export class FileEncryptionService {
  private algorithm = 'aes-256-gcm';
  private masterKey: Buffer;

  constructor() {
    this.masterKey = Buffer.from(appConfig.encryption.fileMasterKey, 'hex');
    
    if (this.masterKey.length !== 32) {
      throw new Error('File master encryption key must be 32 bytes');
    }
  }

  async encryptFile(fileStream: ReadableStream, fileId: string): Promise<FileEncryptionResult> {
    try {
      const fileKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      
      const cipher = crypto.createCipheriv(this.algorithm, fileKey, iv) as crypto.CipherGCM;
      
      // Encrypt the file key with master key
      const encryptedFileKey = await this.encryptKey(fileKey);
      
      // Create transform stream for encryption
      const encryptedStream = fileStream.pipeThrough(
        new TransformStream({
          transform: (chunk, controller) => {
            controller.enqueue(cipher.update(chunk));
          },
          flush: (controller) => {
            controller.enqueue(cipher.final());
            const authTag = cipher.getAuthTag();
            controller.enqueue(authTag);
          },
        })
      );
      
      return {
        encryptedStream,
        encryptionKey: encryptedFileKey.toString('base64'),
        iv: iv.toString('base64'),
      };
    } catch (error) {
      logger.error({ error, fileId }, 'File encryption failed');
      throw new EncryptionError('Failed to encrypt file');
    }
  }

  async decryptFile(
    encryptedStream: ReadableStream,
    encryptionKey: string,
    iv: string
  ): Promise<ReadableStream> {
    try {
      const fileKey = await this.decryptKey(Buffer.from(encryptionKey, 'base64'));
      const ivBuffer = Buffer.from(iv, 'base64');
      
      const decipher = crypto.createDecipheriv(this.algorithm, fileKey, ivBuffer) as crypto.DecipherGCM;
      
      let authTag: Buffer | null = null;
      const authTagSize = 16;
      
      return encryptedStream.pipeThrough(
        new TransformStream({
          transform: (chunk, controller) => {
            // Last 16 bytes are auth tag
            if (chunk.length >= authTagSize) {
              if (authTag) {
                controller.enqueue(decipher.update(authTag));
              }
              authTag = chunk.slice(-authTagSize);
              controller.enqueue(decipher.update(chunk.slice(0, -authTagSize)));
            } else {
              if (authTag) {
                controller.enqueue(decipher.update(authTag));
              }
              authTag = chunk;
            }
          },
          flush: (controller) => {
            if (authTag) {
              decipher.setAuthTag(authTag);
            }
            controller.enqueue(decipher.final());
          },
        })
      );
    } catch (error) {
      logger.error({ error }, 'File decryption failed');
      throw new EncryptionError('Failed to decrypt file');
    }
  }

  async decryptChunk(
    encryptedChunk: Buffer,
    encryptionKey: string,
    iv: string,
    chunkIndex: number
  ): Promise<Buffer> {
    try {
      const fileKey = await this.decryptKey(Buffer.from(encryptionKey, 'base64'));
      const ivBuffer = Buffer.from(iv, 'base64');
      
      // Adjust IV for chunk position (CTR mode style)
      const chunkIv = this.adjustIvForChunk(ivBuffer, chunkIndex);
      
      const decipher = crypto.createDecipheriv(this.algorithm, fileKey, chunkIv) as crypto.DecipherGCM;
      
      // Extract auth tag (last 16 bytes)
      const authTag = encryptedChunk.slice(-16);
      const ciphertext = encryptedChunk.slice(0, -16);
      
      decipher.setAuthTag(authTag);
      
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error) {
      logger.error({ error, chunkIndex }, 'Chunk decryption failed');
      throw new EncryptionError(`Failed to decrypt chunk ${chunkIndex}`);
    }
  }

  private adjustIvForChunk(iv: Buffer, chunkIndex: number): Buffer {
    const chunkIv = Buffer.from(iv);
    const chunkSize = appConfig.upload.chunkSize;
    const blockOffset = Math.floor((chunkIndex * chunkSize) / 16);
    
    // Add block offset to IV counter
    let carry = blockOffset;
    for (let i = 15; i >= 0 && carry > 0; i--) {
      const sum = chunkIv[i] + (carry & 0xff);
      chunkIv[i] = sum & 0xff;
      carry = Math.floor(sum / 256);
    }
    
    return chunkIv;
  }

  private async encryptKey(key: Buffer): Promise<Buffer> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv) as crypto.CipherGCM;
    
    const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    // Format: iv + authTag + encrypted
    return Buffer.concat([iv, authTag, encrypted]);
  }

  private async decryptKey(encryptedKey: Buffer): Promise<Buffer> {
    const iv = encryptedKey.slice(0, 16);
    const authTag = encryptedKey.slice(16, 32);
    const encrypted = encryptedKey.slice(32);
    
    const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);
    
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  async generateFileKey(): Promise<{ encryptionKey: string; iv: string }> {
    const fileKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    
    const encryptedFileKey = await this.encryptKey(fileKey);
    
    return {
      encryptionKey: encryptedFileKey.toString('base64'),
      iv: iv.toString('base64'),
    };
  }

    async encryptChunk(
      chunk: Buffer,
      encryptionKey: string,
      iv: string,
      chunkIndex: number
    ): Promise<Buffer> {
      try {
        const fileKey = await this.decryptKey(Buffer.from(encryptionKey, 'base64'));
        const ivBuffer = Buffer.from(iv, 'base64');

        // Adjust IV for chunk position
        const chunkIv = this.adjustIvForChunk(ivBuffer, chunkIndex);

        const cipher = crypto.createCipheriv(this.algorithm, fileKey, chunkIv) as crypto.CipherGCM;

        const encrypted = Buffer.concat([cipher.update(chunk), cipher.final()]);
        const authTag = cipher.getAuthTag();

        // Append auth tag to encrypted data
        return Buffer.concat([encrypted, authTag]);
      } catch (error) {
        logger.error({ error, chunkIndex }, 'Chunk encryption failed');
        throw new EncryptionError(`Failed to encrypt chunk ${chunkIndex}`);
      }
    }
}
