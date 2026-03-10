// API routes for rclone configuration management
import { Router, Request, Response } from 'express';
import { RcloneConfigService } from '../services/rclone-config.service.js';
import { RcloneIntegrationService } from '../services/rclone-integration.service.js';
import { OAuthService, OAuthConfig } from '../services/oauth.service.js';
import { AccountService } from '../services/account.service.js';
import { validateRemoteName, validateWebDAVUrl, validateCredentials } from '../utils/rclone-validation.js';
import { maskRemoteConfig } from '../utils/credential-masking.js';
import { ErrorParser } from '../utils/error-parser.js';
import { ProviderType } from '../types/index.js';
import { appConfig } from '../config/index.js';
import logger from '../utils/logger.js';

export function createRcloneRoutes(accountService: AccountService): Router {
  const router = Router();

  // Initialize OAuth configs from environment variables
  const oauthConfigs: Record<string, OAuthConfig> = {
    'google-drive': {
      clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || '',
      redirectUri: `${appConfig.server.apiBaseUrl}/api/rclone/oauth/callback`
    },
    'dropbox': {
      clientId: process.env.DROPBOX_CLIENT_ID || '',
      clientSecret: process.env.DROPBOX_CLIENT_SECRET || '',
      redirectUri: `${appConfig.server.apiBaseUrl}/api/rclone/oauth/callback`
    },
    'onedrive': {
      clientId: process.env.ONEDRIVE_CLIENT_ID || '',
      clientSecret: process.env.ONEDRIVE_CLIENT_SECRET || '',
      redirectUri: `${appConfig.server.apiBaseUrl}/api/rclone/oauth/callback`
    }
  };

  // Initialize services
  const rcloneConfigService = new RcloneConfigService();
  const rcloneIntegrationService = new RcloneIntegrationService(
    rcloneConfigService,
    accountService
  );
  const oauthService = new OAuthService(rcloneConfigService, oauthConfigs);

  /**
   * POST /api/rclone/remotes
   * Create a new rclone remote
   */
  router.post('/remotes', async (req: Request, res: Response) => {
  try {
    const { remoteName, providerType, config } = req.body;

    // Validate required fields
    if (!remoteName || !providerType || !config) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: remoteName, providerType, config'
      });
    }

    // Validate remote name
    const existingRemotes = await rcloneConfigService.listRemotes();
    const existingNames = existingRemotes.map(r => r.name);
    const nameValidation = validateRemoteName(remoteName, existingNames);

    if (!nameValidation.valid) {
      return res.status(400).json({
        success: false,
        error: nameValidation.errors.join(', '),
        suggestedName: nameValidation.suggestedName
      });
    }

    // Validate provider-specific configuration
    if (providerType === 'webdav' && config.url) {
      const urlValidation = validateWebDAVUrl(config.url);
      if (!urlValidation.valid) {
        return res.status(400).json({
          success: false,
          error: urlValidation.errors.join(', ')
        });
      }

      // Validate credentials for WebDAV
      if (config.user && config.pass) {
        const credValidation = validateCredentials(config.user, config.pass);
        if (!credValidation.valid) {
          return res.status(400).json({
            success: false,
            error: credValidation.errors.join(', ')
          });
        }
      }
    }

    // Create remote config object
    const remoteConfig = {
      name: remoteName,
      type: providerType,
      config: config
    };

    // Create remote with account integration
    const result = await rcloneIntegrationService.createRemoteWithAccount({
      remoteName,
      providerType: providerType as ProviderType,
      remoteConfig,
      accountIdentifier: config.accountIdentifier || remoteName
    });

    logger.info({ remoteName, accountId: result.accountId }, 'Remote created successfully via API');

    res.status(201).json({
      success: true,
      data: {
        remoteName: result.remote.name,
        accountId: result.accountId,
        providerType: result.remote.type
      }
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to create remote via API');
    
    const parsedError = ErrorParser.parseRcloneError(error.message);
    
    res.status(500).json({
      success: false,
      error: parsedError.userFriendlyMessage,
      details: error.message,
      suggestions: parsedError.suggestions
    });
  }
});

/**
 * GET /api/rclone/remotes
 * List all rclone remotes with status and quota info
 */
router.get('/remotes', async (req: Request, res: Response) => {
  try {
    const remotesWithStatus = await rcloneIntegrationService.listRemotesWithStatus();

    // Fetch quota info for each remote
    const remotesWithQuota = await Promise.all(
      remotesWithStatus.map(async (item) => {
        // Extract remotePath from rclone config if available
        // For Swift/Blomp, use the user field (email) as fallback
        let remotePath = item.remote.config.remotePath;
        if (!remotePath && item.remote.type === 'swift' && item.remote.config.user) {
          remotePath = item.remote.config.user;
        }
        
        const quotaInfo = await rcloneIntegrationService.getQuotaInfo(item.remote.name, remotePath);
        
        return {
          name: item.remote.name,
          type: item.remote.type,
          config: maskRemoteConfig(item.remote.config),
          accountId: item.account?.id,
          connectionStatus: item.connectionStatus,
          quota: quotaInfo
        };
      })
    );

    res.json({
      success: true,
      data: remotesWithQuota
    });
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Failed to list remotes via API');
    
    res.status(500).json({
      success: false,
      error: 'Failed to list remotes',
      details: error.message
    });
  }
});

/**
 * GET /api/rclone/remotes/:remoteName
 * Get detailed information for a specific remote
 */
router.get('/remotes/:remoteName', async (req: Request, res: Response) => {
  try {
    const remoteName = String(req.params.remoteName);

    const remoteInfo = await rcloneIntegrationService.getRemoteInfo(remoteName);

    if (!remoteInfo.remote) {
      return res.status(404).json({
        success: false,
        error: `Remote '${remoteName}' not found`
      });
    }

    // Get quota info
    // For Swift/Blomp, use the user field (email) as fallback
    let remotePath = remoteInfo.remote?.config.remotePath;
    if (!remotePath && remoteInfo.remote?.type === 'swift' && remoteInfo.remote.config.user) {
      remotePath = remoteInfo.remote.config.user;
    }
    
    const quotaInfo = await rcloneIntegrationService.getQuotaInfo(remoteName, remotePath);

    res.json({
      success: true,
      data: {
        name: remoteInfo.remote.name,
        type: remoteInfo.remote.type,
        config: maskRemoteConfig(remoteInfo.remote.config),
        accountId: remoteInfo.account?.id,
        connectionStatus: remoteInfo.connectionStatus,
        quota: quotaInfo,
        lastChecked: new Date().toISOString()
      }
    });
  } catch (error: any) {
    logger.error({ error, remoteName: String(req.params.remoteName) }, 'Failed to get remote info via API');
    
    res.status(500).json({
      success: false,
      error: 'Failed to get remote information',
      details: error.message
    });
  }
});

/**
 * PUT /api/rclone/remotes/:remoteName
 * Update an existing remote
 */
router.put('/remotes/:remoteName', async (req: Request, res: Response) => {
  try {
    const remoteName = String(req.params.remoteName);
    const { config, credentials } = req.body;

    if (!config && !credentials) {
      return res.status(400).json({
        success: false,
        error: 'No updates provided'
      });
    }

    const updates: any = {};
    if (config) {
      updates.config = config;
    }

    await rcloneIntegrationService.updateRemoteWithAccount(
      remoteName,
      updates,
      credentials ? { credentials } : undefined
    );

    logger.info({ remoteName }, 'Remote updated successfully via API');

    res.json({
      success: true,
      message: 'Remote updated successfully'
    });
  } catch (error: any) {
    logger.error({ error, remoteName: String(req.params.remoteName) }, 'Failed to update remote via API');
    
    const parsedError = ErrorParser.parseRcloneError(error.message);
    
    res.status(500).json({
      success: false,
      error: parsedError.userFriendlyMessage,
      details: error.message,
      suggestions: parsedError.suggestions
    });
  }
});

/**
 * DELETE /api/rclone/remotes/:remoteName
 * Delete a remote and its associated account
 */
router.delete('/remotes/:remoteName', async (req: Request, res: Response) => {
  try {
    const remoteName = String(req.params.remoteName);

    await rcloneIntegrationService.deleteRemoteWithAccount(remoteName);

    logger.info({ remoteName }, 'Remote deleted successfully via API');

    res.json({
      success: true,
      message: 'Remote deleted successfully'
    });
  } catch (error: any) {
    logger.error({ error, remoteName: String(req.params.remoteName) }, 'Failed to delete remote via API');
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete remote',
      details: error.message
    });
  }
});

/**
 * POST /api/rclone/remotes/:remoteName/test
 * Test connection to a remote
 */
router.post('/remotes/:remoteName/test', async (req: Request, res: Response) => {
  try {
    const remoteName = String(req.params.remoteName);

    // Get remote to extract remotePath
    const remote = await rcloneConfigService.getRemote(remoteName);
    
    // For Swift/Blomp, use the user field (email) as fallback
    let remotePath = remote?.config.remotePath;
    if (!remotePath && remote?.type === 'swift' && remote.config.user) {
      remotePath = remote.config.user;
    }

    const result = await rcloneIntegrationService.testConnection(remoteName, 10000, remotePath);

    res.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    logger.error({ error, remoteName: String(req.params.remoteName) }, 'Failed to test connection via API');
    
    res.status(500).json({
      success: false,
      error: 'Failed to test connection',
      details: error.message
    });
  }
});

/**
 * POST /api/rclone/remotes/:remoteName/validate
 * Validate configuration without saving and test connection
 */
router.post('/remotes/:remoteName/validate', async (req: Request, res: Response) => {
  try {
    const remoteName = String(req.params.remoteName);
    const { providerType, config } = req.body;

    if (!providerType || !config) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: providerType, config'
      });
    }

    const validationErrors: Record<string, string> = {};

    // Validate remote name
    const existingRemotes = await rcloneConfigService.listRemotes();
    const existingNames = existingRemotes.map(r => r.name);
    const nameValidation = validateRemoteName(remoteName, existingNames);

    if (!nameValidation.valid) {
      validationErrors.remoteName = nameValidation.errors.join(', ');
    }

    // Validate provider-specific configuration
    if (providerType === 'webdav') {
      if (config.url) {
        const urlValidation = validateWebDAVUrl(config.url);
        if (!urlValidation.valid) {
          validationErrors.url = urlValidation.errors.join(', ');
        }
      } else {
        validationErrors.url = 'URL is required for WebDAV';
      }

      if (config.user && config.pass) {
        const credValidation = validateCredentials(config.user, config.pass);
        if (!credValidation.valid) {
          validationErrors.credentials = credValidation.errors.join(', ');
        }
      } else {
        if (!config.user) validationErrors.user = 'Username is required';
        if (!config.pass) validationErrors.pass = 'Password is required';
      }
    }

    // If there are validation errors, return them
    if (Object.keys(validationErrors).length > 0) {
      return res.status(400).json({
        success: false,
        valid: false,
        errors: validationErrors
      });
    }

    // Create a temporary remote config for testing
    const tempRemoteName = `temp_validate_${Date.now()}`;
    const tempRemoteConfig = {
      name: tempRemoteName,
      type: providerType,
      config: config
    };

    try {
      // Add temporary remote
      await rcloneConfigService.addRemote(tempRemoteConfig);

      // Test connection with remotePath if provided
      const remotePath = config.remotePath;
      const connectionResult = await rcloneIntegrationService.testConnection(tempRemoteName, 15000, remotePath);

      // Clean up temporary remote
      await rcloneConfigService.deleteRemote(tempRemoteName);

      if (connectionResult.success) {
        logger.info({ remoteName }, 'Validation successful');
        res.json({
          success: true,
          valid: true,
          message: 'Configuration is valid and connection successful'
        });
      } else {
        logger.warn({ remoteName, error: connectionResult.error }, 'Validation failed - connection test failed');
        res.status(400).json({
          success: false,
          valid: false,
          errors: {
            connection: connectionResult.message
          },
          details: connectionResult.error
        });
      }
    } catch (testError: any) {
      // Clean up temporary remote if it was created
      try {
        await rcloneConfigService.deleteRemote(tempRemoteName);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      logger.error({ error: testError, remoteName }, 'Validation failed - error during test');
      
      const parsedError = ErrorParser.parseRcloneError(testError.message);
      
      res.status(400).json({
        success: false,
        valid: false,
        errors: {
          connection: parsedError.userFriendlyMessage
        },
        details: testError.message,
        suggestions: parsedError.suggestions
      });
    }
  } catch (error: any) {
    logger.error({ error, remoteName: String(req.params.remoteName) }, 'Failed to validate remote via API');
    
    res.status(500).json({
      success: false,
      error: 'Failed to validate remote',
      details: error.message
    });
  }
});

/**
 * GET /api/rclone/oauth/authorize/:provider
 * Generate OAuth authorization URL for a provider
 */
router.get('/oauth/authorize/:provider', async (req: Request, res: Response) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const { remoteName } = req.query;

    if (!remoteName || typeof remoteName !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing required query parameter: remoteName'
      });
    }

    // Validate provider
    const validProviders = ['google-drive', 'dropbox', 'onedrive'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        success: false,
        error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`
      });
    }

    // Generate OAuth URL
    const { authUrl, state } = oauthService.generateAuthUrl(
      provider as 'google-drive' | 'dropbox' | 'onedrive',
      remoteName
    );

    logger.info({ provider, remoteName, state }, 'Generated OAuth authorization URL');

    res.json({
      success: true,
      data: {
        authUrl,
        state
      }
    });
  } catch (error: any) {
    logger.error({ error, provider: String(req.params.provider) }, 'Failed to generate OAuth URL');
    
    res.status(500).json({
      success: false,
      error: 'Failed to generate OAuth authorization URL',
      details: error.message
    });
  }
});

/**
 * GET /api/rclone/oauth/callback
 * Handle OAuth callback and create remote
 */
router.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Error</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
              .error { color: #d32f2f; }
            </style>
          </head>
          <body>
            <h1 class="error">OAuth Error</h1>
            <p>Missing authorization code</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'oauth-error', 
                  error: 'Missing authorization code' 
                }, '*');
                setTimeout(() => window.close(), 2000);
              }
            </script>
          </body>
        </html>
      `);
    }

    if (!state || typeof state !== 'string') {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Error</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
              .error { color: #d32f2f; }
            </style>
          </head>
          <body>
            <h1 class="error">OAuth Error</h1>
            <p>Missing state token</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'oauth-error', 
                  error: 'Missing state token' 
                }, '*');
                setTimeout(() => window.close(), 2000);
              }
            </script>
          </body>
        </html>
      `);
    }

    try {
      // Handle OAuth callback - this will exchange code for tokens and create remote
      const remote = await oauthService.handleCallback(code, state);

      // Create account entry for the remote
      const providerTypeMap: Record<string, ProviderType> = {
        'drive': ProviderType.GOOGLE_DRIVE,
        'dropbox': ProviderType.DROPBOX,
        'onedrive': ProviderType.ONEDRIVE
      };

      const providerType = providerTypeMap[remote.type] || remote.type as ProviderType;

      await rcloneIntegrationService.createRemoteWithAccount({
        remoteName: remote.name,
        providerType,
        remoteConfig: remote,
        accountIdentifier: remote.name
      });

      logger.info({ remoteName: remote.name, provider: remote.type }, 'OAuth callback successful');

      // Return success HTML that closes popup and notifies parent
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Success</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
              .success { color: #388e3c; }
            </style>
          </head>
          <body>
            <h1 class="success">Authorization Successful!</h1>
            <p>You can close this window now.</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'oauth-success', 
                  remoteName: '${remote.name}',
                  provider: '${remote.type}'
                }, '*');
                setTimeout(() => window.close(), 1000);
              }
            </script>
          </body>
        </html>
      `);
    } catch (callbackError: any) {
      logger.error({ error: callbackError, code, state }, 'OAuth callback failed');

      const errorMessage = callbackError.message || 'Token exchange failed';

      res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Error</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
              .error { color: #d32f2f; }
            </style>
          </head>
          <body>
            <h1 class="error">Authorization Failed</h1>
            <p>${errorMessage}</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'oauth-error', 
                  error: '${errorMessage.replace(/'/g, "\\'")}' 
                }, '*');
                setTimeout(() => window.close(), 3000);
              }
            </script>
          </body>
        </html>
      `);
    }
  } catch (error: any) {
    logger.error({ error }, 'Unexpected error in OAuth callback');
    
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>OAuth Error</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
            .error { color: #d32f2f; }
          </style>
        </head>
        <body>
          <h1 class="error">Unexpected Error</h1>
          <p>An unexpected error occurred. Please try again.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'oauth-error', 
                error: 'Unexpected error occurred' 
              }, '*');
              setTimeout(() => window.close(), 3000);
            }
          </script>
        </body>
      </html>
    `);
  }
});

  return router;
}

export default createRcloneRoutes;
