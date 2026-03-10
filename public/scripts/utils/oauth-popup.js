/**
 * OAuthPopupManager Utility
 * Manages OAuth popup windows and message handling
 */

class OAuthPopupManager {
  constructor() {
    this.popup = null;
    this.messageListener = null;
    this.timeoutId = null;
    this.checkInterval = null;
  }

  /**
   * Open OAuth popup and wait for result
   * @param {string} authUrl - OAuth authorization URL
   * @param {Object} options - Options
   * @param {number} options.timeout - Timeout in milliseconds (default: 5 minutes)
   * @param {number} options.width - Popup width (default: 600)
   * @param {number} options.height - Popup height (default: 700)
   * @returns {Promise<Object>} OAuth result
   */
  open(authUrl, options = {}) {
    const {
      timeout = 5 * 60 * 1000, // 5 minutes
      width = 600,
      height = 700
    } = options;

    return new Promise((resolve, reject) => {
      // Clean up any existing popup
      this.cleanup();

      // Calculate popup position (centered)
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      // Open popup window
      this.popup = window.open(
        authUrl,
        'oauth-popup',
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,location=no,status=no`
      );

      if (!this.popup) {
        reject(new Error('Failed to open popup window. Please allow popups for this site.'));
        return;
      }

      // Set up message listener
      this.messageListener = (event) => {
        // Verify message origin (in production, check against your domain)
        // if (event.origin !== window.location.origin) return;

        const message = event.data;

        if (message.type === 'oauth-success') {
          this.cleanup();
          resolve({
            success: true,
            remoteName: message.remoteName,
            provider: message.provider
          });
        } else if (message.type === 'oauth-error') {
          this.cleanup();
          reject(new Error(message.error || 'OAuth authentication failed'));
        }
      };

      window.addEventListener('message', this.messageListener);

      // Set up timeout
      this.timeoutId = setTimeout(() => {
        this.cleanup();
        reject(new Error('OAuth authentication timed out'));
      }, timeout);

      // Check if popup was closed by user
      this.checkInterval = setInterval(() => {
        if (this.popup && this.popup.closed) {
          this.cleanup();
          reject(new Error('OAuth authentication was cancelled'));
        }
      }, 500);
    });
  }

  /**
   * Clean up popup and listeners
   */
  cleanup() {
    // Close popup if still open
    if (this.popup && !this.popup.closed) {
      this.popup.close();
    }
    this.popup = null;

    // Remove message listener
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }

    // Clear timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // Clear check interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check if popup is currently open
   * @returns {boolean}
   */
  isOpen() {
    return this.popup && !this.popup.closed;
  }
}

export default OAuthPopupManager;
