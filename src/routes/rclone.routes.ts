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

    // Map StreamFun provider type to rclone driver type
    const rcloneTypeMap: Record<string, string> = {
      'blomp': 'swift',
      'filen': 'filen',
      'koofr': 'koofr'
    };
    const finalProviderType = rcloneTypeMap[providerType] || providerType;

    // Extract remotePath from config (used for account credentials, not rclone config)
    const { remotePath, ...rcloneConfig } = config;

    // Obscure sensitive fields before creating remote config
    const processedConfig = { ...rcloneConfig };
    
    // Obscure passwords for different provider types
    // NOTE: Blomp (Swift) does NOT require password obscuring - it uses plain text
    if (providerType === 'koofr' && rcloneConfig.password) {
      processedConfig.password = await rcloneConfigService.encryptField(rcloneConfig.password);
    } else if (providerType === 'filen' && rcloneConfig.password) {
      processedConfig.password = await rcloneConfigService.encryptField(rcloneConfig.password);
    } else if (providerType === 'webdav' && rcloneConfig.pass) {
      processedConfig.pass = await rcloneConfigService.encryptField(rcloneConfig.pass);
    }

    // Create remote config object (without remotePath, with obscured passwords)
    const remoteConfig = {
      name: remoteName,
      type: finalProviderType,
      config: processedConfig
    };

    // Create remote with account integration
    const result = await rcloneIntegrationService.createRemoteWithAccount({
      remoteName,
      providerType: providerType as ProviderType,
      remoteConfig,
      accountIdentifier: config.accountIdentifier || remoteName,
      remotePath // Pass remotePath separately for account credentials
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
 * List all rclone remotes with their account info (quick fetch)
 */
router.get('/remotes', async (req: Request, res: Response) => {
  try {
    const remotesWithAccounts = await rcloneIntegrationService.listRemotesWithAccounts();

    const formattedRemotes = remotesWithAccounts.map((item) => {
        // Find corresponding database account info
        const account = item.account;
        
        return {
          name: item.remote.name,
          type: item.remote.type,
          config: maskRemoteConfig(item.remote.config),
          accountId: account?.id,
          // Include cached quota and status if available
          connectionStatus: account ? {
            success: account.status === 'active',
            message: account.healthError || (account.status === 'active' ? 'Online' : 'Offline'),
          } : undefined,
          quota: account?.quotaTotal !== undefined && account?.quotaTotal !== null ? {
            total: Number(account.quotaTotal),
            used: Number(account.quotaUsed || 0),
            available: true, // If we have cached quota, it's available
            usagePercent: account.quotaUsagePercent ? Number(account.quotaUsagePercent) : 0
          } : undefined
        };
      });

    res.json({
      success: true,
      data: formattedRemotes
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
 * GET /api/rclone/remotes/:remoteName/status
 * Get connection status and quota info for a specific remote
 * Uses database cache if available and not stale
 */
router.get('/remotes/:remoteName/status', async (req: Request, res: Response) => {
  try {
    const remoteName = String(req.params.remoteName);
    const forceRefresh = req.query.force === 'true';

    // Get remote and account info
    const remoteInfo = await rcloneIntegrationService.getRemoteInfo(remoteName);

    if (!remoteInfo.remote) {
      return res.status(404).json({
        success: false,
        error: `Remote '${remoteName}' not found`
      });
    }

    const account = remoteInfo.account;
    const cacheStaleTime = 30 * 60 * 1000; // 30 minutes
    const isCacheValid = account && 
                        account.quotaLastCheckedAt && 
                        (new Date().getTime() - new Date(account.quotaLastCheckedAt).getTime() < cacheStaleTime);

    let quotaInfo;
    let connectionStatus = remoteInfo.connectionStatus;

    if (!forceRefresh && isCacheValid && account.quotaTotal !== null) {
      logger.debug({ remoteName }, 'Returning cached quota and status from database');
      quotaInfo = {
        total: account.quotaTotal !== null ? Number(account.quotaTotal) : undefined,
        used: account.quotaUsed !== null ? Number(account.quotaUsed) : 0,
        available: true,
        usagePercent: account.quotaUsagePercent ? Number(account.quotaUsagePercent) : 0
      };
      connectionStatus = {
        success: account.status === 'active',
        message: account.healthError || (account.status === 'active' ? 'Online' : 'Offline')
      };
    } else {
      logger.info({ remoteName, forceRefresh }, 'Fetching fresh quota and status from rclone');
      
      // Get fresh quota info
      let remotePath = remoteInfo.remote?.config.remotePath;
      if (!remotePath && remoteInfo.remote?.type === 'swift' && remoteInfo.remote.config.user) {
        remotePath = remoteInfo.remote.config.user;
      }
      
      quotaInfo = await rcloneIntegrationService.getQuotaInfo(remoteName, remotePath);
      
      // Update account in database with fresh info if account exists
      if (account) {
        try {
          await accountService.updateAccountQuota(account.id, {
            total: quotaInfo.total || 0,
            used: quotaInfo.used || 0,
            available: quotaInfo.free || 0,
            usagePercent: quotaInfo.total ? (Number(quotaInfo.used || 0) / Number(quotaInfo.total)) * 100 : 0,
            lastCheckedAt: new Date()
          });
          
          await accountService.updateAccountHealth(account.id, {
            status: connectionStatus.success ? 'active' : 'error',
            lastCheckedAt: new Date(),
            error: connectionStatus.error
          });
        } catch (dbError) {
          logger.warn({ dbError, accountId: account.id }, 'Failed to update account cache in database');
        }
      }
    }

    res.json({
      success: true,
      data: {
        name: remoteInfo.remote.name,
        connectionStatus,
        quota: quotaInfo,
        lastChecked: account?.quotaLastCheckedAt || new Date().toISOString()
      }
    });
  } catch (error: any) {
    logger.error({ error, remoteName: String(req.params.remoteName) }, 'Failed to get remote status via API');
    
    res.status(500).json({
      success: false,
      error: 'Failed to get remote status',
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

    // Map StreamFun provider type to rclone driver type for validation
    const rcloneTypeMap: Record<string, string> = {
      'blomp': 'swift',
      'filen': 'filen',
      'koofr': 'koofr'
    };
    const finalProviderType = rcloneTypeMap[providerType] || providerType;

    // Extract remotePath from config (used for testing, not for rclone config)
    const { remotePath, ...configWithoutPath } = config;

    // Log config for debugging (without sensitive data)
    logger.debug({ 
      remoteName, 
      providerType, 
      configKeys: Object.keys(configWithoutPath),
      hasRemotePath: !!remotePath 
    }, 'Validating remote configuration');

    // Obscure sensitive fields before creating remote config
    const processedConfig = { ...configWithoutPath };
    
    // Obscure passwords for different provider types
    // NOTE: Blomp (Swift) does NOT require password obscuring - it uses plain text
    if (providerType === 'koofr' && configWithoutPath.password) {
      processedConfig.password = await rcloneConfigService.encryptField(configWithoutPath.password);
    } else if (providerType === 'filen' && configWithoutPath.password) {
      processedConfig.password = await rcloneConfigService.encryptField(configWithoutPath.password);
    } else if (providerType === 'webdav' && configWithoutPath.pass) {
      processedConfig.pass = await rcloneConfigService.encryptField(configWithoutPath.pass);
    }

    // Create a temporary remote config for testing (without remotePath)
    const tempRemoteName = `temp_validate_${Date.now()}`;
    const tempRemoteConfig = {
      name: tempRemoteName,
      type: finalProviderType,
      config: processedConfig
    };

    try {
      // Add temporary remote
      await rcloneConfigService.addRemote(tempRemoteConfig);

      // Test connection with remotePath if provided (for Blomp bucket name)
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
        
        // Provide more helpful error messages for common issues
        let errorMessage = connectionResult.message;
        let suggestions: string[] = [];
        
        if (providerType === 'blomp' && connectionResult.error?.includes('Authorization Failed')) {
          errorMessage = 'Blomp authorization failed. Please check your credentials.';
          suggestions = [
            'Verify your email address is correct',
            'Verify your password is correct',
            'Verify your Blomp username (login name) is correct - this is NOT your email',
            'Make sure your Blomp account is active and not suspended'
          ];
        }
        
        res.status(400).json({
          success: false,
          valid: false,
          errors: {
            connection: errorMessage
          },
          details: connectionResult.error,
          suggestions
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
