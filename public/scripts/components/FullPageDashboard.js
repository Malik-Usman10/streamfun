/**
 * FullPageDashboard Component
 * Full-page dashboard with sidebar navigation
 */

import appState from '../state.js';
import api from '../api.js';
import { formatBytes } from '../utils/format.js';
import { showError, showSuccess } from '../utils/dom.js';
import RemoteList from './RemoteList.js';

class FullPageDashboard {
  constructor(container) {
    this.container = container;
    this.currentSection = 'overview';
    this.sidebarCollapsed = false;
    this.remoteListComponent = null;
    this.selectedFile = null;
    this.expandedGroups = new Set(); // Track which directory groups are expanded
  }

  /**
   * Render the dashboard
   */
  render() {
    this.container.innerHTML = `
      <div class="dashboard-container">
        <!-- Dashboard Sidebar -->
        <aside class="dashboard-sidebar" id="dashboard-sidebar">
          <div class="dashboard-sidebar-header">
            <div class="dashboard-logo">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
              </svg>
              <span>StreamFun</span>
            </div>
            <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
          </div>
          
          <nav class="dashboard-nav">
            <button class="dashboard-nav-item active" data-section="overview">
              <svg class="dashboard-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
              <span>Overview</span>
            </button>
            
            <button class="dashboard-nav-item" data-section="files">
              <svg class="dashboard-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                <polyline points="13 2 13 9 20 9"></polyline>
              </svg>
              <span>Files</span>
            </button>
            
            <button class="dashboard-nav-item" data-section="cloud-storage">
              <svg class="dashboard-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
              </svg>
              <span>Cloud Storage</span>
            </button>
            
            <button class="dashboard-nav-item" data-section="auto-upload">
              <svg class="dashboard-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="16 16 12 12 8 16"></polyline>
                <line x1="12" y1="12" x2="12" y2="21"></line>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path>
              </svg>
              <span>Auto Upload</span>
            </button>

            <button class="dashboard-nav-item" data-section="upload">
              <svg class="dashboard-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span>Upload</span>
            </button>
            
            <button class="dashboard-nav-item" data-section="settings">
              <svg class="dashboard-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 1v6m0 6v6m5.2-13.2l-4.2 4.2m0 6l4.2 4.2M23 12h-6m-6 0H1m18.2 5.2l-4.2-4.2m-6 0l-4.2 4.2"></path>
              </svg>
              <span>Settings</span>
            </button>
          </nav>
          
          <div class="dashboard-sidebar-footer">
            <button class="dashboard-nav-item" id="back-to-home">
              <svg class="dashboard-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              </svg>
              <span>Back to Home</span>
            </button>
          </div>
        </aside>
        
        <!-- Dashboard Backdrop (Mobile) -->
        <div class="dashboard-backdrop" id="dashboard-backdrop"></div>
        
        <!-- Dashboard Main Content -->
        <div class="dashboard-main">
          <header class="dashboard-header">
            <div class="dashboard-header-title">
              <button class="sidebar-toggle" id="mobile-sidebar-toggle" aria-label="Toggle sidebar" style="display: none;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
              </button>
              <h1 id="dashboard-section-title">Overview</h1>
            </div>
            <div class="dashboard-header-actions">
              <button id="refresh-btn" aria-label="Refresh">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
              </button>
            </div>
          </header>
          
          <main class="dashboard-content" id="dashboard-content">
            <!-- Content will be dynamically rendered here -->
          </main>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.renderSection(this.currentSection);
    
    // Listen for account changes to update upload dropdown
    appState.subscribe((newState, prevState) => {
      if (newState.accounts !== prevState.accounts && this.currentSection === 'upload') {
        this.updateUploadProviders();
      }
    });

    this.loadData();
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Sidebar toggle
    const sidebarToggle = this.container.querySelector('#sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => {
        this.toggleSidebar();
      });
    }

    // Mobile sidebar toggle
    const mobileSidebarToggle = this.container.querySelector('#mobile-sidebar-toggle');
    if (mobileSidebarToggle) {
      mobileSidebarToggle.addEventListener('click', () => {
        this.toggleMobileSidebar();
      });
    }

    // Navigation items
    const navItems = this.container.querySelectorAll('.dashboard-nav-item[data-section]');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const section = item.dataset.section;
        this.switchSection(section);
      });
    });

    // Back to home button
    const backToHomeBtn = this.container.querySelector('#back-to-home');
    if (backToHomeBtn) {
      backToHomeBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('navigate:home'));
      });
    }

    // Refresh button
    const refreshBtn = this.container.querySelector('#refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadData();
      });
    }

    // Backdrop click
    const backdrop = this.container.querySelector('#dashboard-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => {
        this.closeMobileSidebar();
      });
    }
  }

  /**
   * Toggle sidebar collapsed state
   */
  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    const sidebar = this.container.querySelector('#dashboard-sidebar');
    if (sidebar) {
      sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
    }
    
    // Save state to localStorage
    localStorage.setItem('dashboard-sidebar-collapsed', this.sidebarCollapsed);
  }

  /**
   * Toggle mobile sidebar
   */
  toggleMobileSidebar() {
    const sidebar = this.container.querySelector('#dashboard-sidebar');
    const backdrop = this.container.querySelector('#dashboard-backdrop');
    
    if (sidebar) {
      sidebar.classList.toggle('open');
    }
    if (backdrop) {
      backdrop.classList.toggle('active');
    }
  }

  /**
   * Close mobile sidebar
   */
  closeMobileSidebar() {
    const sidebar = this.container.querySelector('#dashboard-sidebar');
    const backdrop = this.container.querySelector('#dashboard-backdrop');
    
    if (sidebar) {
      sidebar.classList.remove('open');
    }
    if (backdrop) {
      backdrop.classList.remove('active');
    }
  }

  /**
   * Switch to a different section
   * @param {string} section - Section name
   */
  switchSection(section) {
    // Update active nav item
    const navItems = this.container.querySelectorAll('.dashboard-nav-item[data-section]');
    navItems.forEach(item => {
      if (item.dataset.section === section) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Update section title
    const titleElement = this.container.querySelector('#dashboard-section-title');
    if (titleElement) {
      titleElement.textContent = this.getSectionTitle(section);
    }

    // Update current section
    this.currentSection = section;

    // Render section
    this.renderSection(section);

    // Close mobile sidebar
    this.closeMobileSidebar();
  }

  /**
   * Get section title
   * @param {string} section - Section name
   * @returns {string} Section title
   */
  getSectionTitle(section) {
    const titles = {
      'overview': 'Overview',
      'files': 'Files',
      'cloud-storage': 'Cloud Storage',
      'upload': 'Upload',
      'settings': 'Settings'
    };
    return titles[section] || section;
  }

  /**
   * Render section content
   * @param {string} section - Section name
   */
  renderSection(section) {
    const content = this.container.querySelector('#dashboard-content');
    if (!content) return;

    switch (section) {
      case 'overview':
        this.renderOverviewSection(content);
        break;
      case 'files':
        this.renderFilesSection(content);
        break;
      case 'cloud-storage':
        this.renderCloudStorageSection(content);
        break;
      case 'upload':
        this.renderUploadSection(content);
        break;
      case 'auto-upload':
        this.renderAutoUploadSection(content);
        break;
      case 'settings':
        this.renderSettingsSection(content);
        break;
      default:
        content.innerHTML = '<p>Section not found</p>';
    }
  }

  /**
   * Render Overview section
   */
  renderOverviewSection(content) {
    const state = appState.getState();
    const stats = state.stats || {};

    content.innerHTML = `
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
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
            </svg>
          </div>
          <div class="stat-content">
            <p class="stat-label">Cloud Remotes</p>
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
            <p class="stat-label">Active Remotes</p>
            <p class="stat-value">${stats.accounts?.active || 0}</p>
          </div>
        </div>
      </div>
      
      <div class="dashboard-section">
        <div class="dashboard-section-header">
          <h2 class="dashboard-section-title">Quick Actions</h2>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
          <button class="btn btn-primary" id="quick-upload">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px; margin-right: 8px;">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Upload Files
          </button>
          <button class="btn btn-secondary" id="quick-cloud">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px; margin-right: 8px;">
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
            </svg>
            Manage Cloud Storage
          </button>
          <button class="btn btn-secondary" id="quick-videos">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px; margin-right: 8px;">
              <path d="M23 7l-7 5 7 5V7z"></path>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
            Browse Videos
          </button>
          <button class="btn btn-secondary" id="quick-images">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px; margin-right: 8px;">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <path d="M21 15l-5-5L5 21"></path>
            </svg>
            Browse Images
          </button>
        </div>
      </div>
    `;

    // Attach quick action listeners
    this.attachQuickActionListeners();
  }

  /**
   * Attach quick action listeners
   */
  attachQuickActionListeners() {
    const quickUpload = this.container.querySelector('#quick-upload');
    const quickCloud = this.container.querySelector('#quick-cloud');
    const quickVideos = this.container.querySelector('#quick-videos');
    const quickImages = this.container.querySelector('#quick-images');

    if (quickUpload) {
      quickUpload.addEventListener('click', () => this.switchSection('upload'));
    }
    if (quickCloud) {
      quickCloud.addEventListener('click', () => this.switchSection('cloud-storage'));
    }
    if (quickVideos) {
      quickVideos.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('navigate:videos'));
      });
    }
    if (quickImages) {
      quickImages.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('navigate:images'));
      });
    }
  }

  /**
   * Render Files section
   */
  renderFilesSection(content) {
    content.innerHTML = `
      <div class="dashboard-section">
        <div class="dashboard-section-header">
          <h2 class="dashboard-section-title">All Files</h2>
        </div>
        <p>File management coming soon...</p>
      </div>
    `;
  }

  /**
   * Render Cloud Storage section
   */
  renderCloudStorageSection(content) {
    content.innerHTML = '<div id="remotes-container"></div>';
    
    // Initialize RemoteList component
    const container = content.querySelector('#remotes-container');
    if (container) {
      if (this.remoteListComponent) {
        this.remoteListComponent.destroy();
      }
      this.remoteListComponent = new RemoteList(container);
    }
  }

  /**
   * Render Upload section
   */
  renderUploadSection(content) {
    content.innerHTML = `
      <div class="dashboard-section">
        <div class="upload-dropzone" id="upload-dropzone">
          <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 64px; height: 64px; margin-bottom: 16px;">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <p class="upload-text" style="font-size: 18px; margin-bottom: 8px;">Drag and drop files here</p>
          <p class="upload-subtext" style="color: var(--text-tertiary); margin-bottom: 16px;">or</p>
          <button class="btn btn-primary" id="choose-files-btn">Choose Files</button>
          <input type="file" id="file-input" hidden multiple>
        </div>
        
        <div class="upload-options" style="margin-top: 24px;">
          <div class="form-group">
            <label>Provider</label>
            <select class="form-select" id="provider-select">
              <option value="">Loading providers...</option>
            </select>
          </div>
          
          <div class="form-group" id="collection-group">
            <label>Category (for images)</label>
            <div style="display: flex; gap: 8px;">
              <select class="form-select" id="category-select" style="flex: 1;">
                <option value="">Select existing category...</option>
              </select>
              <input type="text" class="form-input" id="collection-input" placeholder="Or create new category" style="flex: 1;">
            </div>
            <small style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 4px; display: block;">
              Choose an existing category or type a new one. Leave empty for default categorization.
            </small>
          </div>
          
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="encrypt-checkbox" checked>
              <span>Encrypt files</span>
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

    // Load existing categories for the dropdown
    this.loadCategoriesForUpload();

    // Populate providers
    this.updateUploadProviders();

    // Attach upload listeners (reuse from Dashboard component)
    this.attachUploadListeners();
  }

  /**
   * Load categories for upload dropdown
   */
  async loadCategoriesForUpload() {
    try {
      // Import API dynamically
      const { default: api } = await import('../api.js');
      
      // Load image categories (most common for categorization)
      const categories = await api.fetchCategories('image');
      
      const categorySelect = this.container.querySelector('#category-select');
      if (categorySelect && categories.length > 0) {
        // Clear existing options except the first one
        categorySelect.innerHTML = '<option value="">Select existing category...</option>';
        
        // Add category options
        categories.forEach(category => {
          const option = document.createElement('option');
          option.value = category.name;
          option.textContent = `${category.name} (${category.count} files)`;
          categorySelect.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Failed to load categories for upload:', error);
    }
  }

  /**
   * Attach upload listeners (simplified version)
   */
  attachUploadListeners() {
    const dropzone = this.container.querySelector('#upload-dropzone');
    const fileInput = this.container.querySelector('#file-input');
    const chooseFilesBtn = this.container.querySelector('#choose-files-btn');
    const categorySelect = this.container.querySelector('#category-select');
    const collectionInput = this.container.querySelector('#collection-input');

    if (chooseFilesBtn && fileInput) {
      chooseFilesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        fileInput.click();
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
          this.handleFilesSelected(files);
        }
      });
    }

    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          this.handleFilesSelected(files);
        }
      });
    }

    // Category selection interaction
    if (categorySelect && collectionInput) {
      categorySelect.addEventListener('change', () => {
        if (categorySelect.value) {
          collectionInput.value = '';
          collectionInput.placeholder = 'Category selected from dropdown';
        } else {
          collectionInput.placeholder = 'Or create new category';
        }
      });

      collectionInput.addEventListener('input', () => {
        if (collectionInput.value.trim()) {
          categorySelect.value = '';
        }
      });
    }

    const uploadBtn = this.container.querySelector('#upload-btn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        this.startUpload();
      });
    }
  }

  /**
   * Handle files selected
   */
  handleFilesSelected(files) {
    this.selectedFile = files[0]; // For now, handle single file
    
    const dropzone = this.container.querySelector('#upload-dropzone');
    if (dropzone) {
      const uploadText = dropzone.querySelector('.upload-text');
      if (uploadText) {
        uploadText.textContent = files.length === 1 
          ? `Selected: ${files[0].name}`
          : `Selected: ${files.length} files`;
      }
    }

    // Show collection field for images
    const collectionGroup = this.container.querySelector('#collection-group');
    if (collectionGroup && files[0]) {
      const isImage = files[0].type.startsWith('image/');
      collectionGroup.style.display = isImage ? 'block' : 'none';
    }
  }

  /**
   * Start upload
   */
  async startUpload() {
    if (!this.selectedFile) {
      showError('Please select a file to upload');
      return;
    }

    const providerSelect = this.container.querySelector('#provider-select');
    const encryptCheckbox = this.container.querySelector('#encrypt-checkbox');
    const categorySelect = this.container.querySelector('#category-select');
    const collectionInput = this.container.querySelector('#collection-input');
    const uploadProgress = this.container.querySelector('#upload-progress');
    const progressFill = this.container.querySelector('#progress-fill');
    const progressText = this.container.querySelector('#progress-text');
    const uploadBtn = this.container.querySelector('#upload-btn');

    // Determine collection name from category selection or manual input
    let collectionName = null;
    if (categorySelect?.value) {
      // Use selected existing category
      collectionName = categorySelect.value;
    } else if (collectionInput?.value) {
      // Use manually entered category
      collectionName = collectionInput.value.trim();
    }

    const options = {
      provider: providerSelect?.value || 'google_drive',
      encrypt: encryptCheckbox?.checked ?? true,
      collectionName
    };

    try {
      if (uploadProgress) uploadProgress.style.display = 'block';
      if (uploadBtn) uploadBtn.disabled = true;

      const result = await api.uploadFile(this.selectedFile, options, (progress) => {
        if (progressFill) progressFill.style.width = `${progress}%`;
        if (progressText) progressText.textContent = `Uploading... ${progress}%`;
      });

      showSuccess(`File "${this.selectedFile.name}" uploaded successfully!`);

      // Refresh gracefully without full page reload
      try {
        const stats = await api.fetchStats();
        appState.setState({ stats });
        
        if (result && result.file) {
           const currentState = appState.getState();
           const newFiles = [result.file, ...currentState.files];
           appState.setState({ files: newFiles });
        } else {
           await appState.refreshData();
        }
      } catch (e) {
        await this.loadData();
      }

      // Reset form
      this.resetUploadForm();

    } catch (error) {
      console.error('Upload error:', error);
      showError(`Upload failed: ${error.message}`);
    } finally {
      if (uploadProgress) uploadProgress.style.display = 'none';
      if (uploadBtn) uploadBtn.disabled = false;
    }
  }

  /**
   * Reset upload form
   */
  resetUploadForm() {
    this.selectedFile = null;
    
    const fileInput = this.container.querySelector('#file-input');
    if (fileInput) fileInput.value = '';

    const dropzone = this.container.querySelector('#upload-dropzone');
    if (dropzone) {
      const uploadText = dropzone.querySelector('.upload-text');
      if (uploadText) {
        uploadText.textContent = 'Drag and drop files here';
      }
    }

    const collectionInput = this.container.querySelector('#collection-input');
    if (collectionInput) collectionInput.value = '';

    const collectionGroup = this.container.querySelector('#collection-group');
    if (collectionGroup) collectionGroup.style.display = 'none';
  }

  /**
   * Render Settings section
   */
  async renderSettingsSection(content) {
    content.innerHTML = `
      <div class="dashboard-section">
        <div class="dashboard-section-header">
          <h2 class="dashboard-section-title">Security & Authentication</h2>
        </div>
        
        <div class="card" style="margin-top: var(--spacing-lg);">
          <div class="card-header">
            <h3>Admin Password</h3>
          </div>
          <div class="card-body">
            <p style="margin-bottom: var(--spacing-lg); color: var(--text-secondary);">
              Securing the platform with an admin password disables public access. 
              Anyone visiting the app will be prompted to login.
            </p>
            
            <div id="auth-status-container" style="margin-bottom: var(--spacing-xl); font-size: var(--font-size-lg);">
              <div class="loading-spinner"></div> Checking auth status...
            </div>

            <form id="setup-auth-form" style="display: none; display: flex; flex-direction: column; gap: var(--spacing-lg);">
              <div class="form-group">
                <label for="admin-password">New Admin Password</label>
                <input type="password" id="admin-password" minlength="6" required placeholder="Enter password (min 6 chars)" style="width: 100%; padding: var(--spacing-md); margin-top: var(--spacing-sm); font-size: var(--font-size-lg);">
              </div>
              <button type="submit" class="btn btn-primary" style="align-self: flex-start; padding: var(--spacing-md) var(--spacing-xl); font-size: var(--font-size-base);">Save Password & Enable Security</button>
            </form>

            <div id="disable-auth-container" style="display: none; margin-top: var(--spacing-lg); padding-top: var(--spacing-lg); border-top: 1px solid var(--border-color);">
              <p style="color: var(--color-warning); margin-bottom: var(--spacing-md);">
                Warning: Disabling authentication will make your media public to anyone with the link.
              </p>
              <button id="disable-auth-btn" class="btn btn-danger">Disable Authentication</button>
              <button id="logout-btn" class="btn" style="margin-left: var(--spacing-sm);">Logout Manually</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Fetch Status and Backup Config
    try {
      const [authStatus, backupConfig, accounts] = await Promise.all([
        fetch('/api/auth/status').then(res => res.json()),
        api.fetchBackupConfig(),
        api.fetchAccounts()
      ]);

      const statusContainer = content.querySelector('#auth-status-container');
      const setupForm = content.querySelector('#setup-auth-form');
      const disableContainer = content.querySelector('#disable-auth-container');

      if (authStatus.enabled) {
        statusContainer.innerHTML = '<span style="color: var(--color-success); font-weight: bold;">✓ Authentication is currently ENABLED.</span> You can update your password below.';
        setupForm.style.display = 'flex';
        disableContainer.style.display = 'block';
      } else {
        statusContainer.innerHTML = '<span style="color: var(--color-error); font-weight: bold;">⚠ Authentication is NOT ENABLED.</span> Your instance is public.';
        setupForm.style.display = 'flex';
      }

      // Add Backup Section
      const backupSection = document.createElement('div');
      backupSection.className = 'card';
      backupSection.style.marginTop = 'var(--spacing-xl)';
      backupSection.innerHTML = `
        <div class="card-header">
          <h3>Database Backup</h3>
        </div>
        <div class="card-body">
          <p style="margin-bottom: var(--spacing-lg); color: var(--text-secondary);">
            Configure automated database backups to your preferred cloud storage provider.
          </p>
          
          <form id="backup-config-form" style="display: flex; flex-direction: column; gap: var(--spacing-lg);">
            <div class="form-group">
              <label for="backup-destination">Backup Destination</label>
              <select id="backup-destination" style="width: 100%; padding: var(--spacing-md); margin-top: var(--spacing-sm); font-size: var(--font-size-base); background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;">
                <option value="">-- Select Cloud Account --</option>
                ${accounts.map(acc => `<option value="${acc.id}" ${acc.id === backupConfig.destination ? 'selected' : ''}>${acc.identifier || 'Unknown'} (${acc.provider})</option>`).join('')}
              </select>
            </div>

            <div class="form-group">
              <label for="backup-frequency">Backup Frequency</label>
              <select id="backup-frequency" style="width: 100%; padding: var(--spacing-md); margin-top: var(--spacing-sm); font-size: var(--font-size-base); background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;">
                <option value="manual" ${backupConfig.frequency === 'manual' ? 'selected' : ''}>Manual Only</option>
                <option value="daily" ${backupConfig.frequency === 'daily' ? 'selected' : ''}>Daily (Midnight)</option>
                <option value="weekly" ${backupConfig.frequency === 'weekly' ? 'selected' : ''}>Weekly (Sunday Midnight)</option>
              </select>
            </div>

            <div style="display: flex; gap: var(--spacing-md); margin-top: var(--spacing-md);">
              <button type="submit" class="btn btn-primary">Save Backup Settings</button>
              <button type="button" id="backup-now-btn" class="btn btn-secondary">Backup Now</button>
            </div>
          </form>

          <div id="backup-status-info" style="margin-top: var(--spacing-xl); padding-top: var(--spacing-lg); border-top: 1px solid var(--border-color);">
            <div style="display: flex; justify-content: space-between; margin-bottom: var(--spacing-sm);">
              <span style="color: var(--text-tertiary);">Last Run:</span>
              <span id="last-backup-time">${backupConfig.lastRun ? new Date(backupConfig.lastRun).toLocaleString() : 'Never'}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--text-tertiary);">Status:</span>
              <span id="backup-status-text" style="color: ${backupConfig.status === 'success' ? 'var(--color-success)' : backupConfig.status === 'failed' ? 'var(--color-error)' : 'var(--text-primary)'};">
                ${backupConfig.status ? backupConfig.status.toUpperCase() : 'NOT STARTED'}
              </span>
            </div>
          </div>
        </div>
      `;
      content.querySelector('.dashboard-section').appendChild(backupSection);

      // Handle Backup Config Form
      backupSection.querySelector('#backup-config-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const destination = backupSection.querySelector('#backup-destination').value;
        const frequency = backupSection.querySelector('#backup-frequency').value;

        try {
          await api.updateBackupConfig({ destination, frequency });
          showSuccess('Backup settings updated successfully');
        } catch (err) {
          showError('Failed to update backup settings');
        }
      });

      // Handle Backup Now Button
      backupSection.querySelector('#backup-now-btn').addEventListener('click', async () => {
        try {
          await api.triggerBackup();
          showSuccess('Backup job enqueued! Check logs for details.');
          backupSection.querySelector('#backup-status-text').textContent = 'RUNNING...';
          backupSection.querySelector('#backup-status-text').style.color = 'var(--text-primary)';
        } catch (err) {
          showError(err.message || 'Failed to trigger backup');
        }
      });

      // Handle Setup/Change Password
      setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = content.querySelector('#admin-password').value;
        if (!pwd || pwd.length < 6) {
          return showError('Password must be at least 6 characters');
        }

        try {
          const res = await fetch('/api/auth/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to setup auth');

          showSuccess('Authentication password enabled! Redirecting to login...');
          setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
          showError(err.message);
        }
      });

      // Handle Disable Auth
      content.querySelector('#disable-auth-btn')?.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to disable authentication and make your site public?')) return;
        try {
          const res = await fetch('/api/auth/disable', { method: 'POST' });
          if (!res.ok) throw new Error('Failed to disable auth');
          showSuccess('Authentication disabled successfully!');
          this.renderSettingsSection(content); // Re-render
        } catch (err) {
          showError(err.message);
        }
      });

      // Handle Logout
      content.querySelector('#logout-btn')?.addEventListener('click', async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
          window.location.reload();
        } catch (err) {
          showError('Logout failed');
        }
      });

    } catch (err) {
      console.error('Failed to load settings data', err);
      content.querySelector('#auth-status-container').innerHTML = '<span style="color: var(--color-error);">Failed to load settings data</span>';
    }
  }

  /**
   * Load dashboard data
   */
  async loadData() {
    try {
      const [stats, accounts] = await Promise.all([
        api.fetchStats(),
        api.fetchAccounts()
      ]);

      appState.setState({ stats, accounts });
      
      // Re-render current section if it's overview or update upload providers if in upload section
      const content = this.container.querySelector('#dashboard-content');
      if (content) {
        if (this.currentSection === 'overview') {
          this.renderOverviewSection(content);
        } else if (this.currentSection === 'upload') {
          this.updateUploadProviders();
        }
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      showError('Failed to load dashboard data');
    }
  }

  /**
   * Render the Auto Upload section — tracks directory-watch upload jobs
   */
  async renderAutoUploadSection(content) {
    content.innerHTML = `
      <div class="dashboard-section">
        <div class="dashboard-section-header" style="display:flex;align-items:center;justify-content:space-between;">
          <h2 class="dashboard-section-title">Auto Upload</h2>
          <button id="au-rescan-btn" class="btn btn-primary" style="display:flex;align-items:center;gap:0.5rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Rescan Directory
          </button>
        </div>

        <!-- Stats Row -->
        <div id="au-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1rem;margin:1.5rem 0;">
          <div class="card" style="padding:1.25rem;text-align:center;">
            <div style="font-size:2rem;font-weight:700;color:var(--color-primary);" id="au-stat-pending">—</div>
            <div style="color:var(--text-secondary);font-size:0.85rem;margin-top:0.25rem;">Pending</div>
          </div>
          <div class="card" style="padding:1.25rem;text-align:center;">
            <div style="font-size:2rem;font-weight:700;color:var(--color-info, #60a5fa);" id="au-stat-uploading">—</div>
            <div style="color:var(--text-secondary);font-size:0.85rem;margin-top:0.25rem;">Uploading</div>
          </div>
          <div class="card" style="padding:1.25rem;text-align:center;">
            <div style="font-size:2rem;font-weight:700;color:var(--color-warning, #fbbf24);" id="au-stat-verifying">—</div>
            <div style="color:var(--text-secondary);font-size:0.85rem;margin-top:0.25rem;">Verifying</div>
          </div>
          <div class="card" style="padding:1.25rem;text-align:center;">
            <div style="font-size:2rem;font-weight:700;color:var(--color-success, #4ade80);" id="au-stat-completed">—</div>
            <div style="color:var(--text-secondary);font-size:0.85rem;margin-top:0.25rem;">Completed</div>
          </div>
          <div class="card" style="padding:1.25rem;text-align:center;">
            <div style="font-size:2rem;font-weight:700;color:var(--color-error);" id="au-stat-failed">—</div>
            <div style="color:var(--text-secondary);font-size:0.85rem;margin-top:0.25rem;">Failed</div>
          </div>
        </div>

        <!-- Active Uploads -->
        <div class="card" style="margin-bottom:1.5rem;">
          <div class="card-header"><h3>Active & Pending</h3></div>
          <div class="card-body" id="au-active-list">
            <p style="color:var(--text-secondary);">Loading...</p>
          </div>
        </div>

        <!-- Completed -->
        <div class="card" style="margin-bottom:1.5rem;">
          <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;">
            <h3>Completed <span style="font-size:0.8rem;color:var(--color-success,#4ade80);">✓ Safe to delete from disk</span></h3>
          </div>
          <div class="card-body" id="au-completed-list">
            <p style="color:var(--text-secondary);">Loading...</p>
          </div>
        </div>

        <!-- Failed -->
        <div class="card">
          <div class="card-header"><h3>Failed</h3></div>
          <div class="card-body" id="au-failed-list">
            <p style="color:var(--text-secondary);">Loading...</p>
          </div>
        </div>
      </div>
    `;

    // Wire rescan button
    content.querySelector('#au-rescan-btn')?.addEventListener('click', async () => {
      const btn = content.querySelector('#au-rescan-btn');
      btn.disabled = true;
      btn.textContent = 'Scanning…';
      try {
        const res = await fetch('/api/scan-jobs/scan', { method: 'POST', credentials: 'include' });
        const data = await res.json();
        showSuccess?.(`Discovered ${data.discovered} new file(s)`);
        await this._refreshAutoUpload(content);
      } catch {
        showError?.('Rescan failed');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Rescan Directory`;
      }
    });

    await this._refreshAutoUpload(content);

    // Auto-refresh every 5s while section is visible
    this._auRefreshInterval = setInterval(async () => {
      const isVisible = content.querySelector('#au-stats');
      if (isVisible) await this._refreshAutoUpload(content);
      else clearInterval(this._auRefreshInterval);
    }, 5000);
  }

  async _refreshAutoUpload(content) {
    try {
      const [statsRes, jobsRes] = await Promise.all([
        fetch('/api/scan-jobs/stats', { credentials: 'include' }),
        fetch('/api/scan-jobs?limit=100', { credentials: 'include' }),
      ]);
      const stats = await statsRes.json();
      const { jobs } = await jobsRes.json();

      // Update stat cards
      const set = (id, val) => { const el = content.querySelector(id); if (el) el.textContent = val ?? '0'; };
      set('#au-stat-pending', stats.pending);
      set('#au-stat-uploading', stats.uploading);
      set('#au-stat-verifying', stats.verifying);
      set('#au-stat-completed', stats.completed);
      set('#au-stat-failed', stats.failed);

      // Active list (pending + uploading + verifying) - GROUP BY DIRECTORY
      const active = jobs.filter(j => j.status === 'pending' || j.status === 'uploading' || j.status === 'verifying');
      const activeEl = content.querySelector('#au-active-list');
      
      if (activeEl) {
        if (active.length === 0) {
          activeEl.innerHTML = '<p style="color:var(--text-secondary);">No active uploads.</p>';
        } else {
          // Grouping logic
          const groups = new Map();
          active.forEach(j => {
            const dir = j.directoryName || 'Other / Root';
            if (!groups.has(dir)) groups.set(dir, []);
            groups.get(dir).push(j);
          });

          activeEl.innerHTML = Array.from(groups.entries()).map(([dirName, dirJobs]) => {
            const isExpanded = this.expandedGroups.has(dirName);
            const totalFiles = dirJobs.length;
            const avgProgress = Math.round(dirJobs.reduce((sum, j) => sum + (j.progress || 0), 0) / totalFiles);
            const statusCounts = dirJobs.reduce((acc, j) => {
              acc[j.status] = (acc[j.status] || 0) + 1;
              return acc;
            }, {});

            const statusSummary = [];
            if (statusCounts.uploading) statusSummary.push(`${statusCounts.uploading} ⬆`);
            if (statusCounts.verifying) statusSummary.push(`${statusCounts.verifying} 🔍`);
            if (statusCounts.pending) statusSummary.push(`${statusCounts.pending} ⏳`);

            return `
              <div class="au-group ${isExpanded ? 'expanded' : ''}" data-dir="${dirName}">
                <div class="au-group-header" style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;cursor:pointer;margin-bottom:0.5rem;transition:background 0.2s;">
                  <div style="display:flex;align-items:center;gap:0.75rem;flex:1;min-width:0;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0;color:var(--color-primary);">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <div style="flex:1;min-width:0;">
                      <div style="font-weight:600;display:flex;align-items:center;gap:0.5rem;">
                         <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dirName}</span>
                         <span style="font-size:0.75rem;color:var(--text-tertiary);font-weight:400;">(${totalFiles} files)</span>
                      </div>
                      <div style="font-size:0.7rem;color:var(--text-secondary);margin-top:0.2rem;">${statusSummary.join(' · ')}</div>
                    </div>
                  </div>
                  
                  <div style="display:flex;align-items:center;gap:1rem;">
                    <div style="width:100px;height:4px;background:var(--bg-tertiary);border-radius:99px;overflow:hidden;flex-shrink:0;">
                      <div style="height:100%;width:${avgProgress}%;background:var(--color-primary);border-radius:99px;"></div>
                    </div>
                    <span style="font-size:0.8rem;width:35px;text-align:right;">${avgProgress}%</span>
                    <svg class="au-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;transition:transform 0.3s;${isExpanded ? 'transform:rotate(180deg);' : ''}">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </div>
                </div>

                <!-- Group Content (Files) - Only rendered fully if expanded, or simplified list for limit -->
                <div class="au-group-content" style="padding-left:1.5rem;display:${isExpanded ? 'block' : 'none'};">
                  ${dirJobs.slice(0, 50).map(j => `
                    <div style="margin-bottom:0.75rem;padding:0.5rem;border-left:2px solid var(--bg-tertiary);">
                      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
                        <span style="font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;">${j.filename}</span>
                        <span style="font-size:0.75rem;color:var(--text-secondary);">${this._formatBytes(j.fileSize)}</span>
                      </div>
                      <div style="height:4px;background:var(--bg-tertiary);border-radius:99px;overflow:hidden;">
                        <div style="height:100%;width:${j.progress}%;background:var(--color-primary);border-radius:99px;"></div>
                      </div>
                    </div>
                  `).join('')}
                  ${dirJobs.length > 50 ? `<div style="font-size:0.75rem;color:var(--text-tertiary);padding:0.5rem;text-align:center;">... and ${dirJobs.length - 50} more files</div>` : ''}
                </div>
              </div>
            `;
          }).join('');

          // Add toggle handlers
          activeEl.querySelectorAll('.au-group-header').forEach(header => {
            header.addEventListener('click', () => {
              const group = header.parentElement;
              const dir = group.dataset.dir;
              const content = group.querySelector('.au-group-content');
              const chevron = group.querySelector('.au-group-chevron');
              
              if (this.expandedGroups.has(dir)) {
                this.expandedGroups.delete(dir);
                content.style.display = 'none';
                chevron.style.transform = 'rotate(0deg)';
                group.classList.remove('expanded');
              } else {
                this.expandedGroups.add(dir);
                content.style.display = 'block';
                chevron.style.transform = 'rotate(180deg)';
                group.classList.add('expanded');
              }
            });
          });
        }
      }

      // Completed list
      const completed = jobs.filter(j => j.status === 'completed');
      const compEl = content.querySelector('#au-completed-list');
      if (compEl) {
        if (completed.length === 0) {
          compEl.innerHTML = '<p style="color:var(--text-secondary);">No completed uploads yet.</p>';
        } else {
          compEl.innerHTML = `<table style="width:100%;border-collapse:collapse;">
            <thead><tr style="border-bottom:1px solid var(--border-color);">
              <th style="text-align:left;padding:0.6rem 0.5rem;font-size:0.8rem;color:var(--text-secondary);">File</th>
              <th style="text-align:left;padding:0.6rem 0.5rem;font-size:0.8rem;color:var(--text-secondary);">Collection</th>
              <th style="text-align:left;padding:0.6rem 0.5rem;font-size:0.8rem;color:var(--text-secondary);">Size</th>
              <th style="text-align:left;padding:0.6rem 0.5rem;font-size:0.8rem;color:var(--text-secondary);">Provider</th>
              <th style="padding:0.6rem 0.5rem;"></th>
            </tr></thead>
            <tbody>
              ${completed.map(j => `
                <tr style="border-bottom:1px solid var(--border-color-subtle,rgba(255,255,255,0.05));" data-job-id="${j.id}">
                  <td style="padding:0.7rem 0.5rem;font-size:0.9rem;">
                    <span style="color:var(--color-success,#4ade80);">✓</span>
                    ${j.filename}
                  </td>
                  <td style="padding:0.7rem 0.5rem;font-size:0.85rem;color:var(--text-secondary);">${j.directoryName ?? '—'}</td>
                  <td style="padding:0.7rem 0.5rem;font-size:0.85rem;color:var(--text-secondary);">${this._formatBytes(j.fileSize)}</td>
                  <td style="padding:0.7rem 0.5rem;font-size:0.85rem;color:var(--text-secondary);">${j.providerType ?? '—'}</td>
                  <td style="padding:0.7rem 0.5rem;text-align:right;">
                    <button class="btn btn-sm au-dismiss-btn" data-id="${j.id}" style="font-size:0.75rem;padding:0.3rem 0.7rem;">Dismiss</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>`;

          // Dismiss handlers
          compEl.querySelectorAll('.au-dismiss-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = btn.dataset.id;
              await fetch(`/api/scan-jobs/${id}`, { method: 'DELETE', credentials: 'include' });
              btn.closest('tr')?.remove();
            });
          });
        }
      }

      // Failed list
      const failed = jobs.filter(j => j.status === 'failed');
      const failEl = content.querySelector('#au-failed-list');
      if (failEl) {
        if (failed.length === 0) {
          failEl.innerHTML = '<p style="color:var(--text-secondary);">No failed uploads.</p>';
        } else {
          failEl.innerHTML = failed.map(j => `
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:0.9rem 0;border-bottom:1px solid var(--border-color-subtle,rgba(255,255,255,0.05));">
              <div style="min-width:0;">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${j.filename}</div>
                <div style="font-size:0.8rem;color:var(--color-error);margin-top:0.2rem;">${j.errorMessage ?? 'Unknown error'}</div>
                <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.1rem;">Retried ${j.retryCount}x · ${this._formatBytes(j.fileSize)}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:0.4rem;flex-shrink:0;">
                <button class="btn btn-sm au-retry-btn" data-id="${j.id}">Retry</button>
                <button class="btn btn-sm btn-secondary au-dismiss-fail-btn" data-id="${j.id}">Dismiss</button>
              </div>
            </div>
          `).join('');

          failEl.querySelectorAll('.au-retry-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              btn.textContent = 'Queuing…';
              await fetch(`/api/scan-jobs/${btn.dataset.id}/retry`, { method: 'POST', credentials: 'include' });
              await this._refreshAutoUpload(content);
            });
          });

          failEl.querySelectorAll('.au-dismiss-fail-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              btn.textContent = 'Dismissing…';
              if (confirm('Dismiss this permanently? The file will not be re-uploaded automatically.')) {
                await fetch(`/api/scan-jobs/${btn.dataset.id}/dismiss`, { method: 'POST', credentials: 'include' });
                await this._refreshAutoUpload(content);
              } else {
                btn.disabled = false;
                btn.textContent = 'Dismiss';
              }
            });
          });
        }
      }
    } catch (err) {
      console.error('Auto upload refresh error', err);
    }
  }

  _formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  /**
   * Update the upload provider dropdown from appState
   */
  updateUploadProviders() {
    const providerSelect = this.container.querySelector('#provider-select');
    if (!providerSelect) return;

    const accounts = appState.get('accounts') || [];
    
    if (accounts.length === 0) {
      providerSelect.innerHTML = '<option value="">No providers connected</option>';
      return;
    }

    providerSelect.innerHTML = accounts.map(account => `
      <option value="${account.provider}">${account.identifier || account.provider} (${account.provider})</option>
    `).join('');
  }
}

export default FullPageDashboard;
