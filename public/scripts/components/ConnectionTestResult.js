/**
 * ConnectionTestResult Component
 * Displays connection test results with success/error indicators
 */

class ConnectionTestResult {
  constructor() {
    this.container = null;
  }

  /**
   * Show success result
   * @param {HTMLElement} container - Container element
   * @param {number} latency - Response time in milliseconds
   */
  showSuccess(container, latency) {
    if (!container) return;

    this.container = container;

    const latencyText = latency ? `${latency}ms` : 'N/A';

    container.innerHTML = `
      <div class="connection-test-result success">
        <div class="result-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="9 12 11 14 15 10"></polyline>
          </svg>
        </div>
        <div class="result-content">
          <h4>Connection Successful</h4>
          <p>Response time: ${latencyText}</p>
        </div>
      </div>
    `;

    // Auto-hide after 5 seconds
    setTimeout(() => {
      this.hide();
    }, 5000);
  }

  /**
   * Show error result
   * @param {HTMLElement} container - Container element
   * @param {string} errorMessage - Error message
   * @param {Function} onRetry - Retry callback
   */
  showError(container, errorMessage, onRetry) {
    if (!container) return;

    this.container = container;

    container.innerHTML = `
      <div class="connection-test-result error">
        <div class="result-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        </div>
        <div class="result-content">
          <h4>Connection Failed</h4>
          <p>${errorMessage}</p>
          ${onRetry ? '<button class="btn btn-sm btn-secondary retry-btn">Retry</button>' : ''}
        </div>
      </div>
    `;

    // Attach retry button listener
    if (onRetry) {
      const retryBtn = container.querySelector('.retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          onRetry();
        });
      }
    }
  }

  /**
   * Show timeout result
   * @param {HTMLElement} container - Container element
   * @param {Function} onRetry - Retry callback
   */
  showTimeout(container, onRetry) {
    if (!container) return;

    this.container = container;

    container.innerHTML = `
      <div class="connection-test-result timeout">
        <div class="result-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </div>
        <div class="result-content">
          <h4>Connection Timeout</h4>
          <p>The remote is not responding. Please check your connection and try again.</p>
          ${onRetry ? '<button class="btn btn-sm btn-secondary retry-btn">Retry</button>' : ''}
        </div>
      </div>
    `;

    // Attach retry button listener
    if (onRetry) {
      const retryBtn = container.querySelector('.retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          onRetry();
        });
      }
    }
  }

  /**
   * Show loading state
   * @param {HTMLElement} container - Container element
   */
  showLoading(container) {
    if (!container) return;

    this.container = container;

    container.innerHTML = `
      <div class="connection-test-result loading">
        <div class="spinner"></div>
        <p>Testing connection...</p>
      </div>
    `;
  }

  /**
   * Hide result
   */
  hide() {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }

  /**
   * Clear result
   */
  clear() {
    this.hide();
  }
}

export default ConnectionTestResult;
