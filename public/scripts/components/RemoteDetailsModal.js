/**
 * RemoteDetailsModal Component
 * Displays comprehensive information about a remote
 */

import { formatBytes } from '../utils/format.js';
import { trapFocus, showError } from '../utils/dom.js';

class RemoteDetailsModal {
  constructor() {
    this.modal = null;
    this.focusTrap = null;
    this.remoteData = null;
    
    this.createModal();
  }

  /**
   * Create modal element
   */
  createModal() {
    // Create modal overlay
    this.modal = document.createElement('div');
    this.modal.className = 'modal-overlay remote-details-modal';
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-labelledby', 'remote-details-title');
    
    this.modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="remote-details-title">Remote Details</h2>
          <button class="modal-close" id="remote-details-close" aria-label="Close details">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div class="modal-body" id="remote-details-body">
          <!-- Content will be dynamically inserted -->
        </div>
      </div>
    `;
    
    document.body.appendChild(this.modal);
    
    this.attachEventListeners();
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button
    const closeButton = this.modal.querySelector('#remote-details-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        this.close();
      });
    }

    // Backdrop click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal.classList.contains('active')) {
        this.close();
      }
    });
  }

  /**
   * Show modal with remote details
   * @param {string} remoteName - Remote name
   */
  async show(remoteName) {
    try {
      // Fetch remote details
      const response = await fetch(`/api/rclone/remotes/${remoteName}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch remote details');
      }

      this.remoteData = data.data;
      this.render();
      this.open();

    } catch (error) {
      console.error('Failed to load remote details:', error);
      showError(`Failed to load details: ${error.message}`);
    }
  }

  /**
   * Render modal content
   */
  render() {
    const body = this.modal.querySelector('#remote-details-body');
    if (!body || !this.remoteData) return;

    const remote = this.remoteData;
    const statusClass = remote.connectionStatus?.success ? 'status-online' : 'status-offline';
    const statusText = remote.connectionStatus?.success ? 'Online' : 'Offline';

    body.innerHTML = `
      <div class="details-section">
        <h3>Basic Information</h3>
        <div class="details-grid">
          <div class="detail-item">
            <span class="detail-label">Remote Name</span>
            <span class="detail-value">${remote.name}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Provider Type</span>
            <span class="detail-value">${this.formatProviderName(remote.type)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Status</span>
            <span class="detail-value ${statusClass}">${statusText}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Last Checked</span>
            <span class="detail-value">${this.formatDate(remote.lastChecked)}</span>
          </div>
        </div>
      </div>

      ${remote.quota?.available ? `
        <div class="details-section">
          <h3>Storage Quota</h3>
          <div class="quota-details">
            <div class="quota-bar-large">
              <div class="quota-fill" style="width: ${this.calculateQuotaPercent(remote.quota)}%"></div>
            </div>
            <div class="details-grid">
              <div class="detail-item">
                <span class="detail-label">Total Space</span>
                <span class="detail-value">${formatBytes(remote.quota.total || 0)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Used Space</span>
                <span class="detail-value">${formatBytes(remote.quota.used || 0)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Free Space</span>
                <span class="detail-value">${formatBytes(remote.quota.free || 0)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Usage</span>
                <span class="detail-value">${this.calculateQuotaPercent(remote.quota)}%</span>
              </div>
            </div>
          </div>
        </div>
      ` : `
        <div class="details-section">
          <h3>Storage Quota</h3>
          <p class="quota-unavailable">Quota information is not available for this remote</p>
        </div>
      `}

      ${remote.config && Object.keys(remote.config).length > 0 ? `
        <div class="details-section">
          <h3>Configuration</h3>
          <div class="details-grid">
            ${Object.entries(remote.config).map(([key, value]) => `
              <div class="detail-item">
                <span class="detail-label">${this.formatConfigKey(key)}</span>
                <span class="detail-value">${this.formatConfigValue(key, value)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${!remote.connectionStatus?.success && remote.connectionStatus?.error ? `
        <div class="details-section">
          <h3>Connection Error</h3>
          <div class="error-details">
            <p>${remote.connectionStatus.message}</p>
            ${remote.connectionStatus.error ? `
              <details>
                <summary>Technical Details</summary>
                <pre>${remote.connectionStatus.error}</pre>
              </details>
            ` : ''}
          </div>
        </div>
      ` : ''}

      ${remote.accountId ? `
        <div class="details-section">
          <h3>Account Information</h3>
          <div class="details-grid">
            <div class="detail-item">
              <span class="detail-label">Account ID</span>
              <span class="detail-value">${remote.accountId}</span>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }

  /**
   * Format provider name for display
   * @param {string} type - Provider type
   * @returns {string} Formatted name
   */
  formatProviderName(type) {
    const names = {
      'koofr': 'Koofr',
      'blomp': 'Blomp',
      'filen': 'Filen'
    };
    return names[type] || type;
  }

  /**
   * Format date for display
   * @param {string} dateString - ISO date string
   * @returns {string} Formatted date
   */
  formatDate(dateString) {
    if (!dateString) return 'Unknown';
    
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch (error) {
      return 'Unknown';
    }
  }

  /**
   * Calculate quota percentage
   * @param {Object} quota - Quota object
   * @returns {number} Percentage
   */
  calculateQuotaPercent(quota) {
    if (!quota || !quota.total || quota.total === 0) return 0;
    return Math.round(((quota.used || 0) / quota.total) * 100);
  }

  /**
   * Format configuration key for display
   * @param {string} key - Config key
   * @returns {string} Formatted key
   */
  formatConfigKey(key) {
    // Convert snake_case or camelCase to Title Case
    return key
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
      .trim();
  }

  /**
   * Format configuration value for display
   * @param {string} key - Config key
   * @param {any} value - Config value
   * @returns {string} Formatted value
   */
  formatConfigValue(key, value) {
    // Mask sensitive fields
    const sensitiveFields = ['pass', 'password', 'token', 'secret', 'key'];
    const isSensitive = sensitiveFields.some(field => key.toLowerCase().includes(field));
    
    if (isSensitive) {
      return '••••••••';
    }

    // Handle different value types
    if (value === null || value === undefined) {
      return 'Not set';
    }

    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  /**
   * Open modal
   */
  open() {
    this.modal.classList.add('active');
    this.modal.classList.add('opening');
    document.body.style.overflow = 'hidden';

    // Set up focus trap
    this.focusTrap = trapFocus(this.modal);

    // Remove opening class after animation
    setTimeout(() => {
      this.modal.classList.remove('opening');
    }, 300);
  }

  /**
   * Close modal
   */
  close() {
    this.modal.classList.add('closing');

    // Remove focus trap
    if (this.focusTrap) {
      this.focusTrap();
      this.focusTrap = null;
    }

    setTimeout(() => {
      this.modal.classList.remove('active');
      this.modal.classList.remove('closing');
      document.body.style.overflow = '';
    }, 200);
  }

  /**
   * Check if modal is open
   * @returns {boolean}
   */
  isOpen() {
    return this.modal.classList.contains('active');
  }

  /**
   * Destroy modal and cleanup
   */
  destroy() {
    if (this.isOpen()) {
      this.close();
    }

    if (this.modal && this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }

    this.modal = null;
    this.focusTrap = null;
    this.remoteData = null;
  }
}

export default RemoteDetailsModal;
