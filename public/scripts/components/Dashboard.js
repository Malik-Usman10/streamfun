/**
 * Dashboard Component
 * Modal with tabs for Statistics, Upload, Accounts, and Cloud Storage
 */

import appState from '../state.js';
import api from '../api.js';
import { formatBytes } from '../utils/format.js';
import { trapFocus, showError, showSuccess } from '../utils/dom.js';
import RemoteList from './RemoteList.js';

class Dashboard {
  constructor(container) {
    this.container = container;
    this.elements = {
      closeButton: null,
      tabs: [],
      body: null
    };
    this.currentTab = 'stats';
    this.focusTrap = null;
    this.selectedFile = null;
    this.showingAddAccountForm = false;
    this.remoteListComponent = null;
    
    this.init();
  }

  /**
   * Initialize dashboard component
   */
  init() {
    this.cacheElements();
    this.attachEventListeners();
    this.subscribeToState();
    
    // Render initial tab
    this.renderTab(this.currentTab);
  }

  /**
   * Cache DOM elements
   */
  cacheElements() {
    this.elements.closeButton = document.getElementById('dashboard-close');
    this.elements.tabs = Array.from(document.querySelectorAll('.dashboard-tab'));
    this.elements.body = document.getElementById('dashboard-body');
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button
    if (this.elements.closeButton) {
      this.elements.closeButton.addEventListener('click', () => {
        this.close();
      });
    }

    // Backdrop click
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) {
        this.close();
      }
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.container.classList.contains('active')) {
        this.close();
      }
    });

    // Tab clicks
    this.elements.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        this.switchTab(tabName);
      });
    });
  }

  /**
   * Subscribe to state changes
   */
  subscribeToState() {
    appState.subscribe((state) => {
      // Re-render current tab when state changes
      if (this.isOpen()) {
        this.renderTab(this.currentTab);
      }
    });
  }

  /**
   * Switch to a different tab
   * @param {string} tabName - Tab name (stats, upload, accounts, remotes)
   */
  async switchTab(tabName) {
    // Update active tab indicator and aria-selected
    this.elements.tabs.forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
      } else {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
      }
    });

    // Update current tab
    this.currentTab = tabName;

    // Refresh data when switching tabs
    if (tabName === 'stats') {
      await this.fetchStatistics();
    } else if (tabName === 'accounts') {
      await this.fetchAccounts();
    }

    // Render tab
    this.renderTab(tabName);
  }

  /**
   * Render tab content
   * @param {string} tabName - Tab name (stats, upload, accounts, remotes)
   */
  renderTab(tabName) {
    if (!this.elements.body) return;

    switch (tabName) {
      case 'stats':
        this.renderStatsTab();
        break;
      case 'upload':
        this.renderUploadTab();
        break;
      case 'accounts':
        this.renderAccountsTab();
        break;
      case 'remotes':
        this.renderRemotesTab();
        break;
      default:
        console.warn('Unknown tab:', tabName);
    }
  }

  /**
   * Render Statistics tab
   */
  renderStatsTab() {
    const state = appState.getState();
    const stats = state.stats;

    // Show loading state if stats are being fetched
    if (state.isLoading) {
      this.elements.body.innerHTML = `
        <div class="loading-state" style="display: flex; justify-content: center; align-items: center; padding: 48px;">
          <div class="spinner"></div>
          <p style="margin-left: 16px;">Loading statistics...</p>
        </div>
      `;
      return;
    }

    this.elements.body.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
              <polyline points="13 2 13 9 20 9"></polyline>
            </svg>
          </div>
          <div class="stat-content">
            <p class="stat-label">Total Files</p>
            <p class="stat-value">${stats.files?.total || 0}</p>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
            </svg>
          </div>
          <div class="stat-content">
            <p class="stat-label">Total Size</p>
            <p class="stat-value">${formatBytes(stats.files?.totalSize || 0)}</p>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>
          <div class="stat-content">
            <p class="stat-label">Total Accounts</p>
            <p class="stat-value">${stats.accounts?.total || 0}</p>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </div>
          <div class="stat-content">
            <p class="stat-label">Active Accounts</p>
            <p class="stat-value">${stats.accounts?.active || 0}</p>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render Upload tab
   */
  renderUploadTab() {
    this.elements.body.innerHTML = `
      <div class="upload-tab">
        <div class="upload-dropzone" id="upload-dropzone">
          <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <p class="upload-text">Drag and drop files here</p>
          <p class="upload-subtext">or</p>
          <button class="btn btn-primary" id="choose-files-btn">Choose Files</button>
          <input type="file" id="file-input" hidden>
        </div>
        
        <div class="upload-options" style="margin-top: 24px;">
          <div class="form-group">
            <label>Provider</label>
            <select class="form-select" id="provider-select">
              <option value="google_drive">Google Drive</option>
              <option value="blomp">Blomp</option>
              <option value="filen">Filen</option>
            </select>
          </div>
          
          <div class="form-group" id="collection-group" style="display: none;">
            <label>Collection Name (for images)</label>
            <input type="text" id="collection-input" placeholder="e.g., vacation-2024">
          </div>
          
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="encrypt-checkbox" checked>
              <span>Encrypt file</span>
            </label>
          </div>
        </div>
        
        <div class="upload-progress" id="upload-progress" style="display: none; margin-top: 24px;">
          <div class="progress-bar">
            <div class="progress-fill" id="progress-fill" style="width: 0%"></div>
          </div>
          <p class="progress-text" id="progress-text">Uploading... 0%</p>
        </div>
        
        <button class="btn btn-primary" id="upload-btn" style="margin-top: 24px; width: 100%;">Upload</button>
      </div>
    `;

    // Attach upload tab event listeners
    this.attachUploadListeners();
  }

  /**
   * Attach event listeners for upload tab
   */
  attachUploadListeners() {
    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('file-input');
    const chooseFilesBtn = document.getElementById('choose-files-btn');
    const uploadBtn = document.getElementById('upload-btn');
    const collectionGroup = document.getElementById('collection-group');

    if (!dropzone || !fileInput) return;

    // Choose files button
    if (chooseFilesBtn) {
      chooseFilesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        fileInput.click();
      });
    }

    // File input change
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.handleFileSelected(file);
      }
    });

    // Drag and drop handlers
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      
      const file = e.dataTransfer.files[0];
      if (file) {
        this.handleFileSelected(file);
      }
    });

    // Upload button
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        this.startUpload();
      });
    }

    // Show/hide collection field based on file type
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file && collectionGroup) {
          const isImage = file.type.startsWith('image/');
          collectionGroup.style.display = isImage ? 'block' : 'none';
        }
      });
    }
  }

  /**
   * Handle file selected
   * @param {File} file - Selected file
   */
  handleFileSelected(file) {
    this.selectedFile = file;
    
    // Update dropzone text
    const dropzone = document.getElementById('upload-dropzone');
    if (dropzone) {
      const uploadText = dropzone.querySelector('.upload-text');
      if (uploadText) {
        uploadText.textContent = `Selected: ${file.name}`;
      }
    }

    // Show/hide collection field for images
    const collectionGroup = document.getElementById('collection-group');
    if (collectionGroup) {
      const isImage = file.type.startsWith('image/');
      collectionGroup.style.display = isImage ? 'block' : 'none';
    }

    // Enable upload button
    const uploadBtn = document.getElementById('upload-btn');
    if (uploadBtn) {
      uploadBtn.disabled = false;
    }
  }

  /**
   * Start file upload
   */
  async startUpload() {
    if (!this.selectedFile) {
      showError('Please select a file to upload');
      return;
    }

    const providerSelect = document.getElementById('provider-select');
    const encryptCheckbox = document.getElementById('encrypt-checkbox');
    const collectionInput = document.getElementById('collection-input');
    const uploadProgress = document.getElementById('upload-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const uploadBtn = document.getElementById('upload-btn');

    const options = {
      provider: providerSelect?.value || 'google_drive',
      encrypt: encryptCheckbox?.checked ?? true,
      collectionName: collectionInput?.value || null
    };

    try {
      // Show progress bar
      if (uploadProgress) uploadProgress.style.display = 'block';
      if (uploadBtn) uploadBtn.disabled = true;

      // Upload with progress callback
      await api.uploadFile(this.selectedFile, options, (progress) => {
        if (progressFill) progressFill.style.width = `${progress}%`;
        if (progressText) progressText.textContent = `Uploading... ${progress}%`;
      });

      // Success
      showSuccess(`File "${this.selectedFile.name}" uploaded successfully!`);

      // Refresh files in gallery
      const files = await api.fetchFiles();
      appState.setState({ files });

      // Reset form
      this.resetUploadForm();

    } catch (error) {
      console.error('Upload error:', error);
      showError(`Upload failed: ${error.message}`);
    } finally {
      // Hide progress bar and re-enable button
      if (uploadProgress) uploadProgress.style.display = 'none';
      if (uploadBtn) uploadBtn.disabled = false;
    }
  }

  /**
   * Reset upload form
   */
  resetUploadForm() {
    this.selectedFile = null;
    
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';

    const dropzone = document.getElementById('upload-dropzone');
    if (dropzone) {
      const uploadText = dropzone.querySelector('.upload-text');
      if (uploadText) {
        uploadText.textContent = 'Drag and drop files here';
      }
    }

    const collectionInput = document.getElementById('collection-input');
    if (collectionInput) collectionInput.value = '';

    const collectionGroup = document.getElementById('collection-group');
    if (collectionGroup) collectionGroup.style.display = 'none';

    const progressFill = document.getElementById('progress-fill');
    if (progressFill) progressFill.style.width = '0%';

    const progressText = document.getElementById('progress-text');
    if (progressText) progressText.textContent = 'Uploading... 0%';
  }

  /**
   * Render Accounts tab
   */
  async renderAccountsTab() {
    const state = appState.getState();
    const accounts = state.accounts || [];

    // Show loading state if accounts are being fetched
    if (state.isLoading) {
      this.elements.body.innerHTML = `
        <div class="loading-state" style="display: flex; justify-content: center; align-items: center; padding: 48px;">
          <div class="spinner"></div>
          <p style="margin-left: 16px;">Loading accounts...</p>
        </div>
      `;
      return;
    }

    // Show add account form if in add mode
    if (this.showingAddAccountForm) {
      this.renderAddAccountForm();
      return;
    }

    // Render accounts list
    this.elements.body.innerHTML = `
      <div class="accounts-tab">
        <div style="margin-bottom: 24px;">
          <button class="btn btn-primary" id="add-account-btn">Add Account</button>
        </div>
        
        ${accounts.length === 0 ? `
          <div class="empty-state">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <h2>No accounts configured</h2>
            <p>Add your first storage account to get started</p>
          </div>
        ` : `
          <div class="accounts-list">
            ${accounts.map(account => this.renderAccountCard(account)).join('')}
          </div>
        `}
      </div>
    `;

    // Attach event listeners
    this.attachAccountsListeners();
  }

  /**
   * Render a single account card
   * @param {Object} account - Account object
   * @returns {string} HTML string
   */
  renderAccountCard(account) {
    const quotaPercent = account.quotaPercent || 0;
    const quotaUsed = formatBytes(account.quotaUsed || 0);
    const quotaTotal = formatBytes(account.quotaTotal || 0);
    const statusClass = account.status === 'active' ? 'status-active' : 'status-inactive';

    return `
      <div class="account-card" data-account-id="${account.id}">
        <div class="account-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
        <div class="account-info">
          <h3 class="account-provider">${this.formatProviderName(account.provider)}</h3>
          <p class="account-status ${statusClass}">${account.status || 'Unknown'}</p>
          ${account.quotaTotal ? `
            <div class="account-quota">
              <div class="quota-bar">
                <div class="quota-fill" style="width: ${quotaPercent}%"></div>
              </div>
              <p class="quota-text">${quotaUsed} / ${quotaTotal} (${Math.round(quotaPercent)}%)</p>
            </div>
          ` : ''}
        </div>
        <button class="btn-icon btn-delete" data-account-id="${account.id}" aria-label="Delete account">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
  }

  /**
   * Format provider name for display
   * @param {string} provider - Provider identifier
   * @returns {string} Formatted name
   */
  formatProviderName(provider) {
    const names = {
      'google_drive': 'Google Drive',
      'blomp': 'Blomp',
      'filen': 'Filen'
    };
    return names[provider] || provider;
  }

  /**
   * Attach event listeners for accounts tab
   */
  attachAccountsListeners() {
    const addAccountBtn = document.getElementById('add-account-btn');
    if (addAccountBtn) {
      addAccountBtn.addEventListener('click', () => {
        this.showAddAccountForm();
      });
    }

    // Delete buttons
    const deleteButtons = document.querySelectorAll('.btn-delete[data-account-id]');
    deleteButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const accountId = btn.dataset.accountId;
        this.deleteAccount(accountId);
      });
    });
  }

  /**
   * Show add account form
   */
  showAddAccountForm() {
    this.showingAddAccountForm = true;
    this.renderAddAccountForm();
  }

  /**
   * Render add account form
   */
  renderAddAccountForm() {
    this.elements.body.innerHTML = `
      <div class="accounts-tab">
        <div class="add-account-form">
          <h3>Add Storage Account</h3>
          
          <div class="form-group">
            <label>Provider</label>
            <select id="account-provider" class="form-select">
              <option value="google_drive">Google Drive</option>
              <option value="blomp">Blomp</option>
              <option value="filen">Filen</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Rclone Remote Name</label>
            <input type="text" id="remote-name" class="form-input" placeholder="e.g., gdrive1" required>
          </div>
          
          <div class="form-group">
            <label>Remote Path</label>
            <input type="text" id="remote-path" class="form-input" value="streamfun">
            <small>For Blomp: your bucket name. Others: folder name</small>
          </div>
          
          <div class="form-actions" style="display: flex; gap: 12px; margin-top: 24px;">
            <button class="btn btn-primary" id="submit-account-btn">Add Account</button>
            <button class="btn btn-secondary" id="cancel-account-btn">Cancel</button>
          </div>
        </div>
      </div>
    `;

    // Attach form event listeners
    this.attachAddAccountFormListeners();
  }

  /**
   * Attach event listeners for add account form
   */
  attachAddAccountFormListeners() {
    const submitBtn = document.getElementById('submit-account-btn');
    const cancelBtn = document.getElementById('cancel-account-btn');

    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        this.submitAddAccount();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.cancelAddAccount();
      });
    }
  }

  /**
   * Submit add account form
   */
  async submitAddAccount() {
    const providerSelect = document.getElementById('account-provider');
    const remoteNameInput = document.getElementById('remote-name');
    const remotePathInput = document.getElementById('remote-path');

    // Validate inputs
    if (!remoteNameInput?.value.trim()) {
      showError('Please enter a remote name');
      return;
    }

    if (!remotePathInput?.value.trim()) {
      showError('Please enter a remote path');
      return;
    }

    const accountData = {
      provider: providerSelect?.value || 'google_drive',
      remoteName: remoteNameInput.value.trim(),
      remotePath: remotePathInput.value.trim()
    };

    try {
      // Disable submit button
      const submitBtn = document.getElementById('submit-account-btn');
      if (submitBtn) submitBtn.disabled = true;

      // Add account via API
      await api.addAccount(accountData);

      // Success
      showSuccess('Account added successfully!');

      // Refresh accounts list
      await this.fetchAccounts();

      // Hide form
      this.showingAddAccountForm = false;
      this.renderAccountsTab();

    } catch (error) {
      console.error('Add account error:', error);
      showError(`Failed to add account: ${error.message}`);
      
      // Re-enable submit button
      const submitBtn = document.getElementById('submit-account-btn');
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  /**
   * Cancel add account form
   */
  cancelAddAccount() {
    this.showingAddAccountForm = false;
    this.renderAccountsTab();
  }

  /**
   * Delete account
   * @param {string} accountId - Account ID
   */
  async deleteAccount(accountId) {
    // Show confirmation dialog
    if (!confirm('Are you sure you want to delete this account? This action cannot be undone.')) {
      return;
    }

    try {
      // Delete account via API
      await api.deleteAccount(accountId);

      // Success
      showSuccess('Account deleted successfully');

      // Refresh accounts list
      await this.fetchAccounts();
      this.renderAccountsTab();

    } catch (error) {
      console.error('Delete account error:', error);
      showError(`Failed to delete account: ${error.message}`);
    }
  }

  /**
   * Fetch accounts from API
   */
  async fetchAccounts() {
    try {
      const accounts = await api.fetchAccounts();
      appState.setState({ accounts });
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
      showError('Failed to load accounts. Please try again.');
    }
  }

  /**
   * Open dashboard modal
   */
  async open() {
    this.container.classList.add('active');
    this.container.classList.add('opening');
    document.body.style.overflow = 'hidden';

    // Set up focus trap
    this.focusTrap = trapFocus(this.container);

    // Remove opening class after animation
    setTimeout(() => {
      this.container.classList.remove('opening');
    }, 300);

    // Fetch fresh data when opening dashboard
    await this.fetchStatistics();
    await this.fetchAccounts();

    // Render current tab
    this.renderTab(this.currentTab);
  }

  /**
   * Fetch statistics from API
   */
  async fetchStatistics() {
    try {
      const stats = await api.fetchStats();
      appState.setState({ stats });
    } catch (error) {
      console.error('Failed to fetch statistics:', error);
      showError('Failed to load statistics. Please try again.');
    }
  }

  /**
   * Render Cloud Storage (Remotes) tab
   */
  renderRemotesTab() {
    // Clear existing content
    this.elements.body.innerHTML = '<div id="remotes-container"></div>';
    
    // Initialize or refresh RemoteList component
    const container = document.getElementById('remotes-container');
    if (container) {
      if (this.remoteListComponent) {
        this.remoteListComponent.destroy();
      }
      this.remoteListComponent = new RemoteList(container);
    }
  }

  /**
   * Close dashboard modal
   */
  close() {
    this.container.classList.add('closing');

    // Remove focus trap
    if (this.focusTrap) {
      this.focusTrap();
      this.focusTrap = null;
    }

    setTimeout(() => {
      this.container.classList.remove('active');
      this.container.classList.remove('closing');
      document.body.style.overflow = '';
    }, 200);
  }

  /**
   * Check if dashboard is open
   * @returns {boolean}
   */
  isOpen() {
    return this.container.classList.contains('active');
  }

  /**
   * Destroy component and cleanup
   */
  destroy() {
    // Close if open
    if (this.isOpen()) {
      this.close();
    }

    // Destroy remote list component
    if (this.remoteListComponent) {
      this.remoteListComponent.destroy();
      this.remoteListComponent = null;
    }

    // Remove event listeners by cloning elements
    if (this.elements.closeButton) {
      this.elements.closeButton.replaceWith(this.elements.closeButton.cloneNode(true));
    }

    this.container.replaceWith(this.container.cloneNode(true));
  }
}

export default Dashboard;
