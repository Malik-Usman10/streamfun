// Utility functions for masking sensitive credentials

/**
 * Mask a sensitive string, showing only the last N characters
 * @param value - The sensitive value to mask
 * @param visibleChars - Number of characters to show at the end (default: 4)
 * @param maskChar - Character to use for masking (default: '*')
 * @returns Masked string
 */
export function maskCredential(value: string, visibleChars: number = 4, maskChar: string = '*'): string {
  if (!value || value.length === 0) {
    return '';
  }
  
  if (value.length <= visibleChars) {
    // If value is too short, mask everything
    return maskChar.repeat(value.length);
  }
  
  const maskedLength = value.length - visibleChars;
  const masked = maskChar.repeat(maskedLength);
  const visible = value.slice(-visibleChars);
  
  return masked + visible;
}

/**
 * Mask all sensitive fields in a remote config object
 * @param config - Remote configuration object
 * @returns Config with sensitive fields masked
 */
export function maskRemoteConfig(config: Record<string, any>): Record<string, any> {
  const sensitiveFields = [
    'password',
    'pass',
    'token',
    'access_token',
    'refresh_token',
    'client_secret',
    'api_key',
    'secret',
    'key',
    'auth'
  ];
  
  const masked: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(config)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveFields.some(field => lowerKey.includes(field));
    
    if (isSensitive && typeof value === 'string') {
      masked[key] = maskCredential(value);
    } else {
      masked[key] = value;
    }
  }
  
  return masked;
}

/**
 * Check if a field name indicates sensitive data
 * @param fieldName - Name of the field to check
 * @returns True if field is likely sensitive
 */
export function isSensitiveField(fieldName: string): boolean {
  const sensitivePatterns = [
    'password',
    'pass',
    'token',
    'secret',
    'key',
    'auth',
    'credential'
  ];
  
  const lowerName = fieldName.toLowerCase();
  return sensitivePatterns.some(pattern => lowerName.includes(pattern));
}

/**
 * Mask email address (show first 2 chars and domain)
 * @param email - Email address to mask
 * @returns Masked email
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) {
    return maskCredential(email);
  }
  
  const [local, domain] = email.split('@');
  
  if (local.length <= 2) {
    return `${maskCredential(local)}@${domain}`;
  }
  
  return `${local.slice(0, 2)}${'*'.repeat(local.length - 2)}@${domain}`;
}
