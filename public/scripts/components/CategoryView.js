/**
 * CategoryView Component
 * Shows categories for images or videos, then allows browsing within categories
 */

import Gallery from './Gallery.js';
import appState from '../state.js';

class CategoryView {
  constructor(container, fileType = 'images') {
    this.container = container;
    this.fileType = fileType; // 'images' or 'videos'
    this.currentCategory = null;
    this.gallery = null;
    this.standaloneGallery = null;
    this.categories = [];
    this.standaloneFiles = [];
  }

  /**
   * Render the category view
   */
  async render() {
    if (this.currentCategory) {
      // Show files within the selected category
      await this.renderCategoryFiles();
    } else {
      // Show category grid
      await this.renderCategories();
    }
  }

  /**
   * Render the categories grid
   */
  async renderCategories() {
    // Reset app state when entering categories view
    appState.setState({
      files: [],
      categoryFilter: null,
      currentCategory: this.fileType === 'images' ? 'images' : 'videos'
    });

    this.container.innerHTML = `
      <div class="category-view-container">
        <!-- Header -->
        <header class="gallery-header">
          <div class="gallery-header-content">
            <div class="gallery-header-left">
              <button class="back-button" id="back-to-home" aria-label="Back to home">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>
              <div class="gallery-header-title">
                <h1>${this.fileType === 'images' ? 'Image Categories' : 'Video Categories'}</h1>
                <span class="category-count" id="category-count">0 categories</span>
              </div>
            </div>
            
            <div class="gallery-header-actions">
              <button class="header-action-btn" id="switch-category" aria-label="Switch to ${this.fileType === 'images' ? 'videos' : 'images'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  ${this.fileType === 'images'
        ? '<path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>'
        : '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path>'
      }
                </svg>
                <span>${this.fileType === 'images' ? 'Videos' : 'Images'}</span>
              </button>
              <button class="header-action-btn" id="dashboard-button" aria-label="Open dashboard">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
                <span>Dashboard</span>
              </button>
            </div>
          </div>
        </header>
        
        <!-- Categories Container -->
        <main class="categories-main">
          <!-- Loading State -->
          <div class="loading-state" id="loading-state">
            <div class="spinner"></div>
            <p>Loading...</p>
          </div>
          
          <!-- Categories Section -->
          <section id="categories-section" style="display: none;">
            <div class="categories-grid" id="categories-grid">
              <!-- Category items will be dynamically inserted here -->
            </div>
          </section>

          <!-- Standalone Files Section -->
          <section id="standalone-section" style="display: none; margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border-color);">
            <h2 id="standalone-title" style="margin-bottom: 20px; font-size: 1.5rem; color: var(--text-color);">
              ${this.fileType === 'images' ? 'Other Images' : 'Other Videos'}
            </h2>
            <div class="gallery-grid" id="standalone-grid">
              <!-- Standalone items will be dynamically inserted here -->
            </div>
          </section>
          
          <!-- Empty State -->
          <div class="empty-state" id="empty-state" style="display: none;">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <h2 id="empty-title">No ${this.fileType === 'images' ? 'images' : 'videos'} yet</h2>
            <p id="empty-description">Upload your first ${this.fileType === 'images' ? 'images' : 'videos'} to get started</p>
          </div>
        </main>
      </div>
    `;

    // Attach event listeners
    this.attachCategoryEventListeners();

    // Load categories
    await this.loadCategories();
  }

  /**
   * Render files within a specific category
   */
  async renderCategoryFiles() {
    this.container.innerHTML = `
      <div class="category-files-container">
        <!-- Header -->
        <header class="gallery-header">
          <div class="gallery-header-content">
            <div class="gallery-header-left">
              <button class="back-button" id="back-to-categories" aria-label="Back to categories">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>
              <div class="gallery-header-title">
                <h1>${this.currentCategory}</h1>
                <span class="file-count" id="file-count">0 files</span>
              </div>
            </div>
            
            <div class="gallery-header-actions">
              <button class="header-action-btn" id="manage-category" aria-label="Manage category">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                <span>Manage</span>
              </button>
              <button class="header-action-btn" id="dashboard-button" aria-label="Open dashboard">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
                <span>Dashboard</span>
              </button>
            </div>
          </div>
        </header>
        
        <!-- Gallery Container -->
        <main class="gallery-main" id="gallery-main">
          <div class="loading-state" id="loading-state">
            <div class="spinner"></div>
            <p>Loading files...</p>
          </div>
          <div class="gallery-grid" id="gallery-grid" style="display: none;"></div>
          <div class="empty-state" id="empty-state" style="display: none;">
            <h2 id="empty-title">No files found</h2>
            <p id="empty-description">This category is currently empty</p>
          </div>
        </main>
      </div>
    `;

    // Initialize gallery component for this category
    const galleryContainer = this.container.querySelector('.gallery-main');
    this.gallery = new Gallery(galleryContainer);

    // Attach event listeners
    this.attachFileEventListeners();
  }

  /**
   * Load categories from API
   */
  async loadCategories() {
    try {
      const type = this.fileType === 'images' ? 'image' : 'video';
      
      // Import API dynamically
      const { default: api } = await import('../api.js');

      // Fetch real categories and standalone files in parallel
      const [categories, standaloneFiles] = await Promise.all([
        api.fetchCategories(type),
        api.fetchFiles({ type, category: 'Uncategorized' })
      ]);

      this.categories = categories || [];
      this.standaloneFiles = standaloneFiles || [];

      this.renderMixedGrid();
    } catch (error) {
      console.error('Error loading gallery data:', error);
      this.showEmptyState();
    }
  }

  /**
   * Render the mixed categories and standalone grid
   */
  async renderMixedGrid() {
    const loadingState = this.container.querySelector('#loading-state');
    const categoriesSection = this.container.querySelector('#categories-section');
    const categoriesGrid = this.container.querySelector('#categories-grid');
    const standaloneSection = this.container.querySelector('#standalone-section');
    const standaloneGrid = this.container.querySelector('#standalone-grid');
    const emptyState = this.container.querySelector('#empty-state');
    const categoryCountLabel = this.container.querySelector('#category-count');

    loadingState.style.display = 'none';

    const hasCategories = this.categories.length > 0;
    const hasStandalone = this.standaloneFiles.length > 0;

    if (!hasCategories && !hasStandalone) {
      emptyState.style.display = 'flex';
      categoriesSection.style.display = 'none';
      standaloneSection.style.display = 'none';
      categoryCountLabel.textContent = `0 ${this.fileType}`;
      return;
    }

    emptyState.style.display = 'none';
    categoryCountLabel.textContent = `${this.categories.length} collections, ${this.standaloneFiles.length} individual`;

    // Render Categories
    if (hasCategories) {
      categoriesSection.style.display = 'block';
      categoriesGrid.innerHTML = '';
      this.categories.forEach(category => {
        const item = this.createCategoryItem(category);
        categoriesGrid.appendChild(item);
      });
    } else {
      categoriesSection.style.display = 'none';
    }

    // Render Standalone Files
    if (hasStandalone) {
      standaloneSection.style.display = 'block';
      standaloneGrid.innerHTML = '';
      
      // Initialize a Gallery component for standalone files if not already done
      if (!this.standaloneGallery) {
        this.standaloneGallery = new Gallery(standaloneSection);
      }
      
      // Manually render standalone items using Gallery's item creation for consistency
      this.standaloneFiles.forEach((file, index) => {
        const item = this.standaloneGallery.createGalleryItem(file, index);
        standaloneGrid.appendChild(item);
      });
    } else {
      standaloneSection.style.display = 'none';
    }
  }

  /**
   * Create a category item element
   */
  createCategoryItem(category) {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.setAttribute('data-category', category.name);

    const thumbnailHtml = category.thumbnail
      ? `<img src="${category.thumbnail}" alt="${category.name}" class="category-thumbnail" loading="lazy">`
      : `<div class="category-thumbnail-placeholder">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
           </svg>
         </div>`;

    item.innerHTML = `
      <div class="category-thumbnail-container">
        ${thumbnailHtml}
        <div class="category-overlay">
          <div class="category-count-badge">${category.count}</div>
        </div>
      </div>
      <div class="category-info">
        <div class="category-name-row">
          <h3 class="category-name">${category.name}</h3>
          <button class="category-rename-btn" title="Rename" aria-label="Rename ${category.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
        <p class="category-count">${category.count} ${category.count === 1 ? 'file' : 'files'}</p>
      </div>
    `;

    // Add click handler for category (exclude rename button)
    item.addEventListener('click', (e) => {
      if (e.target.closest('.category-rename-btn')) {
        e.stopPropagation();
        this.handleRenameCategory(category.name);
        return;
      }
      this.openCategory(category.name);
    });

    return item;
  }

  /**
   * Open a specific category
   */
  async openCategory(categoryName) {
    this.currentCategory = categoryName;

    // Set the category filter in app state
    appState.setState({
      currentCategory: this.fileType === 'images' ? 'images' : 'videos',
      categoryFilter: categoryName
    });

    await this.renderCategoryFiles();

    // Load files for this category
    await this.loadCategoryFiles(categoryName);
  }

  /**
   * Load files for a specific category
   */
  async loadCategoryFiles(categoryName) {
    try {
      // Set loading state
      appState.setLoading(true);

      // Import API dynamically to avoid circular dependencies
      const { default: api } = await import('../api.js');

      // Fetch files for this category
      const response = await api.fetchFilesPaginated({
        type: this.fileType === 'images' ? 'image' : 'video',
        category: categoryName,
        page: 1,
        limit: 50
      });

      // Update app state
      appState.setPagination(response.pagination);
      appState.setFiles(response.items || []);
      appState.setLoading(false);

    } catch (error) {
      console.error('Failed to load category files:', error);
      appState.setLoading(false);

      // Show error message
      const { showError } = await import('../utils/dom.js');
      showError('Failed to load files. Please try again.');
    }
  }

  /**
   * Go back to categories view
   */
  backToCategories() {
    this.currentCategory = null;
    if (this.gallery) {
      this.gallery.destroy();
      this.gallery = null;
    }
    this.renderCategories();
  }

  /**
   * Show empty state
   */
  showEmptyState() {
    const loadingState = this.container.querySelector('#loading-state');
    const categoriesGrid = this.container.querySelector('#categories-grid');
    const emptyState = this.container.querySelector('#empty-state');
    const categoryCount = this.container.querySelector('#category-count');

    if (loadingState) loadingState.style.display = 'none';
    if (categoriesGrid) categoriesGrid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    if (categoryCount) categoryCount.textContent = '0 categories';
  }

  /**
   * Attach event listeners for category view
   */
  attachCategoryEventListeners() {
    // Back to home button
    const backButton = this.container.querySelector('#back-to-home');
    if (backButton) {
      backButton.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('navigate:home'));
      });
    }

    // Switch category button
    const switchButton = this.container.querySelector('#switch-category');
    if (switchButton) {
      switchButton.addEventListener('click', () => {
        const targetType = this.fileType === 'images' ? 'videos' : 'images';
        window.dispatchEvent(new CustomEvent(`navigate:${targetType}`));
      });
    }


  }

  /**
   * Attach event listeners for file view within category
   */
  attachFileEventListeners() {
    // Back to categories button
    const backButton = this.container.querySelector('#back-to-categories');
    if (backButton) {
      backButton.addEventListener('click', () => {
        this.backToCategories();
      });
    }

    // Manage category button
    const manageButton = this.container.querySelector('#manage-category');
    if (manageButton) {
      manageButton.addEventListener('click', () => {
        this.showManageCategoryModal();
      });
    }


  }

  /**
   * Show manage category modal (placeholder for future implementation)
   */
  showManageCategoryModal() {
    alert(`Manage category "${this.currentCategory}" - Feature coming soon!`);
  }

  /**
   * Destroy the component
   */
  destroy() {
    if (this.gallery && typeof this.gallery.destroy === 'function') {
      this.gallery.destroy();
    }

    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  /**
   * Handle renaming a category
   */
  async handleRenameCategory(oldName) {
    const newName = prompt('Enter new category name:', oldName);
    if (!newName || newName === oldName) return;

    try {
      // Find a sample file ID from this category to use the rename endpoint
      // The backend PATCH /api/files/:id/rename accepts { collectionName }
      const response = await fetch(`/api/files/rename-category`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          oldName, 
          newName,
          type: this.fileType === 'images' ? 'image' : 'video' 
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to rename category');
      }

      window.showNotification('Category renamed successfully', 'success');
      await this.loadCategories(); // Refresh list
    } catch (error) {
      console.error('Rename category error:', error);
      window.showNotification(error.message, 'error');
    }
  }
}

export default CategoryView;