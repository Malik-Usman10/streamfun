/**
 * Gallery Component
 * Displays media files in a responsive grid with thumbnails
 */

import appState from '../state.js';
import { formatBytes, formatDate, escapeHtml } from '../utils/format.js';
import { createElement } from '../utils/dom.js';

class Gallery {
  constructor(container) {
    this.container = container;
    this.elements = {
      loadingState: null,
      galleryGrid: null,
      emptyState: null
    };
    this.unsubscribe = null;
    this.intersectionObserver = null;
    
    this.init();
  }

  /**
   * Initialize gallery component
   */
  init() {
    this.cacheElements();
    this.setupLazyLoading();
    this.subscribeToState();
    this.render();
  }

  /**
   * Cache DOM elements
   */
  cacheElements() {
    this.elements.loadingState = document.getElementById('loading-state');
    this.elements.galleryGrid = document.getElementById('gallery-grid');
    this.elements.emptyState = document.getElementById('empty-state');
  }

  /**
   * Setup lazy loading for thumbnails
   */
  setupLazyLoading() {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            const src = img.dataset.src;
            
            if (src) {
              img.src = src;
              img.classList.add('loaded');
              img.classList.remove('loading');
              this.intersectionObserver.unobserve(img);
            }
          }
        });
      },
      {
        rootMargin: '50px'
      }
    );
  }

  /**
   * Subscribe to state changes
   */
  subscribeToState() {
    this.unsubscribe = appState.subscribe((newState, prevState) => {
      // Re-render when files or category changes
      if (newState.files !== prevState.files || 
          newState.currentCategory !== prevState.currentCategory ||
          newState.isLoading !== prevState.isLoading) {
        this.render();
      }
    });
  }

  /**
   * Render gallery
   */
  render() {
    const state = appState.getState();
    
    // Show loading state
    if (state.isLoading) {
      this.showLoading();
      return;
    }

    // Get filtered files
    const filteredFiles = appState.getFilteredFiles();

    // Show empty state if no files
    if (filteredFiles.length === 0) {
      this.showEmpty(state.currentCategory);
      return;
    }

    // Render gallery items
    this.renderGallery(filteredFiles);
  }

  /**
   * Show loading state
   */
  showLoading() {
    this.elements.loadingState.style.display = 'flex';
    this.elements.galleryGrid.style.display = 'none';
    this.elements.emptyState.style.display = 'none';
  }

  /**
   * Show empty state
   * @param {string} category - Current category
   */
  showEmpty(category) {
    this.elements.loadingState.style.display = 'none';
    this.elements.galleryGrid.style.display = 'none';
    this.elements.emptyState.style.display = 'flex';

    // Update empty state text
    const emptyTitle = document.getElementById('empty-title');
    const emptyDescription = document.getElementById('empty-description');
    
    if (emptyTitle && emptyDescription) {
      if (category === 'videos') {
        emptyTitle.textContent = 'No videos yet';
        emptyDescription.textContent = 'Upload your first video to get started';
      } else {
        emptyTitle.textContent = 'No images yet';
        emptyDescription.textContent = 'Upload your first image to get started';
      }
    }
  }

  /**
   * Render gallery grid
   * @param {Array} files - Array of file objects
   */
  renderGallery(files) {
    this.elements.loadingState.style.display = 'none';
    this.elements.galleryGrid.style.display = 'grid';
    this.elements.emptyState.style.display = 'none';

    // Clear existing items
    this.elements.galleryGrid.innerHTML = '';

    // Render each file
    files.forEach((file, index) => {
      const item = this.createGalleryItem(file, index);
      this.elements.galleryGrid.appendChild(item);
    });
  }

  /**
   * Create gallery item element
   * @param {Object} file - File object
   * @param {number} index - Item index for stagger animation
   * @returns {HTMLElement} Gallery item element
   */
  createGalleryItem(file, index) {
    const isVideo = file.mimeType?.startsWith('video/');
    const isImage = file.mimeType?.startsWith('image/');
    const hasThumbnail = file.thumbnail;

    // Create article element
    const article = createElement('article', {
      className: `gallery-item stagger-item`,
      dataset: { fileId: file.id },
      style: { animationDelay: `${Math.min(index * 0.05, 0.5)}s` }
    });

    // Thumbnail wrapper
    const thumbnailWrapper = createElement('div', { className: 'thumbnail-wrapper' });

    if (hasThumbnail) {
      // Create thumbnail image with lazy loading
      const thumbnail = createElement('img', {
        className: 'thumbnail loading',
        alt: `${escapeHtml(file.filename)} thumbnail`,
        dataset: { src: file.thumbnail }
      });

      // Observe for lazy loading
      this.intersectionObserver.observe(thumbnail);

      // Handle thumbnail load error
      thumbnail.addEventListener('error', () => {
        thumbnail.replaceWith(this.createThumbnailPlaceholder());
      });

      thumbnailWrapper.appendChild(thumbnail);
    } else {
      thumbnailWrapper.appendChild(this.createThumbnailPlaceholder());
    }

    // Thumbnail overlay with play button (for videos/images)
    if (isVideo || isImage) {
      const overlay = createElement('div', { className: 'thumbnail-overlay' });
      const playButton = createElement('button', {
        className: 'play-button',
        'aria-label': `Play ${file.filename}`,
        onClick: (e) => {
          e.stopPropagation();
          this.handlePlayClick(file);
        }
      });

      playButton.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      `;

      overlay.appendChild(playButton);
      thumbnailWrapper.appendChild(overlay);
    }

    // Make thumbnail wrapper clickable
    thumbnailWrapper.addEventListener('click', () => {
      if (isVideo || isImage) {
        this.handlePlayClick(file);
      }
    });

    article.appendChild(thumbnailWrapper);

    // Item info
    const itemInfo = createElement('div', { className: 'item-info' });
    
    const itemTitle = createElement('h3', {
      className: 'item-title',
      title: file.filename
    }, escapeHtml(file.filename));

    const itemMeta = createElement('p', { className: 'item-meta' });
    itemMeta.innerHTML = `
      <span class="item-date">${formatDate(file.uploadedAt)}</span>
      <span class="item-size">${formatBytes(file.size)}</span>
      ${file.encrypted ? '<span>🔒 Encrypted</span>' : ''}
    `;

    itemInfo.appendChild(itemTitle);
    itemInfo.appendChild(itemMeta);
    article.appendChild(itemInfo);

    // Item actions
    const itemActions = createElement('div', { className: 'item-actions' });

    const downloadBtn = createElement('button', {
      className: 'btn-icon',
      'aria-label': `Download ${file.filename}`,
      onClick: (e) => {
        e.stopPropagation();
        this.handleDownloadClick(file);
      }
    });
    downloadBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
    `;

    const deleteBtn = createElement('button', {
      className: 'btn-icon btn-danger',
      'aria-label': `Delete ${file.filename}`,
      onClick: (e) => {
        e.stopPropagation();
        this.handleDeleteClick(file);
      }
    });
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;

    itemActions.appendChild(downloadBtn);
    itemActions.appendChild(deleteBtn);
    article.appendChild(itemActions);

    return article;
  }

  /**
   * Create thumbnail placeholder
   * @returns {HTMLElement} Placeholder element
   */
  createThumbnailPlaceholder() {
    const placeholder = createElement('div', { className: 'thumbnail-placeholder' });
    placeholder.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <path d="M21 15l-5-5L5 21"></path>
      </svg>
    `;
    return placeholder;
  }

  /**
   * Handle play button click
   * @param {Object} file - File object
   */
  handlePlayClick(file) {
    // Dispatch custom event for media player
    window.dispatchEvent(new CustomEvent('media:play', {
      detail: { file }
    }));
  }

  /**
   * Handle download button click
   * @param {Object} file - File object
   */
  handleDownloadClick(file) {
    // Dispatch custom event for download
    window.dispatchEvent(new CustomEvent('file:download', {
      detail: { file }
    }));
  }

  /**
   * Handle delete button click
   * @param {Object} file - File object
   */
  handleDeleteClick(file) {
    // Dispatch custom event for delete
    window.dispatchEvent(new CustomEvent('file:delete', {
      detail: { file }
    }));
  }

  /**
   * Destroy component and cleanup
   */
  destroy() {
    // Unsubscribe from state changes
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    // Disconnect intersection observer
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    // Clear gallery
    if (this.elements.galleryGrid) {
      this.elements.galleryGrid.innerHTML = '';
    }
  }
}

export default Gallery;
