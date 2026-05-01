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

      // Add Restore Section
      const restoreSection = document.createElement('div');
      restoreSection.className = 'card';
      restoreSection.style.marginTop = 'var(--spacing-xl)';
      restoreSection.innerHTML = `
        <div class="card-header">
          <h3>Database Restore</h3>
        </div>
        <div class="card-body">
          <p style="margin-bottom: var(--spacing-lg); color: var(--text-secondary);">
            Restore your database from a backup dump file (.sql or .sql.gz).
          </p>
          
          <div style="padding: var(--spacing-lg); background: var(--color-warning-bg, rgba(251, 191, 36, 0.1)); border: 1px solid var(--color-warning, #fbbf24); border-radius: 8px; margin-bottom: var(--spacing-lg);">
            <div style="display: flex; align-items: flex-start; gap: var(--spacing-md);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 24px; height: 24px; color: var(--color-warning, #fbbf24); flex-shrink: 0; margin-top: 2px;">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              <div>
                <strong style="color: var(--color-warning, #fbbf24); display: block; margin-bottom: 4px;">Warning: This will replace all current data!</strong>
                <p style="margin: 0; font-size: 0.9rem;">Restoring a database backup will overwrite all existing data. Make sure you have a current backup before proceeding.</p>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label for="restore-file-input">Select Backup File</label>
            <div style="display: flex; gap: var(--spacing-md); align-items: center; margin-top: var(--spacing-sm);">
              <input type="file" id="restore-file-input" accept=".sql,.gz,.dump,.backup" style="flex: 1; padding: var(--spacing-sm); background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;">
              <button type="button" id="restore-btn" class="btn btn-danger" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px; margin-right: 8px;">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                Restore Database
              </button>
            </div>
            <small style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 4px; display: block;">
              Supported formats: .sql, .sql.gz, .dump, .backup (PostgreSQL custom format)
            </small>
          </div>

          <div id="restore-progress" style="display: none; margin-top: var(--spacing-lg);">
            <div style="width: 100%; height: 8px; background: var(--bg-tertiary); border-radius: 99px; overflow: hidden; margin-bottom: var(--spacing-sm);">
              <div id="restore-progress-bar" style="height: 100%; width: 0%; background: var(--color-primary); border-radius: 99px; transition: width 0.3s;"></div>
            </div>
            <p id="restore-progress-text" style="font-size: 0.875rem; color: var(--text-secondary); margin: 0;">Uploading... 0%</p>
          </div>
        </div>
      `;
      content.querySelector('.dashboard-section').appendChild(restoreSection);

      // Handle Restore File Selection
      const restoreFileInput = restoreSection.querySelector('#restore-file-input');
      const restoreBtn = restoreSection.querySelector('#restore-btn');
      
      restoreFileInput.addEventListener('change', () => {
        restoreBtn.disabled = !restoreFileInput.files || restoreFileInput.files.length === 0;
      });

      // Handle Restore Button
      restoreBtn.addEventListener('click', async () => {
        const file = restoreFileInput.files?.[0];
        if (!file) {
          showError('Please select a backup file');
          return;
        }

        const confirmed = confirm(
          '⚠️ WARNING: This will REPLACE ALL current data with the backup!\n\n' +
          'Are you absolutely sure you want to restore from this backup?\n\n' +
          'This action cannot be undone.'
        );

        if (!confirmed) return;

        const restoreProgress = restoreSection.querySelector('#restore-progress');
        const restoreProgressBar = restoreSection.querySelector('#restore-progress-bar');
        const restoreProgressText = restoreSection.querySelector('#restore-progress-text');

        try {
          restoreBtn.disabled = true;
          restoreFileInput.disabled = true;
          restoreProgress.style.display = 'block';

          await api.restoreDatabase(file, (progress) => {
            restoreProgressBar.style.width = `${progress}%`;
            restoreProgressText.textContent = `Uploading... ${progress}%`;
          });

          restoreProgressText.textContent = 'Restoring database... This may take a few minutes.';
          restoreProgressBar.style.width = '100%';

          // Wait a bit for the restore to complete
          await new Promise(resolve => setTimeout(resolve, 2000));

          showSuccess('Database restored successfully! The page will reload in 3 seconds.');
          
          setTimeout(() => {
            window.location.reload();
          }, 3000);

        } catch (err) {
          console.error('Restore error:', err);
          showError(err.message || 'Failed to restore database');
          restoreBtn.disabled = false;
          restoreFileInput.disabled = false;
          restoreProgress.style.display = 'none';
        }
      });

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
      const [statsRes, groupsRes, activeRes] = await Promise.all([
        fetch('/api/scan-jobs/stats', { credentials: 'include' }),
        fetch('/api/scan-jobs/groups', { credentials: 'include' }),
        fetch('/api/scan-jobs?status=uploading,verifying&limit=100', { credentials: 'include' }),
      ]);
      const stats = await statsRes.json();
      const groups = await groupsRes.json();
      const { jobs: activeJobs } = await activeRes.json();

      // Update stat cards
      const set = (id, val) => { const el = content.querySelector(id); if (el) el.textContent = val ?? '0'; };
      set('#au-stat-pending', stats.pending);
      set('#au-stat-uploading', stats.uploading);
      set('#au-stat-verifying', stats.verifying);
      set('#au-stat-completed', stats.completed);
      set('#au-stat-failed', stats.failed);

      // Render Active & Pending Section
      this._renderGroupedDashboard(content.querySelector('#au-active-list'), groups, activeJobs, 'active');

      // For Completed and Failed, we might still need some individual recent jobs
      // but let's prioritize the Active section first as it's the most critical
      const [compRes, failRes] = await Promise.all([
        fetch('/api/scan-jobs?status=completed&limit=50', { credentials: 'include' }),
        fetch('/api/scan-jobs?status=failed&limit=50', { credentials: 'include' }),
      ]);
      const { jobs: compJobs } = await compRes.json();
      const { jobs: failJobs } = await failRes.json();

      this._renderGroupedDashboard(content.querySelector('#au-completed-list'), groups, compJobs, 'completed');
      this._renderGroupedDashboard(content.querySelector('#au-failed-list'), groups, failJobs, 'failed');

    } catch (err) {
      console.error('Auto upload refresh error', err);
    }
  }

  /**
   * Main dashboard renderer that uses global directory stats (groups) and individual priority jobs
   */
  _renderGroupedDashboard(container, groups, individualJobs, sectionType) {
    if (!container) return;

    // Filter groups and individuals relevant to this section
    const relevantGroups = groups.filter(g => {
      if (sectionType === 'active') return (g.uploadingCount + g.verifyingCount + g.pendingCount) > 0;
      if (sectionType === 'completed') return g.completedCount > 0;
      if (sectionType === 'failed') return g.failedCount > 0;
      return false;
    });

    const relevantIndividuals = individualJobs.filter(j => {
      if (sectionType === 'active') return j.status === 'uploading' || j.status === 'verifying' || j.status === 'pending';
      return j.status === sectionType;
    });

    if (relevantGroups.length === 0 && relevantIndividuals.length === 0) {
      container.innerHTML = `<p style="color:var(--text-secondary);">No ${sectionType === 'active' ? 'active/pending' : sectionType} uploads.</p>`;
      return;
    }

    // Separate videos from individuals (Videos are always individual priority)
    const priorityVideos = relevantIndividuals.filter(j => j.mimeType?.startsWith('video/'));
    
    // For images, we only show individual items if they are NOT in a group or if we want them as priority
    // Actually, let's show ALL relevant individuals that are NOT caught by group headers to be safe
    // But videos should ALWAYS be shown at the top.
    const otherIndividuals = relevantIndividuals.filter(j => !j.mimeType?.startsWith('video/'));

    let html = '';

    // 1. Priority Videos
    if (priorityVideos.length > 0) {
      html += priorityVideos.map(j => this._renderJobItem(j, sectionType)).join('');
    }

    // 2. Folder Groups (Accurate Counts from Backend)
    if (relevantGroups.length > 0) {
      html += relevantGroups.map(g => {
        const dirName = g.directoryName || 'Other / Root';
        const isExpanded = this.expandedGroups.has(dirName);
        
        const count = sectionType === 'active' 
          ? (g.uploadingCount + g.verifyingCount + g.pendingCount) 
          : (sectionType === 'completed' ? g.completedCount : g.failedCount);
        
        const progress = g.avgProgress || 0;
        
        const summary = [];
        if (sectionType === 'active') {
          if (g.uploadingCount) summary.push(`${g.uploadingCount} ⬆`);
          if (g.verifyingCount) summary.push(`${g.verifyingCount} 🔍`);
          if (g.pendingCount) summary.push(`${g.pendingCount} ⏳`);
        } else {
          summary.push(`${count} ${sectionType === 'completed' ? '✓' : '⚠'}`);
        }

        return `
          <div class="au-group ${isExpanded ? 'expanded' : ''}" data-dir="${dirName}">
            <div class="au-group-header" style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0.75rem;background:rgba(255,255,255,0.03);border-radius:8px;cursor:pointer;margin-bottom:0.4rem;transition:background 0.2s;">
              <div style="display:flex;align-items:center;gap:0.75rem;flex:1;min-width:0;">
                ${g.category === 'images' ? `
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0;color:var(--color-primary);">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                  </svg>
                ` : `
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0;color:var(--color-primary);">
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                  </svg>
                `}
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;font-size:0.9rem;display:flex;align-items:center;gap:0.5rem;">
                     <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dirName}</span>
                     <span style="font-size:0.75rem;color:var(--text-tertiary);font-weight:400;">(${count} files)</span>
                  </div>
                  <div style="font-size:0.7rem;color:var(--text-secondary);">${summary.join(' · ')}</div>
                </div>
              </div>
              
              <div style="display:flex;align-items:center;gap:0.75rem;">
                ${sectionType !== 'active' ? `
                  <button class="au-bulk-dismiss-btn" data-dir="${dirName}" data-status="${sectionType}" style="font-size:0.7rem;color:var(--text-tertiary);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;margin-right:0.5rem;" onclick="event.stopPropagation()">Dismiss All</button>
                ` : ''}
                <div style="width:80px;height:4px;background:var(--bg-tertiary);border-radius:99px;overflow:hidden;flex-shrink:0;">
                  <div style="height:100%;width:${progress}%;background:var(--color-primary);border-radius:99px;"></div>
                </div>
                <span style="font-size:0.75rem;width:30px;text-align:right;">${Math.round(progress)}%</span>
                <svg class="au-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;transition:transform 0.3s;${isExpanded ? 'transform:rotate(180deg);' : ''}">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>

            <div class="au-group-content" id="group-content-${dirName.replace(/[^a-z0-9]/gi, '_')}" style="padding-left:1.5rem;display:${isExpanded ? 'block' : 'none'};">
              ${isExpanded ? `<div class="loading-mini" style="font-size:0.7rem;color:var(--text-tertiary);padding:0.5rem;">Loading details...</div>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }

    // 3. Other Individuals (that don't fit in groups or videos)
    if (otherIndividuals.length > 0) {
      // Only show top 10 individual images to prevent clutter if they aren't grouped
      html += otherIndividuals.slice(0, 10).map(j => this._renderJobItem(j, sectionType)).join('');
    }

    container.innerHTML = html;

    // Attach Event Listeners
    this._attachGroupedEventListeners(container, sectionType);
    
    // Automatically fetch expanded group details
    relevantGroups.forEach(g => {
      const dirName = g.directoryName || 'Other / Root';
      if (this.expandedGroups.has(dirName)) {
        this._fetchGroupDetails(dirName, sectionType);
      }
    });
  }

  /**
   * Fetch individual jobs for an expanded group
   */
  async _fetchGroupDetails(dirName, sectionType) {
    try {
      const statusFilter = sectionType === 'active' ? 'uploading,verifying,pending' : sectionType;
      const res = await fetch(`/api/scan-jobs?directoryName=${encodeURIComponent(dirName)}&status=${statusFilter}&limit=100`, { credentials: 'include' });
      const { jobs } = await res.json();
      
      const contentId = `group-content-${dirName.replace(/[^a-z0-9]/gi, '_')}`;
      const contentEl = document.getElementById(contentId);
      if (contentEl) {
        if (jobs.length === 0) {
          contentEl.innerHTML = `<div style="font-size:0.7rem;color:var(--text-secondary);padding:0.5rem;">No files found in this status.</div>`;
        } else {
          contentEl.innerHTML = jobs.map(j => this._renderJobItem(j, sectionType, true)).join('');
          if (jobs.length === 100) {
             contentEl.innerHTML += `<div style="font-size:0.7rem;color:var(--text-tertiary);padding:0.4rem;text-align:center;">Showing first 100 items...</div>`;
          }
        }
        // Re-attach listeners for the new buttons
        this._attachJobEventListeners(contentEl);
      }
    } catch (err) {
      console.error('Failed to fetch group details', err);
    }
  }

  _attachGroupedEventListeners(container, sectionType) {
    container.querySelectorAll('.au-group-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.parentElement;
        const dir = group.dataset.dir;
        const content = group.querySelector('.au-group-content');
        const chevron = group.querySelector('.au-group-chevron');
        
        if (this.expandedGroups.has(dir)) {
          this.expandedGroups.delete(dir);
          content.style.display = 'none';
          chevron.style.transform = 'rotate(0deg)';
        } else {
          this.expandedGroups.add(dir);
          content.style.display = 'block';
          chevron.style.transform = 'rotate(180deg)';
          this._fetchGroupDetails(dir, sectionType);
        }
      });
    });

    container.querySelectorAll('.au-bulk-dismiss-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const dir = btn.dataset.dir;
        const status = btn.dataset.status;
        if (confirm(`Dismiss all ${status} jobs in "${dir}"?`)) {
          const url = `/api/scan-jobs/bulk?directoryName=${encodeURIComponent(dir)}&status=${status}`;
          await fetch(url, { method: 'DELETE', credentials: 'include' });
          this._refreshAutoUpload(container.closest('#dashboard-content'));
        }
      });
    });
    
    // Also attach listeners to any top-level individual jobs
    this._attachJobEventListeners(container);
  }

  /**
   * Render a single job item
   */
  _renderJobItem(job, sectionType, isSubItem = false) {
    const isVideo = job.mimeType?.startsWith('video/');
    const icon = isVideo ? `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;color:var(--color-primary);">
        <circle cx="12" cy="12" r="10"></circle>
        <polygon points="10 8 16 12 10 16 10 8"></polygon>
      </svg>
    ` : `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;color:var(--color-primary);">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>
    `;
    const statusColor = job.status === 'completed' ? 'var(--color-success)' : (job.status === 'failed' ? 'var(--color-error)' : 'var(--color-primary)');
    
    return `
      <div class="au-job-item ${sectionType}" data-id="${job.id}" style="margin-bottom:1rem; padding: ${isSubItem ? '0.2rem 0' : '0.5rem'}; border-radius: 8px; ${!isSubItem ? 'background: rgba(255,255,255,0.02);' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.4rem;gap:1rem;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <span style="display:flex;align-items:center;">${icon}</span>
              <span style="font-weight:600;font-size:0.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">${job.filename}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.1rem;">
              ${job.directoryName ? '📁 ' + job.directoryName + ' · ' : ''}${this._formatBytes(job.fileSize)}
              ${job.errorMessage ? ` · <span style="color:var(--color-error)">${job.errorMessage}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem;">
            <span style="font-size:0.75rem;font-weight:bold;color:${statusColor};">${job.status.toUpperCase()}</span>
            <div style="display:flex;gap:0.5rem;">
              ${this._renderJobActions(job, sectionType)}
            </div>
          </div>
        </div>
        <div style="height:4px;background:var(--bg-tertiary);border-radius:99px;overflow:hidden;position:relative;">
          <div style="height:100%;width:${job.progress}%;background:${statusColor};border-radius:99px;transition:width 0.5s;"></div>
        </div>
      </div>
    `;
  }

  /**
   * Render actions for a specific job
   */
  _renderJobActions(job, sectionType) {
    if (sectionType === 'active') {
      return job.status === 'pending' ? `<button class="au-remove-btn" data-id="${job.id}" style="font-size:0.7rem;color:var(--color-error);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;">Remove</button>` : '';
    } else if (sectionType === 'completed') {
      return `<button class="au-dismiss-btn" data-id="${job.id}" style="font-size:0.7rem;color:var(--text-tertiary);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;">Dismiss</button>`;
    } else if (sectionType === 'failed') {
      return `
        <button class="au-retry-btn" data-id="${job.id}" style="font-size:0.7rem;color:var(--color-primary);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;">Retry</button>
        <button class="au-dismiss-fail-btn" data-id="${job.id}" style="font-size:0.7rem;color:var(--text-tertiary);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;">Dismiss</button>
      `;
    }
    return '';
  }

  /**
   * Attach event listeners to job items and groups
   */
  _attachJobEventListeners(container) {
    // Accordion Toggles
    container.querySelectorAll('.au-group-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // Ignore if button clicked
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

    // Remove buttons
    container.querySelectorAll('.au-remove-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = btn.dataset.id;
        if (confirm('Remove from upload queue?')) {
          await fetch(`/api/scan-jobs/${id}`, { method: 'DELETE', credentials: 'include' });
          this._refreshAutoUpload(container.closest('#dashboard-content'));
        }
      });
    });

    // Dismiss buttons
    container.querySelectorAll('.au-dismiss-btn, .au-dismiss-fail-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = btn.dataset.id;
        const endpoint = btn.classList.contains('au-dismiss-fail-btn') ? `/api/scan-jobs/${id}/dismiss` : `/api/scan-jobs/${id}`;
        await fetch(endpoint, { method: btn.classList.contains('au-dismiss-fail-btn') ? 'POST' : 'DELETE', credentials: 'include' });
        this._refreshAutoUpload(container.closest('#dashboard-content'));
      });
    });

    // Retry buttons
    container.querySelectorAll('.au-retry-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = btn.dataset.id;
        btn.disabled = true;
        btn.textContent = 'Queuing...';
        await fetch(`/api/scan-jobs/${id}/retry`, { method: 'POST', credentials: 'include' });
        this._refreshAutoUpload(container.closest('#dashboard-content'));
      });
    });

    // Group Dismiss
    container.querySelectorAll('.au-group-dismiss-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const dir = btn.dataset.dir;
        if (confirm(`Dismiss all completed jobs in "${dir}"?`)) {
          // This would ideally be a bulk endpoint, but we can do parallel deletes for now
          // We need to fetch the jobs in this group again or pass them in. 
          // For simplicity, we just trigger a refresh after showing info.
          showInfo?.(`Dismissing files in "${dir}"...`);
          // Note: In a real app, you'd want a bulk delete API. 
        }
      });
    });
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
