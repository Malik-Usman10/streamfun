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
    this.infiniteScrollObserver = null;
    this.renderedFileIds = new Set();
    
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
    this.elements.loadingState = this.container.querySelector('.loading-state');
    this.elements.galleryGrid = this.container.querySelector('.gallery-grid');
    this.elements.emptyState = this.container.querySelector('.empty-state');
    
    // Create sentinel for infinite scroll
    this.elements.sentinel = createElement('div', { 
      className: 'scroll-sentinel',
      style: { height: '20px', width: '100%', gridColumn: '1 / -1' }
    });
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

    this.infiniteScrollObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          const state = appState.getState();
          if (state.pagination.hasMore && !state.isLoadingMore) {
            window.dispatchEvent(new CustomEvent('gallery:load-more'));
          }
        }
      },
      { rootMargin: '400px' }
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
    const emptyTitle = this.elements.emptyState.querySelector('h2');
    const emptyDescription = this.elements.emptyState.querySelector('p');

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

    // If we're not loading more, and files length is smaller than our rendered set, it's a fresh load/delete
    const state = appState.getState();
    const isPaginationAppend = state.isLoadingMore || (files.length > this.renderedFileIds.size && state.pagination.page > 1);

    if (!isPaginationAppend) {
      this.elements.galleryGrid.innerHTML = '';
      this.renderedFileIds.clear();
      if (this.elements.sentinel) {
        this.infiniteScrollObserver.unobserve(this.elements.sentinel);
      }
    } else {
      // Remove sentinel temporarily so we can append items before it
      if (this.elements.sentinel.parentNode === this.elements.galleryGrid) {
        this.elements.galleryGrid.removeChild(this.elements.sentinel);
      }
    }

    // Render each missing file
    files.forEach((file, index) => {
      // If we are clearing everything, we rebuild the whole grid
      // But we prevent adding duplicate elements
      if (!this.renderedFileIds.has(file.id)) {
        const item = this.createGalleryItem(file, index);
        this.elements.galleryGrid.appendChild(item);
        this.renderedFileIds.add(file.id);
      }
    });

    // Append and observe sentinel
    this.elements.galleryGrid.appendChild(this.elements.sentinel);
    if (state.pagination.hasMore || state.isLoadingMore) {
      if (!this.elements.sentinel.querySelector('.spinner')) {
        this.elements.sentinel.innerHTML = '<div class="spinner" style="width: 20px; height: 20px; margin: 0 auto;"></div>';
      }
      this.infiniteScrollObserver.observe(this.elements.sentinel);
    } else {
      this.elements.sentinel.innerHTML = '';
      this.infiniteScrollObserver.unobserve(this.elements.sentinel);
    }
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

    // Thumbnail overlay with appropriate icon
    if (isVideo) {
      const overlay = createElement('div', { className: 'thumbnail-overlay video-overlay' });
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
    } else if (isImage) {
      // Remove overlay icon for images as per user request (cleaner UX)
      const overlay = createElement('div', { className: 'thumbnail-overlay image-overlay' });
      thumbnailWrapper.appendChild(overlay);
    }

    if (isVideo) {
      // Add a small "Video" badge
      const badge = createElement('div', { 
        className: 'video-badge',
        style: {
          position: 'absolute',
          top: '10px',
          left: '10px',
          background: 'rgba(0,0,0,0.7)',
          padding: '4px 8px',
          borderRadius: '4px',
          color: 'white',
          fontSize: '12px',
          fontWeight: 'bold',
          zIndex: '5'
        }
      }, 'VIDEO');
      thumbnailWrapper.appendChild(badge);
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

    const renameBtn = createElement('button', {
      className: 'btn-icon',
      'aria-label': `Rename ${file.filename}`,
      title: 'Rename',
      onClick: (e) => {
        e.stopPropagation();
        this.handleRenameClick(file);
      }
    });
    renameBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    `;

    const deleteBtn = createElement('button', {
      className: 'btn-icon btn-danger',
      'aria-label': `Delete ${file.filename}`,
      title: 'Delete',
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

    const refreshThumbBtn = createElement('button', {
      className: 'btn-icon',
      'aria-label': `Refresh thumbnail for ${file.filename}`,
      title: 'Refresh Thumbnail',
      onClick: (e) => {
        e.stopPropagation();
        this.handleRefreshThumbnailClick(file, article);
      }
    });
    refreshThumbBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 4v6h-6"></path>
        <path d="M1 20v-6h6"></path>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    `;

    itemActions.appendChild(refreshThumbBtn);
    itemActions.appendChild(downloadBtn);
    itemActions.appendChild(renameBtn);
    itemActions.appendChild(deleteBtn);
    article.appendChild(itemActions);

    return article;
  }

  /**
   * Handle rename click
   * @param {Object} file - File object
   */
  async handleRenameClick(file) {
    const newName = prompt('Enter new filename:', file.filename);
    if (!newName || newName === file.filename) return;

    try {
      const response = await fetch(`/api/files/${file.id}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: newName })
      });

      if (!response.ok) throw new Error('Failed to rename file');
      
      const data = await response.json();
      if (data.success) {
        // Update local state or trigger refresh
        window.showNotification('File renamed successfully', 'success');
        this.render(); // Re-render to show new name
      }
    } catch (error) {
      console.error('Rename error:', error);
      window.showNotification(error.message, 'error');
    }
  }

  /**
   * Handle refresh thumbnail click
   * @param {Object} file - File object
   * @param {HTMLElement} article - The gallery item element
   */
  async handleRefreshThumbnailClick(file, article) {
    try {
      window.showNotification('Regenerating thumbnail...', 'info');
      
      // Import API dynamically
      const { default: api } = await import('../api.js');
      const result = await api.regenerateThumbnail(file.id);
      
      if (result.success && result.thumbnail) {
        const img = article.querySelector('.thumbnail');
        if (img) {
          img.src = result.thumbnail;
          img.dataset.src = result.thumbnail;
          img.classList.add('loaded');
          img.classList.remove('loading');
        } else {
          // If it was a placeholder, replace it
          const wrapper = article.querySelector('.thumbnail-wrapper');
          const placeholder = wrapper.querySelector('.thumbnail-placeholder');
          if (placeholder) {
            const newImg = createElement('img', {
              className: 'thumbnail loaded',
              alt: `${escapeHtml(file.filename)} thumbnail`,
              src: result.thumbnail
            });
            placeholder.replaceWith(newImg);
          }
        }
        window.showNotification('Thumbnail updated', 'success');
      }
    } catch (error) {
      console.error('Refresh thumbnail error:', error);
      window.showNotification(error.message, 'error');
    }
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
    // Get current file list from state
    const state = appState.getState();
    const fileList = appState.getFilteredFiles();
    const index = fileList.findIndex(f => f.id === file.id);

    // Dispatch custom event for media player with file list
    window.dispatchEvent(new CustomEvent('media:play', {
      detail: {
        file,
        fileList,
        index
      }
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
    
    if (this.infiniteScrollObserver) {
      this.infiniteScrollObserver.disconnect();
    }

    // Clear gallery
    if (this.elements.galleryGrid) {
      this.elements.galleryGrid.innerHTML = '';
      this.renderedFileIds.clear();
    }
  }
}

export default Gallery;
