/**
 * RemoteEditModal Component
 * Modal for editing existing remote configurations
 */

import { trapFocus, showError, showSuccess } from '../utils/dom.js';

class RemoteEditModal {
  constructor() {
    this.modal = null;
    this.focusTrap = null;
    this.remoteName = null;
    this.remoteData = null;
    this.onSave = null;
    this.onCancel = null;
    
    this.createModal();
  }

  /**
   * Create modal element
   */
  createModal() {
    this.modal = document.createElement('div');
    this.modal.className = 'modal-overlay remote-edit-modal';
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-labelledby', 'edit-modal-title');
    
    this.modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="edit-modal-title">Edit Remote</h2>
          <button class="modal-close" id="edit-modal-close" aria-label="Close modal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div class="modal-body" id="edit-modal-body">
          <div class="loading-state" style="display: flex; justify-content: center; padding: 48px;">
            <div class="spinner"></div>
            <p style="margin-left: 16px;">Loading remote configuration...</p>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-secondary" id="edit-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="edit-save-btn" disabled>Save Changes</button>
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
    const closeButton = this.modal.querySelector('#edit-modal-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        this.handleCancel();
      });
    }

    // Cancel button
    const cancelButton = this.modal.querySelector('#edit-cancel-btn');
    if (cancelButton) {
      cancelButton.addEventListener('click', () => {
        this.handleCancel();
      });
    }

    // Save button
    const saveButton = this.modal.querySelector('#edit-save-btn');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        this.handleSave();
      });
    }

    // Backdrop click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.handleCancel();
      }
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal.classList.contains('active')) {
        this.handleCancel();
      }
    });
  }

  /**
   * Show modal for editing a remote
   * @param {string} remoteName - Remote name to edit
   * @param {Object} options - Options
   * @param {Function} options.onSave - Callback on save
   * @param {Function} options.onCancel - Callback on cancel
   */
  async show(remoteName, options = {}) {
    this.remoteName = remoteName;
    this.onSave = options.onSave || null;
    this.onCancel = options.onCancel || null;
    
    this.open();
    
    // Load remote data
    await this.loadRemoteData();
  }

  /**
   * Load remote data from API
   */
  async loadRemoteData() {
    try {
      const response = await fetch(`/api/rclone/remotes/${this.remoteName}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load remote data');
      }

      this.remoteData = data.data;
      this.renderForm();
    } catch (error) {
      console.error('Failed to load remote data:', error);
      showError(`Failed to load remote: ${error.message}`);
      this.close();
    }
  }

  /**
   * Render edit form
   */
  renderForm() {
    const body = this.modal.querySelector('#edit-modal-body');
    if (!body || !this.remoteData) return;

    const config = this.remoteData.config || {};
    const type = this.remoteData.type;

    let formFields = '';

    // Render provider-specific fields
    if (type === 'webdav') {
      const vendor = config.vendor || 'other';
      const isBlomp = vendor === 'other' && config.url && config.url.includes('blomp.com');
      
      formFields = `
        <div class="form-group">
          <label for="edit-webdav-url">WebDAV URL *</label>
          <input 
            type="url" 
            id="edit-webdav-url" 
            class="form-input" 
            value="${config.url || ''}"
            required
          >
        </div>

        <div class="form-group">
          <label for="edit-webdav-username">Username *</label>
          <input 
            type="text" 
            id="edit-webdav-username" 
            class="form-input" 
            value="${config.user || ''}"
            required
            autocomplete="username"
          >
        </div>

        <div class="form-group">
          <label for="edit-webdav-password">Password</label>
          <input 
            type="password" 
            id="edit-webdav-password" 
            class="form-input" 
            placeholder="••••••••"
            autocomplete="current-password"
          >
          <small class="form-help">Leave blank to keep current password</small>
        </div>

        <div class="form-group">
          <label for="edit-webdav-path">Remote Path / Bucket ${isBlomp ? '*' : '(Optional)'}</label>
          <input 
            type="text" 
            id="edit-webdav-path" 
            class="form-input" 
            placeholder="${isBlomp ? 'e.g., your-email@example.com' : 'e.g., /path/to/folder'}"
            value="${config.remotePath || ''}"
            ${isBlomp ? 'required' : ''}
          >
          <small class="form-help">${isBlomp ? 'For Blomp, enter your email address (bucket name)' : 'Optional path or bucket name for the remote'}</small>
        </div>
      `;
    } else if (type === 'drive' || type === 'dropbox' || type === 'onedrive') {
      // OAuth providers - show read-only info
      formFields = `
        <div class="info-box">
          <svg class="info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <div>
            <h4>OAuth Remote</h4>
            <p>This remote uses OAuth authentication. To update credentials, you need to delete and recreate the remote.</p>
          </div>
        </div>

        <div class="form-group">
          <label>Provider Type</label>
          <input 
            type="text" 
            class="form-input" 
            value="${this.formatProviderName(type)}"
            disabled
          >
        </div>

        <div class="form-group">
          <label>Remote Name</label>
          <input 
            type="text" 
            class="form-input" 
            value="${this.remoteName}"
            disabled
          >
        </div>
      `;
    } else {
      // Generic provider
      formFields = `
        <div class="info-box">
          <svg class="info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <div>
            <h4>Editing Not Supported</h4>
            <p>Editing is not yet supported for this provider type (${type}).</p>
          </div>
        </div>
      `;
    }

    body.innerHTML = `
      <form id="edit-remote-form" class="config-form">
        <div class="form-group">
          <label>Remote Name</label>
          <input 
            type="text" 
            class="form-input" 
            value="${this.remoteName}"
            disabled
          >
          <small class="form-help">Remote name cannot be changed</small>
        </div>

        ${formFields}
        
        <div class="form-error" id="edit-form-error" style="display: none;"></div>
      </form>
    `;

    // Attach form listeners
    this.attachFormListeners();

    // Enable save button for editable providers
    const saveButton = this.modal.querySelector('#edit-save-btn');
    if (saveButton && type === 'webdav') {
      saveButton.disabled = false;
    }
  }

  /**
   * Attach form event listeners
   */
  attachFormListeners() {
    // Enable save button when form changes
    const form = document.getElementById('edit-remote-form');
    if (form) {
      form.addEventListener('input', () => {
        const saveButton = this.modal.querySelector('#edit-save-btn');
        if (saveButton && !saveButton.disabled) {
          // Form has changes, keep save button enabled
        }
      });
    }
  }

  /**
   * Format provider name for display
   * @param {string} type - Provider type
   * @returns {string} Formatted name
   */
  formatProviderName(type) {
    const names = {
      'drive': 'Google Drive',
      'dropbox': 'Dropbox',
      'onedrive': 'OneDrive',
      'webdav': 'WebDAV',
      'koofr': 'Koofr'
    };
    return names[type] || type;
  }

  /**
   * Handle save button click
   */
  async handleSave() {
    if (!this.remoteData) return;

    const type = this.remoteData.type;

    // Only WebDAV is editable for now
    if (type !== 'webdav') {
      showError('This remote type cannot be edited');
      return;
    }

    // Validate form
    if (!this.validateForm()) {
      return;
    }

    // Collect form data
    const updates = this.collectFormData();

    // Save changes
    await this.saveChanges(updates);
  }

  /**
   * Validate form
   * @returns {boolean} Whether form is valid
   */
  validateForm() {
    const errors = [];
    const type = this.remoteData?.type;

    if (type === 'webdav') {
      const urlInput = document.getElementById('edit-webdav-url');
      const usernameInput = document.getElementById('edit-webdav-username');
      const pathInput = document.getElementById('edit-webdav-path');

      if (urlInput && !urlInput.value.trim()) {
        errors.push('WebDAV URL is required');
      } else if (urlInput && !/^https?:\/\/.+/.test(urlInput.value.trim())) {
        errors.push('WebDAV URL must start with http:// or https://');
      }

      if (usernameInput && !usernameInput.value.trim()) {
        errors.push('Username is required');
      }

      // Check if Blomp and validate path
      const isBlomp = urlInput && urlInput.value.includes('blomp.com');
      if (isBlomp && pathInput && !pathInput.value.trim()) {
        errors.push('Remote path (email/bucket) is required for Blomp');
      }
    }

    // Show errors if any
    if (errors.length > 0) {
      const errorDiv = document.getElementById('edit-form-error');
      if (errorDiv) {
        errorDiv.innerHTML = errors.map(err => `<p>${err}</p>`).join('');
        errorDiv.style.display = 'block';
      }
      showError(errors[0]);
      return false;
    }

    return true;
  }

  /**
   * Collect form data
   * @returns {Object} Form data
   */
  collectFormData() {
    const type = this.remoteData?.type;
    const updates = {};

    if (type === 'webdav') {
      const urlInput = document.getElementById('edit-webdav-url');
      const usernameInput = document.getElementById('edit-webdav-username');
      const passwordInput = document.getElementById('edit-webdav-password');
      const pathInput = document.getElementById('edit-webdav-path');

      updates.config = {};

      if (urlInput) {
        updates.config.url = urlInput.value.trim();
      }

      if (usernameInput) {
        updates.config.user = usernameInput.value.trim();
      }

      // Only include password if it was changed
      if (passwordInput && passwordInput.value) {
        updates.config.pass = passwordInput.value;
      }

      // Include remotePath
      if (pathInput) {
        updates.config.remotePath = pathInput.value.trim();
      }
    }

    return updates;
  }

  /**
   * Save changes via API
   * @param {Object} updates - Updates to save
   */
  async saveChanges(updates) {
    try {
      // Disable save button
      const saveButton = this.modal.querySelector('#edit-save-btn');
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';
      }

      const response = await fetch(`/api/rclone/remotes/${this.remoteName}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to save changes');
      }

      showSuccess(`Remote "${this.remoteName}" updated successfully`);

      // Call onSave callback
      if (this.onSave) {
        this.onSave(this.remoteName);
      }

      this.close();
    } catch (error) {
      console.error('Failed to save changes:', error);
      showError(`Failed to save changes: ${error.message}`);

      // Re-enable save button
      const saveButton = this.modal.querySelector('#edit-save-btn');
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Changes';
      }
    }
  }

  /**
   * Handle cancel button click
   */
  handleCancel() {
    if (this.onCancel) {
      this.onCancel();
    }

    this.close();
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
    this.remoteName = null;
    this.remoteData = null;
    this.onSave = null;
    this.onCancel = null;
  }
}

export default RemoteEditModal;
