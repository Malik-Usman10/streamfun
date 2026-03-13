/**
 * GalleryView Component
 * Clean gallery view without sidebar (sidebar only in dashboard)
 * Version: 2.0 - Redesigned without sidebar
 */

import Gallery from './Gallery.js';

class GalleryView {
  constructor(container, category = 'videos') {
    this.container = container;
    this.category = category;
    this.gallery = null;
  }

  /**
   * Render the gallery view
   */
  render() {
    this.container.innerHTML = `
      <div class="gallery-view-container">
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
                <h1>${this.category === 'videos' ? 'Videos' : 'Images'}</h1>
                <span class="file-count" id="file-count">0 files</span>
              </div>
            </div>
            
            <div class="gallery-header-actions">
              <button class="header-action-btn" id="switch-category" aria-label="Switch to ${this.category === 'videos' ? 'images' : 'videos'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  ${this.category === 'videos' 
                    ? '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path>'
                    : '<path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>'
                  }
                </svg>
                <span>${this.category === 'videos' ? 'Images' : 'Videos'}</span>
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
        <main class="gallery-main">
          <!-- Loading State -->
          <div class="loading-state" id="loading-state" style="display: none;">
            <div class="spinner"></div>
            <p>Loading files...</p>
          </div>
          
          <!-- Gallery Grid -->
          <div class="gallery-grid" id="gallery-grid">
            <!-- Gallery items will be dynamically inserted here -->
          </div>
          
          <!-- Empty State -->
          <div class="empty-state" id="empty-state" style="display: none;">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            <h2 id="empty-title">No ${this.category} yet</h2>
            <p id="empty-description">Upload your first ${this.category === 'videos' ? 'video' : 'image'} to get started</p>
          </div>
        </main>
      </div>
    `;

    // Initialize gallery component
    const galleryContainer = this.container.querySelector('.gallery-main');
    this.gallery = new Gallery(galleryContainer);

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
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
        const targetCategory = this.category === 'videos' ? 'images' : 'videos';
        window.dispatchEvent(new CustomEvent(`navigate:${targetCategory}`));
      });
    }

    // Dashboard button
    const dashboardButton = this.container.querySelector('#dashboard-button');
    if (dashboardButton) {
      dashboardButton.addEventListener('click', () => {
        window.location.hash = 'dashboard';
      });
    }
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
}

export default GalleryView;
