// Master key service for encrypting file encryption keys
import crypto from 'crypto';
import { appConfig } from '../config/index.js';
import { EncryptionError } from '../utils/errors.js';

export class MasterKeyService {
  private algorithm = 'aes-256-gcm';
  private masterKey: Buffer;

  constructor() {
    this.masterKey = Buffer.from(appConfig.encryption.fileMasterKey, 'hex');
    
    if (this.masterKey.length !== 32) {
      throw new Error('File master key must be 32 bytes');
    }
  }

  async encryptKey(key: Buffer): Promise<Buffer> {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv) as crypto.CipherGCM;
      
      const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
      const authTag = cipher.getAuthTag();
      
      return Buffer.concat([iv, authTag, encrypted]);
    } catch (error) {
      throw new EncryptionError('Failed to encrypt key');
    }
  }

  async decryptKey(encryptedKey: Buffer): Promise<Buffer> {
    try {
      const iv = encryptedKey.slice(0, 16);
      const authTag = encryptedKey.slice(16, 32);
      const encrypted = encryptedKey.slice(32);
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv) as crypto.DecipherGCM;
      decipher.setAuthTag(authTag);
      
      return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch (error) {
      throw new EncryptionError('Failed to decrypt key');
    }
  }
}
