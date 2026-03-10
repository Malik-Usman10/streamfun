// Encryption service for credentials and tokens
import crypto from 'crypto';
import { appConfig } from '../config/index.js';
import { EncryptionError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export class EncryptionService {
  private algorithm = 'aes-256-gcm';
  private masterKey: Buffer;

  constructor() {
    this.masterKey = Buffer.from(appConfig.encryption.masterKey, 'hex');
    
    if (this.masterKey.length !== 32) {
      throw new Error('Master encryption key must be 32 bytes (64 hex characters)');
    }
  }

  async encrypt(plaintext: string): Promise<string> {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv) as crypto.CipherGCM;
      
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      // Format: iv:authTag:encrypted
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      logger.error({ error }, 'Encryption failed');
      throw new EncryptionError('Failed to encrypt data');
    }
  }

  async decrypt(ciphertext: string): Promise<string> {
    try {
      const parts = ciphertext.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid ciphertext format');
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv) as crypto.DecipherGCM;
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error({ error }, 'Decryption failed');
      throw new EncryptionError('Failed to decrypt data');
    }
  }
}
