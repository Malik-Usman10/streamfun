// Validation utilities for rclone configuration

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface RemoteNameValidationResult extends ValidationResult {
  suggestedName?: string;
}

/**
 * Validate remote name
 * Rules:
 * - Alphanumeric, hyphens, underscores only
 * - Not empty
 * - Max 50 characters
 * - Must not already exist
 */
export function validateRemoteName(
  name: string,
  existingNames: string[] = []
): RemoteNameValidationResult {
  const errors: string[] = [];

  // Check if empty
  if (!name || name.trim().length === 0) {
    errors.push('Remote name cannot be empty');
    return { valid: false, errors };
  }

  const trimmedName = name.trim();

  // Check length
  if (trimmedName.length > 50) {
    errors.push('Remote name must be 50 characters or less');
  }

  // Check for valid characters (alphanumeric, hyphens, underscores)
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(trimmedName)) {
    errors.push('Remote name can only contain letters, numbers, hyphens, and underscores');
  }

  // Check for uniqueness
  const isDuplicate = existingNames.some(
    existing => existing.toLowerCase() === trimmedName.toLowerCase()
  );

  if (isDuplicate) {
    errors.push(`Remote name '${trimmedName}' already exists`);
    
    // Suggest alternative name
    const suggestedName = generateUniqueName(trimmedName, existingNames);
    
    return {
      valid: false,
      errors,
      suggestedName
    };
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Generate a unique remote name by appending a number
 */
function generateUniqueName(baseName: string, existingNames: string[]): string {
  let counter = 1;
  let suggestedName = `${baseName}-${counter}`;

  while (existingNames.some(name => name.toLowerCase() === suggestedName.toLowerCase())) {
    counter++;
    suggestedName = `${baseName}-${counter}`;
  }

  return suggestedName;
}

/**
 * Validate WebDAV URL format
 */
export function validateWebDAVUrl(url: string): ValidationResult {
  const errors: string[] = [];

  // Check if empty
  if (!url || url.trim().length === 0) {
    errors.push('URL cannot be empty');
    return { valid: false, errors };
  }

  const trimmedUrl = url.trim();

  // Check for http:// or https:// protocol
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    errors.push('URL must start with http:// or https://');
  }

  // Try to parse as URL
  try {
    const parsedUrl = new URL(trimmedUrl);
    
    // Check if hostname exists
    if (!parsedUrl.hostname) {
      errors.push('URL must have a valid hostname');
    }
  } catch (error) {
    errors.push('Invalid URL format');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate credentials (username/password)
 */
export function validateCredentials(username: string, password: string): ValidationResult {
  const errors: string[] = [];

  if (!username || username.trim().length === 0) {
    errors.push('Username cannot be empty');
  }

  if (!password || password.trim().length === 0) {
    errors.push('Password cannot be empty');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate OAuth client credentials
 */
export function validateOAuthCredentials(clientId: string, clientSecret: string): ValidationResult {
  const errors: string[] = [];

  if (!clientId || clientId.trim().length === 0) {
    errors.push('Client ID cannot be empty');
  }

  if (!clientSecret || clientSecret.trim().length === 0) {
    errors.push('Client Secret cannot be empty');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate provider type
 */
export function validateProviderType(providerType: string): ValidationResult {
  const validProviders = [
    'rclone',
    'mock',
    'google-drive',
    'dropbox',
    'onedrive',
    'webdav',
    'blomp',
    'filen',
    'koofr',
    'swift'
  ];

  const errors: string[] = [];

  if (!providerType || providerType.trim().length === 0) {
    errors.push('Provider type cannot be empty');
  } else if (!validProviders.includes(providerType.toLowerCase())) {
    errors.push(`Invalid provider type. Must be one of: ${validProviders.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Sanitize remote name (remove invalid characters)
 */
export function sanitizeRemoteName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-') // Replace invalid chars with hyphen
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .substring(0, 50); // Limit to 50 chars
}
