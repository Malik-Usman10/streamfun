// OAuth service for cloud provider authentication
import crypto from 'crypto';
import { RcloneConfigService, RcloneRemote } from './rclone-config.service.js';
import logger from '../utils/logger.js';

export type OAuthProvider = 'google-drive' | 'dropbox' | 'onedrive';

export interface OAuthState {
  token: string;
  provider: OAuthProvider;
  remoteName: string;
  timestamp: number;
  expiresAt: number;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expiry?: string;
  scope?: string;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class OAuthService {
  private states: Map<string, OAuthState> = new Map();
  private stateExpirationMs = 10 * 60 * 1000; // 10 minutes

  constructor(
    private rcloneConfigService: RcloneConfigService,
    private oauthConfigs: Record<OAuthProvider, OAuthConfig>
  ) {
    // Clean up expired states every minute
    setInterval(() => this.cleanupExpiredStates(), 60 * 1000);
  }

  /**
   * Generate a secure random state token
   */
  private generateStateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Store state token with metadata
   */
  private storeState(state: OAuthState): void {
    this.states.set(state.token, state);
    logger.debug({ token: state.token, provider: state.provider }, 'Stored OAuth state');
  }

  /**
   * Validate and retrieve state token
   */
  private validateState(token: string): OAuthState | null {
    const state = this.states.get(token);
    
    if (!state) {
      logger.warn({ token }, 'OAuth state not found');
      return null;
    }
    
    if (Date.now() > state.expiresAt) {
      logger.warn({ token }, 'OAuth state expired');
      this.states.delete(token);
      return null;
    }
    
    return state;
  }

  /**
   * Clean up expired state tokens
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [token, state] of this.states.entries()) {
      if (now > state.expiresAt) {
        this.states.delete(token);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.debug({ cleaned }, 'Cleaned up expired OAuth states');
    }
  }

  /**
   * Generate OAuth authorization URL for Google Drive
   */
  private generateGoogleDriveAuthUrl(state: string, config: OAuthConfig): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive',
      access_type: 'offline',
      prompt: 'consent',
      state
    });
    
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Generate OAuth authorization URL for Dropbox
   */
  private generateDropboxAuthUrl(state: string, config: OAuthConfig): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      token_access_type: 'offline',
      state
    });
    
    return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Generate OAuth authorization URL for OneDrive
   */
  private generateOneDriveAuthUrl(state: string, config: OAuthConfig): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'files.readwrite.all offline_access',
      state
    });
    
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /**
   * Generate OAuth authorization URL for a provider
   */
  generateAuthUrl(provider: OAuthProvider, remoteName: string): { authUrl: string; state: string } {
    const config = this.oauthConfigs[provider];
    if (!config) {
      throw new Error(`OAuth config not found for provider: ${provider}`);
    }

    // Generate state token
    const stateToken = this.generateStateToken();
    const state: OAuthState = {
      token: stateToken,
      provider,
      remoteName,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.stateExpirationMs
    };

    this.storeState(state);

    // Generate provider-specific auth URL
    let authUrl: string;
    switch (provider) {
      case 'google-drive':
        authUrl = this.generateGoogleDriveAuthUrl(stateToken, config);
        break;
      case 'dropbox':
        authUrl = this.generateDropboxAuthUrl(stateToken, config);
        break;
      case 'onedrive':
        authUrl = this.generateOneDriveAuthUrl(stateToken, config);
        break;
      default:
        throw new Error(`Unsupported OAuth provider: ${provider}`);
    }

    logger.info({ provider, remoteName }, 'Generated OAuth authorization URL');
    return { authUrl, state: stateToken };
  }

  /**
   * Exchange authorization code for tokens (Google Drive)
   */
  private async exchangeGoogleDriveTokens(code: string, config: OAuthConfig): Promise<OAuthTokens> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    const data = await response.json() as any;

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      expiry: data.expires_in 
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined
    };
  }

  /**
   * Exchange authorization code for tokens (Dropbox)
   */
  private async exchangeDropboxTokens(code: string, config: OAuthConfig): Promise<OAuthTokens> {
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    const data = await response.json() as any;

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      expiry: data.expires_in 
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined
    };
  }

  /**
   * Exchange authorization code for tokens (OneDrive)
   */
  private async exchangeOneDriveTokens(code: string, config: OAuthConfig): Promise<OAuthTokens> {
    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`);
    }

    const data = await response.json() as any;

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      expiry: data.expires_in 
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined,
      scope: data.scope
    };
  }

  /**
   * Exchange authorization code for access tokens
   */
  async exchangeCodeForTokens(provider: OAuthProvider, code: string): Promise<OAuthTokens> {
    const config = this.oauthConfigs[provider];
    if (!config) {
      throw new Error(`OAuth config not found for provider: ${provider}`);
    }

    try {
      let tokens: OAuthTokens;
      
      switch (provider) {
        case 'google-drive':
          tokens = await this.exchangeGoogleDriveTokens(code, config);
          break;
        case 'dropbox':
          tokens = await this.exchangeDropboxTokens(code, config);
          break;
        case 'onedrive':
          tokens = await this.exchangeOneDriveTokens(code, config);
          break;
        default:
          throw new Error(`Unsupported OAuth provider: ${provider}`);
      }

      logger.info({ provider }, 'Successfully exchanged authorization code for tokens');
      return tokens;
    } catch (error: any) {
      logger.error({ error, provider }, 'Failed to exchange authorization code');
      throw new Error(`Token exchange failed: ${error.message}`);
    }
  }

  /**
   * Handle OAuth callback and create rclone remote
   */
  async handleCallback(code: string, stateToken: string): Promise<RcloneRemote> {
    // Validate state
    const state = this.validateState(stateToken);
    if (!state) {
      throw new Error('Invalid or expired state token');
    }

    // Remove state after validation
    this.states.delete(stateToken);

    try {
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(state.provider, code);

      // Create rclone remote config
      const remote: RcloneRemote = {
        name: state.remoteName,
        type: this.getProviderType(state.provider),
        config: {
          client_id: this.oauthConfigs[state.provider].clientId,
          client_secret: this.oauthConfigs[state.provider].clientSecret,
          token: JSON.stringify({
            access_token: tokens.access_token,
            token_type: tokens.token_type,
            refresh_token: tokens.refresh_token,
            expiry: tokens.expiry
          })
        }
      };

      // Add scope for OneDrive
      if (state.provider === 'onedrive' && tokens.scope) {
        remote.config.scope = tokens.scope;
      }

      // Save to rclone config
      await this.rcloneConfigService.addRemote(remote);

      logger.info({ remoteName: state.remoteName, provider: state.provider }, 'OAuth callback handled successfully');
      return remote;
    } catch (error: any) {
      logger.error({ error, provider: state.provider }, 'Failed to handle OAuth callback');
      throw new Error(`OAuth callback failed: ${error.message}`);
    }
  }

  /**
   * Get rclone provider type from OAuth provider
   */
  private getProviderType(provider: OAuthProvider): string {
    switch (provider) {
      case 'google-drive':
        return 'drive';
      case 'dropbox':
        return 'dropbox';
      case 'onedrive':
        return 'onedrive';
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
