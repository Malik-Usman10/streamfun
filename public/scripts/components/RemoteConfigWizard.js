/**
 * RemoteConfigWizard Component
 * Multi-step wizard for configuring cloud storage remotes
 */

import { trapFocus, showError, showSuccess } from '../utils/dom.js';

class RemoteConfigWizard {
  constructor() {
    this.modal = null;
    this.focusTrap = null;
    this.onComplete = null;
    this.onCancel = null;
    
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
          <button class="provider-card" data-provider="blomp">
            <div class="provider-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
              </svg>
            </div>
            <h4>Blomp</h4>
            <p>Swift / OpenStack</p>
          </button>
          
          <button class="provider-card" data-provider="filen">
            <div class="provider-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/>
              </svg>
            </div>
            <h4>Filen</h4>
            <p>Email &amp; API Key</p>
          </button>
          
          <button class="provider-card" data-provider="koofr">
            <div class="provider-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
            </div>
            <h4>Koofr</h4>
            <p>Email &amp; Password</p>
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

    // Update button states to enable Next button
    this.updateButtons();
    
    // Explicitly ensure Next button is enabled after provider selection
    const nextButton = this.modal.querySelector('#wizard-next-btn');
    if (nextButton && this.currentStep === 'provider-selection') {
      nextButton.disabled = false;
    }
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
    if (provider === 'blomp') {
      // Blomp — OpenStack Swift
      providerFields = `
        <div class="form-group">
          <label for="blomp-user">Email / Username *</label>
          <input type="email" id="blomp-user" class="form-input"
            placeholder="you@example.com"
            value="${this.wizardData.config.user || ''}"
            required autocomplete="username">
          <small class="form-help">Your Blomp account email address</small>
        </div>
        <div class="form-group">
          <label for="blomp-key">Password *</label>
          <input type="password" id="blomp-key" class="form-input"
            placeholder="••••••••"
            value="${this.wizardData.config.key || ''}"
            required autocomplete="current-password">
        </div>
        <div class="form-group">
          <label for="blomp-user-id">Blomp Username (login name) *</label>
          <input type="text" id="blomp-user-id" class="form-input"
            placeholder="e.g., johnhnly"
            value="${this.wizardData.config.user_id || ''}"
            required>
          <small class="form-help">Your Blomp login username (not email). Found in your Blomp account settings.</small>
        </div>
      `;
    } else if (provider === 'filen') {
      // Filen — native rclone filen backend
      providerFields = `
        <div class="form-group">
          <label for="filen-email">Email *</label>
          <input type="email" id="filen-email" class="form-input"
            placeholder="you@example.com"
            value="${this.wizardData.config.email || ''}"
            required autocomplete="username">
        </div>
        <div class="form-group">
          <label for="filen-password">Password *</label>
          <input type="password" id="filen-password" class="form-input"
            placeholder="••••••••"
            value="${this.wizardData.config.password || ''}"
            required autocomplete="current-password">
          <small class="form-help">Your Filen account password</small>
        </div>
        <div class="form-group">
          <label for="filen-api-key">API Key *</label>
          <input type="password" id="filen-api-key" class="form-input"
            placeholder="Your Filen API key"
            value="${this.wizardData.config.api_key || ''}"
            required>
          <small class="form-help">Found in Filen app → Settings → Security → API Keys</small>
        </div>
      `;
    } else if (provider === 'koofr') {
      // Koofr — native rclone koofr backend
      providerFields = `
        <div class="form-group">
          <label for="koofr-user">Email *</label>
          <input type="email" id="koofr-user" class="form-input"
            placeholder="you@example.com"
            value="${this.wizardData.config.user || ''}"
            required autocomplete="username">
        </div>
        <div class="form-group">
          <label for="koofr-password">App Password *</label>
          <input type="password" id="koofr-password" class="form-input"
            placeholder="••••••••"
            value="${this.wizardData.config.password || ''}"
            required autocomplete="current-password">
          <small class="form-help">Generate an app password in Koofr → Settings → Password → App passwords</small>
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

    const provider = this.wizardData.provider;

    // Blomp (Swift) fields
    const blompUser = document.getElementById('blomp-user');
    if (blompUser) blompUser.addEventListener('input', (e) => { this.wizardData.config.user = e.target.value.trim(); });
    const blompKey = document.getElementById('blomp-key');
    if (blompKey) blompKey.addEventListener('input', (e) => { this.wizardData.config.key = e.target.value; });
    const blompUserId = document.getElementById('blomp-user-id');
    if (blompUserId) blompUserId.addEventListener('input', (e) => { this.wizardData.config.user_id = e.target.value.trim(); });

    // Filen fields
    const filenEmail = document.getElementById('filen-email');
    if (filenEmail) filenEmail.addEventListener('input', (e) => { this.wizardData.config.email = e.target.value.trim(); });
    const filenPassword = document.getElementById('filen-password');
    if (filenPassword) filenPassword.addEventListener('input', (e) => { this.wizardData.config.password = e.target.value; });
    const filenApiKey = document.getElementById('filen-api-key');
    if (filenApiKey) filenApiKey.addEventListener('input', (e) => { this.wizardData.config.api_key = e.target.value.trim(); });

    // Koofr fields
    const koofrUser = document.getElementById('koofr-user');
    if (koofrUser) koofrUser.addEventListener('input', (e) => { this.wizardData.config.user = e.target.value.trim(); });
    const koofrPassword = document.getElementById('koofr-password');
    if (koofrPassword) koofrPassword.addEventListener('input', (e) => { this.wizardData.config.password = e.target.value; });
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
      await this.validateNativeConnection();
    } catch (error) {
      console.error('Validation error:', error);
      showError(`Validation failed: ${error.message}`);
      this.currentStep = 'configuration';
      this.renderStep();
      this.updateProgress();
      this.updateButtons();
    }
  }

  /**
   * Validate and create a native rclone provider (Blomp/Filen/Koofr)
   */
  async validateNativeConnection() {
    const remoteName = this.wizardData.remoteName;
    const provider = this.wizardData.provider;

    let providerType, config;

    if (provider === 'blomp') {
      providerType = 'blomp'; // Internal StreamFun ID, backend maps to 'swift' for rclone
      config = {
        user: this.wizardData.config.user,
        key: this.wizardData.config.key,
        user_id: this.wizardData.config.user_id,
        auth: 'https://authenticate.ain.net',
        tenant: 'storage',
        auth_version: '2',
        endpoint_type: 'public',
        leave_parts_on_error: 'true',
        remotePath: this.wizardData.config.user, // Blomp bucket name is the email address
      };
    } else if (provider === 'filen') {
      providerType = 'filen';
      config = {
        email: this.wizardData.config.email,
        password: this.wizardData.config.password,
        api_key: this.wizardData.config.api_key,
      };
    } else if (provider === 'koofr') {
      providerType = 'koofr';
      config = {
        user: this.wizardData.config.user,
        password: this.wizardData.config.password,
        provider: 'koofr',
      };
    }

    try {
      const response = await fetch(`/api/rclone/remotes/${remoteName}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ providerType, config }),
      });

      const data = await response.json();

      if (data.success && data.valid) {
        await this.createRemote(remoteName, providerType, config);
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
      'blomp': 'Blomp',
      'filen': 'Filen',
      'koofr': 'Koofr',
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
    
    if (provider === 'blomp') {
      if (!this.wizardData.config.user) errors.push('Email is required for Blomp');
      if (!this.wizardData.config.key) errors.push('Password is required for Blomp');
      if (!this.wizardData.config.user_id) errors.push('Blomp username (login name) is required');
    } else if (provider === 'filen') {
      if (!this.wizardData.config.email) errors.push('Email is required for Filen');
      if (!this.wizardData.config.password) errors.push('Password is required for Filen');
      if (!this.wizardData.config.api_key) errors.push('API Key is required for Filen');
    } else if (provider === 'koofr') {
      if (!this.wizardData.config.user) errors.push('Email is required for Koofr');
      if (!this.wizardData.config.password) errors.push('App password is required for Koofr');
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
