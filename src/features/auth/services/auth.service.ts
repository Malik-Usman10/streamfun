import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { appConfig } from '../../../config/index.js';
import { SettingsRepository } from '../../backup/repositories/settings.repository.js';
import logger from '../../../shared/utils/logger.js';

export class AuthService {
  private settingsRepository: SettingsRepository;
  private readonly jwtSecret: string;
  private readonly saltRounds = 10;

  constructor() {
    this.settingsRepository = new SettingsRepository();
    this.jwtSecret = appConfig.auth.jwtSecret;
  }

  /**
   * Check if authentication is enabled
   */
  async isAuthEnabled(): Promise<boolean> {
    const enabled = await this.settingsRepository.get('auth_enabled');
    return enabled === 'true';
  }

  /**
   * Setup admin password
   */
  async setupPassword(password: string): Promise<boolean> {
    try {
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }

      const hash = await bcrypt.hash(password, this.saltRounds);
      await this.settingsRepository.set('admin_password_hash', hash);
      await this.settingsRepository.set('auth_enabled', 'true');
      
      logger.info('Authentication password setup successfully');
      return true;
    } catch (error) {
      logger.error({ error }, 'Failed to setup password');
      throw error;
    }
  }

  /**
   * Disable authentication
   */
  async disableAuth(): Promise<void> {
    await this.settingsRepository.set('auth_enabled', 'false');
    logger.info('Authentication disabled');
  }

  /**
   * Verify password
   */
  async verifyPassword(password: string): Promise<boolean> {
    try {
      const hash = await this.settingsRepository.get('admin_password_hash');
      if (!hash) return false;
      
      return await bcrypt.compare(password, hash);
    } catch (error) {
      logger.error({ error }, 'Failed to verify password');
      return false;
    }
  }

  /**
   * Generate JWT token
   */
  generateToken(): string {
    return jwt.sign(
      { role: 'admin', auth: true },
      this.jwtSecret,
      { expiresIn: '30d' }
    );
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): boolean {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      return decoded && decoded.role === 'admin' && decoded.auth === true;
    } catch (error) {
      return false;
    }
  }
}
