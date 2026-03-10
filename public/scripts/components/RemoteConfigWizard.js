/**
 * RemoteConfigWizard Component
 * Multi-step wizard for configuring cloud storage remotes
 */

import { trapFocus, showError, showSuccess } from '../utils/dom.js';
import OAuthPopupManager from '../utils/oauth-popup.js';

class RemoteConfigWizard {
  constructor() {
    this.modal = null;
    this.focusTrap = null;
    this.onComplete = null;
    this.onCancel = null;
    this.oauthPopup = new OAuthPopupManager();
    
    // Wizard state
    this.currentStep = 'provider-selection';
    this.wizardData = {
      remoteName: '',
      provider: null,
      config: {}
    };
    
    this.createModal();
  }

  /**
   * Create modal element
   */
  createModal() {
    // Create modal overlay
    this.modal = document.createElement('div');
    this.modal.className = 'modal-overlay remote-config-wizard-modal';
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-labelledby', 'wizard-title');
    
    this.modal.innerHTML = `
      <div class="modal-content modal-large">
        <div class="modal-header">
          <h2 id="wizard-title">Add Cloud Storage Remote</h2>
          <button class="modal-close" id="wizard-close" aria-label="Close wizard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div class="wizard-progress" id="wizard-progress">
          <div class="progress-step active" data-step="provider-selection">
            <div class="step-number">1</div>
            <div class="step-label">Provider</div>
          </div>
          <div class="progress-step" data-step="configuration">
            <div class="step-number">2</div>
            <div class="step-label">Configure</div>
          </div>
          <div class="progress-step" data-step="validation">
            <div class="step-number">3</div>
            <div class="step-label">Validate</div>
          </div>
          <div class="progress-step" data-step="complete">
            <div class="step-number">4</div>
            <div class="step-label">Complete</div>
          </div>
        </div>
        
        <div class="modal-body" id="wizard-body">
          <!-- Step content will be dynamically inserted -->
        </div>
        
        <div class="modal-footer wizard-footer">
          <button class="btn btn-secondary" id="wizard-back-btn" style="display: none;">Back</button>
          <div style="flex: 1;"></div>
          <button class="btn btn-secondary" id="wizard-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="wizard-next-btn">Next</button>
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
    const closeButton = this.modal.querySelector('#wizard-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        this.handleCancel();
      });
    }

    // Cancel button
    const cancelButton = this.modal.querySelector('#wizard-cancel-btn');
    if (cancelButton) {
      cancelButton.addEventListener('click', () => {
        this.handleCancel();
      });
    }

    // Back button
    const backButton = this.modal.querySelector('#wizard-back-btn');
    if (backButton) {
      backButton.addEventListener('click', () => {
        this.handleBack();
      });
    }

    // Next button
    const nextButton = this.modal.querySelector('#wizard-next-btn');
    if (nextButton) {
      nextButton.addEventListener('click', () => {
        this.handleNext();
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
   * Show wizard
   * @param {Object} options - Options
   * @param {Function} options.onComplete - Callback on completion
   * @param {Function} options.onCancel - Callback on cancel
   */
  show(options = {}) {
    this.onComplete = options.onComplete || null;
    this.onCancel = options.onCancel || null;
    
    // Reset wizard state
    this.currentStep = 'provider-selection';
    this.wizardData = {
      remoteName: '',
      provider: null,
      config: {}
    };
    
    this.renderStep();
    this.updateProgress();
    this.updateButtons();
    this.open();
  }

  /**
   * Render current step
   */
  renderStep() {
    const body = this.modal.querySelector('#wizard-body');
    if (!body) return;

    switch (this.currentStep) {
      case 'provider-selection':
        this.renderProviderSelection(body);
        break;
      case 'configuration':
        this.renderConfiguration(body);
        break;
      case 'validation':
        this.renderValidation(body);
        break;
      case 'complete':
        this.renderComplete(body);
        break;
      default:
        console.warn('Unknown step:', this.currentStep);
    }
  }

  /**
   * Render provider selection step
   * @param {HTMLElement} container - Container element
   */
  renderProviderSelection(container) {
    container.innerHTML = `
      <div class="wizard-step provider-selection-step">
        <h3>Select Cloud Storage Provider</h3>
        <p class="step-description">Choose the cloud storage service you want to connect</p>
        
        <div class="provider-grid">
          <button class="provider-card" data-provider="google-drive">
            <div class="provider-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.01 1.485L6.01 11.5h12l-6-10.015zM1.99 13.5l6 10.015 6-10.015h-12zm8.01-2L4 21.515h16L14.01 11.5H10z"/>
              </svg>
            </div>
            <h4>Google Drive</h4>
            <p>OAuth authentication</p>
          </button>
          
          <button class="provider-card" data-provider="dropbox">
            <div class="provider-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452 0 13.274zm18 0l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z"/>
              </svg>
            </div>
            <h4>Dropbox</h4>
            <p>OAuth authentication</p>
          </button>
          
          <button class="provider-card" data-provider="onedrive">
            <div class="provider-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M13.5 7.5c-1.5-3-4.5-5-8-5-4.5 0-8 3.5-8 8 0 .5 0 1 .1 1.5C.5 13 1.5 14 3 14.5h15c2.5 0 4.5-2 4.5-4.5S20.5 5.5 18 5.5c-.5 0-1 .1-1.5.2-.5-1.5-1.5-2.7-3-3.2z"/>
              </svg>
            </div>
            <h4>OneDrive</h4>
            <p>OAuth authentication</p>
          </button>
          
          <button class="provider-card" data-provider="webdav-blomp">
            <div class="provider-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              </svg>
            </div>
            <h4>Blomp</h4>
            <p>WebDAV connection</p>
          </button>
          
          <button class="provider-card" data-provider="webdav-filen">
            <div class="provider-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              </svg>
            </div>
            <h4>Filen</h4>
            <p>WebDAV connection</p>
          </button>
          
          <button class="provider-card" data-provider="webdav-koofr">
            <div class="provider-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              </svg>
            </div>
            <h4>Koofr</h4>
            <p>WebDAV connection</p>
          </button>
        </div>
      </div>
    `;

    // Attach provider selection listeners
    const providerCards = container.querySelectorAll('.provider-card');
    providerCards.forEach(card => {
      card.addEventListener('click', () => {
        const provider = card.dataset.provider;
        this.selectProvider(provider);
      });
    });
  }

  /**
   * Select a provider
   * @param {string} provider - Provider identifier
   */
  selectProvider(provider) {
    this.wizardData.provider = provider;
    
    // Highlight selected provider
    const providerCards = this.modal.querySelectorAll('.provider-card');
    providerCards.forEach(card => {
      if (card.dataset.provider === provider) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    });
  }

  /**
   * Render configuration step
   * @param {HTMLElement} container - Container element
   */
  renderConfiguration(container) {
    container.innerHTML = `
      <div class="wizard-step configuration-step">
        <h3>Configure ${this.getProviderDisplayName()}</h3>
        <p class="step-description">Enter the connection details for your remote</p>
        
        <div id="provider-config-form">
          <!-- Provider-specific form will be rendered here -->
        </div>
      </div>
    `;

    // Render provider-specific form
    const formContainer = container.querySelector('#provider-config-form');
    if (formContainer) {
      this.renderProviderForm(formContainer);
    }
  }

  /**
   * Render provider-specific configuration form
   * @param {HTMLElement} container - Container element
   */
  renderProviderForm(container) {
    const provider = this.wizardData.provider;

    // Common remote name field for all providers
    const commonFields = `
      <div class="form-group">
        <label for="remote-name">Remote Name *</label>
        <input 
          type="text" 
          id="remote-name" 
          class="form-input" 
          placeholder="e.g., my-drive" 
          value="${this.wizardData.remoteName || ''}"
          required
        >
        <small class="form-help">A unique name to identify this remote</small>
      </div>
    `;

    let providerFields = '';

    // Render provider-specific fields
    if (provider === 'google-drive' || provider === 'dropbox' || provider === 'onedrive') {
      // OAuth providers
      providerFields = `
        <div class="oauth-info">
          <div class="info-box">
            <svg class="info-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <div>
              <h4>OAuth Authentication</h4>
              <p>You'll be redirected to ${this.getProviderDisplayName()} to authorize access. No credentials are stored locally.</p>
            </div>
          </div>
        </div>
      `;
    } else if (provider.startsWith('webdav-')) {
      // WebDAV providers
      const webdavProvider = provider.replace('webdav-', '');
      const defaultUrls = {
        'blomp': 'https://webdav.blomp.com',
        'filen': 'https://webdav.filen.io',
        'koofr': 'https://app.koofr.net/dav/Koofr'
      };

      providerFields = `
        <div class="form-group">
          <label for="webdav-url">WebDAV URL *</label>
          <input 
            type="url" 
            id="webdav-url" 
            class="form-input" 
            placeholder="${defaultUrls[webdavProvider] || 'https://webdav.example.com'}"
            value="${this.wizardData.config.url || defaultUrls[webdavProvider] || ''}"
            required
          >
          <small class="form-help">The WebDAV server URL</small>
        </div>

        <div class="form-group">
          <label for="webdav-username">Username *</label>
          <input 
            type="text" 
            id="webdav-username" 
            class="form-input" 
            placeholder="your-username"
            value="${this.wizardData.config.user || ''}"
            required
            autocomplete="username"
          >
        </div>

        <div class="form-group">
          <label for="webdav-password">Password *</label>
          <input 
            type="password" 
            id="webdav-password" 
            class="form-input" 
            placeholder="••••••••"
            value="${this.wizardData.config.pass || ''}"
            required
            autocomplete="current-password"
          >
        </div>

        <div class="form-group">
          <label for="webdav-path">Remote Path / Bucket ${webdavProvider === 'blomp' ? '*' : '(Optional)'}</label>
          <input 
            type="text" 
            id="webdav-path" 
            class="form-input" 
            placeholder="${webdavProvider === 'blomp' ? 'e.g., your-email@example.com' : 'e.g., /path/to/folder'}"
            value="${this.wizardData.config.remotePath || ''}"
            ${webdavProvider === 'blomp' ? 'required' : ''}
          >
          <small class="form-help">${webdavProvider === 'blomp' ? 'For Blomp, enter your email address (bucket name)' : 'Optional path or bucket name for the remote'}</small>
        </div>
      `;
    }

    container.innerHTML = `
      <form id="provider-config-form" class="config-form">
        ${commonFields}
        ${providerFields}
        
        <div class="form-error" id="form-error" style="display: none;"></div>
      </form>
    `;

    // Attach form listeners
    this.attachFormListeners();
  }

  /**
   * Attach form event listeners
   */
  attachFormListeners() {
    const remoteNameInput = document.getElementById('remote-name');
    if (remoteNameInput) {
      remoteNameInput.addEventListener('input', (e) => {
        this.wizardData.remoteName = e.target.value.trim();
      });
    }

    // WebDAV fields
    const urlInput = document.getElementById('webdav-url');
    if (urlInput) {
      urlInput.addEventListener('input', (e) => {
        this.wizardData.config.url = e.target.value.trim();
      });
    }

    const usernameInput = document.getElementById('webdav-username');
    if (usernameInput) {
      usernameInput.addEventListener('input', (e) => {
        this.wizardData.config.user = e.target.value.trim();
      });
    }

    const passwordInput = document.getElementById('webdav-password');
    if (passwordInput) {
      passwordInput.addEventListener('input', (e) => {
        this.wizardData.config.pass = e.target.value;
      });
    }

    const pathInput = document.getElementById('webdav-path');
    if (pathInput) {
      pathInput.addEventListener('input', (e) => {
        this.wizardData.config.remotePath = e.target.value.trim();
      });
    }
  }

  /**
   * Render validation step
   * @param {HTMLElement} container - Container element
   */
  renderValidation(container) {
    container.innerHTML = `
      <div class="wizard-step validation-step">
        <h3>Validating Configuration</h3>
        <p class="step-description">Testing connection to your remote...</p>
        
        <div class="validation-progress">
          <div class="spinner"></div>
          <p>Please wait while we validate your configuration</p>
        </div>
      </div>
    `;

    // Start validation
    this.performValidation();
  }

  /**
   * Perform validation
   */
  async performValidation() {
    const provider = this.wizardData.provider;

    try {
      if (provider.startsWith('webdav-')) {
        // Validate WebDAV connection
        await this.validateWebDAVConnection();
      } else {
        // OAuth providers - initiate OAuth flow
        await this.initiateOAuthFlow();
      }
    } catch (error) {
      console.error('Validation error:', error);
      
      // Show error and go back to configuration
      showError(`Validation failed: ${error.message}`);
      this.currentStep = 'configuration';
      this.renderStep();
      this.updateProgress();
      this.updateButtons();
    }
  }

  /**
   * Validate WebDAV connection
   */
  async validateWebDAVConnection() {
    const remoteName = this.wizardData.remoteName;
    const providerType = 'webdav';
    const config = {
      url: this.wizardData.config.url,
      user: this.wizardData.config.user,
      pass: this.wizardData.config.pass,
      vendor: this.getWebDAVVendor(),
      remotePath: this.wizardData.config.remotePath || ''
    };

    try {
      const response = await fetch(`/api/rclone/remotes/${remoteName}/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          providerType,
          config
        })
      });

      const data = await response.json();

      if (data.success && data.valid) {
        // Validation successful, create the remote
        await this.createRemote(remoteName, providerType, config);
        
        // Move to complete step
        this.currentStep = 'complete';
        this.renderStep();
        this.updateProgress();
        this.updateButtons();
      } else {
        throw new Error(data.errors?.connection || data.error || 'Validation failed');
      }
    } catch (error) {
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }

  /**
   * Get WebDAV vendor setting
   * @returns {string} Vendor name
   */
  getWebDAVVendor() {
    const provider = this.wizardData.provider;
    if (provider === 'webdav-blomp') return 'other';
    if (provider === 'webdav-filen') return 'other';
    if (provider === 'webdav-koofr') return 'other';
    return 'other';
  }

  /**
   * Initiate OAuth flow
   */
  async initiateOAuthFlow() {
    const remoteName = this.wizardData.remoteName;
    const provider = this.wizardData.provider;

    try {
      // Get OAuth authorization URL from backend
      const response = await fetch(`/api/rclone/oauth/authorize/${provider}?remoteName=${encodeURIComponent(remoteName)}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to get authorization URL');
      }

      const { authUrl } = data.data;

      // Open OAuth popup and wait for result
      const result = await this.oauthPopup.open(authUrl, {
        timeout: 5 * 60 * 1000, // 5 minutes
        width: 600,
        height: 700
      });

      if (result.success) {
        // OAuth successful, remote was created by the callback
        this.wizardData.remoteName = result.remoteName;
        
        // Move to complete step
        this.currentStep = 'complete';
        this.renderStep();
        this.updateProgress();
        this.updateButtons();
      } else {
        throw new Error('OAuth authentication failed');
      }
    } catch (error) {
      throw new Error(`OAuth authentication failed: ${error.message}`);
    }
  }

  /**
   * Create remote via API
   * @param {string} remoteName - Remote name
   * @param {string} providerType - Provider type
   * @param {Object} config - Configuration
   */
  async createRemote(remoteName, providerType, config) {
    try {
      const response = await fetch('/api/rclone/remotes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          remoteName,
          providerType,
          config
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create remote');
      }

      return data;
    } catch (error) {
      throw new Error(`Failed to create remote: ${error.message}`);
    }
  }

  /**
   * Render complete step
   * @param {HTMLElement} container - Container element
   */
  renderComplete(container) {
    container.innerHTML = `
      <div class="wizard-step complete-step">
        <div class="success-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="9 12 11 14 15 10"></polyline>
          </svg>
        </div>
        <h3>Remote Added Successfully!</h3>
        <p class="step-description">Your cloud storage remote has been configured and is ready to use.</p>
        
        <div class="remote-summary">
          <div class="summary-item">
            <span class="summary-label">Remote Name:</span>
            <span class="summary-value">${this.wizardData.remoteName || 'N/A'}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Provider:</span>
            <span class="summary-value">${this.getProviderDisplayName()}</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Get provider display name
   * @returns {string} Display name
   */
  getProviderDisplayName() {
    const names = {
      'google-drive': 'Google Drive',
      'dropbox': 'Dropbox',
      'onedrive': 'OneDrive',
      'webdav-blomp': 'Blomp (WebDAV)',
      'webdav-filen': 'Filen (WebDAV)',
      'webdav-koofr': 'Koofr (WebDAV)'
    };
    return names[this.wizardData.provider] || this.wizardData.provider;
  }

  /**
   * Update progress indicator
   */
  updateProgress() {
    const steps = this.modal.querySelectorAll('.progress-step');
    const stepOrder = ['provider-selection', 'configuration', 'validation', 'complete'];
    const currentIndex = stepOrder.indexOf(this.currentStep);

    steps.forEach((step, index) => {
      if (index < currentIndex) {
        step.classList.add('completed');
        step.classList.remove('active');
      } else if (index === currentIndex) {
        step.classList.add('active');
        step.classList.remove('completed');
      } else {
        step.classList.remove('active', 'completed');
      }
    });
  }

  /**
   * Update button states
   */
  updateButtons() {
    const backButton = this.modal.querySelector('#wizard-back-btn');
    const nextButton = this.modal.querySelector('#wizard-next-btn');
    const cancelButton = this.modal.querySelector('#wizard-cancel-btn');

    if (!backButton || !nextButton || !cancelButton) return;

    // Update back button visibility
    if (this.currentStep === 'provider-selection' || this.currentStep === 'complete') {
      backButton.style.display = 'none';
    } else {
      backButton.style.display = 'inline-flex';
    }

    // Update next button
    if (this.currentStep === 'complete') {
      nextButton.textContent = 'Finish';
      nextButton.classList.remove('btn-primary');
      nextButton.classList.add('btn-success');
    } else if (this.currentStep === 'validation') {
      nextButton.style.display = 'none';
    } else {
      nextButton.textContent = 'Next';
      nextButton.style.display = 'inline-flex';
      nextButton.classList.add('btn-primary');
      nextButton.classList.remove('btn-success');
      
      // Disable next button if no provider selected
      if (this.currentStep === 'provider-selection' && !this.wizardData.provider) {
        nextButton.disabled = true;
      } else {
        nextButton.disabled = false;
      }
    }

    // Hide cancel button on complete step
    if (this.currentStep === 'complete') {
      cancelButton.style.display = 'none';
    } else {
      cancelButton.style.display = 'inline-flex';
    }
  }

  /**
   * Handle next button click
   */
  handleNext() {
    const stepOrder = ['provider-selection', 'configuration', 'validation', 'complete'];
    const currentIndex = stepOrder.indexOf(this.currentStep);

    if (this.currentStep === 'complete') {
      // Finish wizard
      this.handleComplete();
      return;
    }

    // Validate current step before proceeding
    if (!this.validateCurrentStep()) {
      return;
    }

    // Move to next step
    if (currentIndex < stepOrder.length - 1) {
      this.currentStep = stepOrder[currentIndex + 1];
      this.renderStep();
      this.updateProgress();
      this.updateButtons();
    }
  }

  /**
   * Handle back button click
   */
  handleBack() {
    const stepOrder = ['provider-selection', 'configuration', 'validation', 'complete'];
    const currentIndex = stepOrder.indexOf(this.currentStep);

    // Move to previous step
    if (currentIndex > 0) {
      this.currentStep = stepOrder[currentIndex - 1];
      this.renderStep();
      this.updateProgress();
      this.updateButtons();
    }
  }

  /**
   * Validate current step
   * @returns {boolean} Whether step is valid
   */
  validateCurrentStep() {
    switch (this.currentStep) {
      case 'provider-selection':
        if (!this.wizardData.provider) {
          showError('Please select a provider');
          return false;
        }
        return true;
      
      case 'configuration':
        return this.validateConfigurationForm();
      
      default:
        return true;
    }
  }

  /**
   * Validate configuration form
   * @returns {boolean} Whether form is valid
   */
  validateConfigurationForm() {
    const errors = [];

    // Validate remote name
    if (!this.wizardData.remoteName) {
      errors.push('Remote name is required');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(this.wizardData.remoteName)) {
      errors.push('Remote name can only contain letters, numbers, hyphens, and underscores');
    } else if (this.wizardData.remoteName.length > 50) {
      errors.push('Remote name must be 50 characters or less');
    }

    // Validate provider-specific fields
    const provider = this.wizardData.provider;
    
    if (provider.startsWith('webdav-')) {
      // WebDAV validation
      if (!this.wizardData.config.url) {
        errors.push('WebDAV URL is required');
      } else if (!/^https?:\/\/.+/.test(this.wizardData.config.url)) {
        errors.push('WebDAV URL must start with http:// or https://');
      }

      if (!this.wizardData.config.user) {
        errors.push('Username is required');
      }

      if (!this.wizardData.config.pass) {
        errors.push('Password is required');
      }

      // Validate remote path for Blomp
      if (provider === 'webdav-blomp' && !this.wizardData.config.remotePath) {
        errors.push('Remote path (email/bucket) is required for Blomp');
      }
    }

    // Show errors if any
    if (errors.length > 0) {
      const errorDiv = document.getElementById('form-error');
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
   * Handle wizard completion
   */
  handleComplete() {
    if (this.onComplete) {
      this.onComplete(this.wizardData);
    }

    this.close();
  }

  /**
   * Handle wizard cancellation
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

    // Clean up OAuth popup
    if (this.oauthPopup) {
      this.oauthPopup.cleanup();
    }

    if (this.modal && this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }

    this.modal = null;
    this.focusTrap = null;
    this.onComplete = null;
    this.onCancel = null;
  }
}

export default RemoteConfigWizard;
