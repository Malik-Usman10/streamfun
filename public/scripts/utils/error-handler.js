/**
 * ErrorHandler Utility
 * Parses backend errors and generates user-friendly messages
 */

class ErrorHandler {
  /**
   * Parse backend error response
   * @param {Error|Object} error - Error object or response
   * @returns {Object} Parsed error state
   */
  static parseError(error) {
    // Check if it's a fetch response error
    if (error.response?.data?.error) {
      return {
        type: error.response.data.type || 'connection',
        message: error.response.data.error || error.response.data.message,
        field: error.response.data.field,
        retryable: error.response.data.retryable !== false,
        details: error.response.data.details,
        suggestions: error.response.data.suggestions
      };
    }

    // Check if it's a direct error object with these properties
    if (error.type && error.message) {
      return {
        type: error.type,
        message: error.message,
        field: error.field,
        retryable: error.retryable !== false,
        details: error.details,
        suggestions: error.suggestions
      };
    }

    // Network error (no response)
    if (!error.response && error instanceof Error) {
      return {
        type: 'connection',
        message: 'Network error. Please check your connection.',
        retryable: true
      };
    }

    // HTTP error status
    if (error.response?.status) {
      const status = error.response.status;
      
      if (status === 404) {
        return {
          type: 'not_found',
          message: 'Resource not found.',
          retryable: false
        };
      }
      
      if (status === 401 || status === 403) {
        return {
          type: 'auth',
          message: 'Authentication failed. Please check your credentials.',
          retryable: false
        };
      }
      
      if (status === 429) {
        return {
          type: 'rate_limit',
          message: 'Too many requests. Please try again later.',
          retryable: true
        };
      }
      
      if (status >= 500) {
        return {
          type: 'server',
          message: 'Server error. Please try again later.',
          retryable: true
        };
      }
    }

    // Unknown error
    return {
      type: 'unknown',
      message: error.message || 'An unexpected error occurred.',
      retryable: true
    };
  }

  /**
   * Categorize error type
   * @param {string} errorMessage - Error message
   * @returns {string} Error category
   */
  static categorizeError(errorMessage) {
    const message = errorMessage.toLowerCase();

    if (message.includes('timeout') || message.includes('timed out')) {
      return 'timeout';
    }

    if (message.includes('authentication') || message.includes('unauthorized') || 
        message.includes('invalid credentials') || message.includes('access denied')) {
      return 'auth';
    }

    if (message.includes('quota') || message.includes('storage full') || 
        message.includes('out of space')) {
      return 'quota';
    }

    if (message.includes('not found') || message.includes('does not exist')) {
      return 'not_found';
    }

    if (message.includes('network') || message.includes('connection') || 
        message.includes('dns') || message.includes('unreachable')) {
      return 'network';
    }

    if (message.includes('permission') || message.includes('forbidden')) {
      return 'permission';
    }

    if (message.includes('invalid') || message.includes('malformed') || 
        message.includes('syntax')) {
      return 'validation';
    }

    if (message.includes('rate limit') || message.includes('too many requests')) {
      return 'rate_limit';
    }

    return 'unknown';
  }

  /**
   * Generate user-friendly error message
   * @param {Object} errorState - Parsed error state
   * @returns {string} User-friendly message
   */
  static getUserFriendlyMessage(errorState) {
    const category = this.categorizeError(errorState.message);

    const messages = {
      timeout: 'Connection timeout. The remote is not responding. Please check your connection and try again.',
      auth: 'Authentication failed. Please check your credentials and try again.',
      quota: 'Storage quota exceeded. Please free up space or add more storage accounts.',
      not_found: 'The requested resource was not found. It may have been deleted or moved.',
      network: 'Network error. Please check your internet connection and try again.',
      permission: 'Permission denied. You do not have access to this resource.',
      validation: 'Invalid configuration. Please check your input and try again.',
      rate_limit: 'Too many requests. Please wait a moment and try again.',
      unknown: 'An unexpected error occurred. Please try again.'
    };

    return messages[category] || errorState.message;
  }

  /**
   * Determine if error is retryable
   * @param {Object} errorState - Parsed error state
   * @returns {boolean} Whether error is retryable
   */
  static isRetryable(errorState) {
    if (errorState.retryable !== undefined) {
      return errorState.retryable;
    }

    const category = this.categorizeError(errorState.message);
    const retryableCategories = ['timeout', 'network', 'rate_limit', 'unknown'];
    
    return retryableCategories.includes(category);
  }

  /**
   * Get error icon SVG
   * @param {string} type - Error type
   * @returns {string} SVG markup
   */
  static getErrorIcon(type) {
    const icons = {
      timeout: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      `,
      auth: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      `,
      quota: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
          <line x1="12" y1="22.08" x2="12" y2="12"></line>
        </svg>
      `,
      network: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
          <line x1="12" y1="20" x2="12.01" y2="20"></line>
        </svg>
      `,
      default: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
      `
    };

    return icons[type] || icons.default;
  }

  /**
   * Format error for display
   * @param {Error|Object} error - Error object
   * @returns {Object} Formatted error
   */
  static formatError(error) {
    const errorState = this.parseError(error);
    const category = this.categorizeError(errorState.message);
    
    return {
      type: category,
      message: this.getUserFriendlyMessage(errorState),
      originalMessage: errorState.message,
      retryable: this.isRetryable(errorState),
      field: errorState.field,
      details: errorState.details,
      suggestions: errorState.suggestions,
      icon: this.getErrorIcon(category)
    };
  }
}

export default ErrorHandler;
