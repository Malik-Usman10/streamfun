/**
 * MediaPlayer Component
 * Displays videos and images in a full-screen modal
 */

import { formatBytes, formatDate, escapeHtml } from '../utils/format.js';
import { trapFocus } from '../utils/dom.js';

class MediaPlayer {
  constructor(container) {
    this.container = container;
    this.elements = {
      closeButton: null,
      contentContainer: null,
      mediaHeader: null,
      mediaTitle: null,
      mediaMeta: null,
      prevButton: null,
      nextButton: null
    };
    this.currentFile = null;
    this.fileList = [];
    this.currentIndex = -1;
    this.focusTrap = null;
    this.isClosing = false;
    this.prefetchCache = new Map(); // Cache of prefetched Image objects by file ID

    this.init();
  }

  /**
   * Initialize media player component
   */
  init() {
    this.cacheElements();
    this.attachEventListeners();
  }

  /**
   * Cache DOM elements
   */
  cacheElements() {
    this.elements.closeButton = document.getElementById('media-player-close');
    this.elements.contentContainer = document.getElementById('media-player-content');
    this.elements.mediaHeader = document.getElementById('media-player-header');
    this.elements.mediaTitle = document.getElementById('media-title');
    this.elements.mediaMeta = document.getElementById('media-meta');
    this.elements.prevButton = document.getElementById('media-prev-btn');
    this.elements.nextButton = document.getElementById('media-next-btn');
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

      // Arrow keys for navigation (images only)
      if (this.container.classList.contains('active') && this.isImage()) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.showPrevious();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.showNext();
        }
      }
    });

    // Listen for media play events
    window.addEventListener('media:play', (e) => {
      const { file, fileList, index } = e.detail;
      this.play(file, fileList, index);
    });

    // Navigation button clicks
    if (this.elements.prevButton) {
      this.elements.prevButton.addEventListener('click', () => {
        this.showPrevious();
      });
    }

    if (this.elements.nextButton) {
      this.elements.nextButton.addEventListener('click', () => {
        this.showNext();
      });
    }
  }

  /**
   * Play media file
   * @param {Object} file - File object to play
   * @param {Array} fileList - List of all files in current view
   * @param {number} index - Current file index in the list
   */
  play(file, fileList = [], index = -1) {
    this.currentFile = file;
    this.fileList = fileList;
    this.currentIndex = index;

    const isVideo = file.mimeType?.startsWith('video/');
    const isImage = file.mimeType?.startsWith('image/');

    if (!isVideo && !isImage) {
      console.warn('File is not a video or image:', file);
      return;
    }

    // Clear previous content
    this.elements.contentContainer.innerHTML = '';

    // Create media element
    if (isVideo) {
      this.createVideoPlayer(file);
    } else if (isImage) {
      this.createImageViewer(file);
    }

    // Update media info
    this.updateMediaInfo(file);

    // Update navigation buttons visibility
    this.updateNavigationButtons();

    // Open modal
    this.open();
  }

  /**
   * Create video player with custom controls
   * @param {Object} file - File object
   */
  createVideoPlayer(file) {
    // Create video element
    const video = document.createElement('video');
    video.className = 'media-video';
    video.preload = 'none'; // Prevent browser from pre-fetching data automatically
    video.id = 'custom-video-player';

    const source = document.createElement('source');
    source.src = `/api/files/${file.id}/play`;
    source.type = file.mimeType || 'video/mp4';

    video.appendChild(source);
    
    // Fallback for some browsers
    video.src = `/api/files/${file.id}/play`;
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'custom-video-controls';
    controlsContainer.innerHTML = `
      <!-- Loading Spinner -->
      <div class="video-loading-spinner" id="video-loading" style="display: none;">
        <div class="spinner"></div>
        <p>Loading...</p>
      </div>
      
      <!-- Play/Pause Overlay -->
      <div class="video-play-overlay" id="play-overlay">
        <button class="video-play-btn-large" id="play-btn-large" aria-label="Play">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </button>
      </div>
      
      <!-- Bottom Controls -->
      <div class="video-controls-bar" id="controls-bar">
        <!-- Progress Bar -->
        <div class="video-progress-container" id="progress-container">
          <div class="video-progress-bar" id="progress-bar">
            <div class="video-progress-filled" id="progress-filled"></div>
            <div class="video-progress-buffered" id="progress-buffered"></div>
            <div class="video-progress-handle" id="progress-handle"></div>
          </div>
          <div class="video-progress-tooltip" id="progress-tooltip">0:00</div>
        </div>
        
        <!-- Control Buttons -->
        <div class="video-controls-bottom">
          <div class="video-controls-left">
            <button class="video-control-btn" id="play-pause-btn" aria-label="Play/Pause">
              <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
              <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
              </svg>
            </button>
            
            <button class="video-control-btn" id="rewind-btn" aria-label="Rewind 15 seconds" title="Rewind 15s">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              <span class="skip-label">15</span>
            </button>
            
            <button class="video-control-btn" id="forward-btn" aria-label="Forward 15 seconds" title="Forward 15s">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
              </svg>
              <span class="skip-label">15</span>
            </button>
            
            <div class="video-time-display">
              <span id="current-time">0:00</span>
              <span> / </span>
              <span id="duration-time">0:00</span>
            </div>
          </div>
          
          <div class="video-controls-right">
            <button class="video-control-btn speed-btn" id="speed-btn" aria-label="Playback speed" title="Playback speed">
              <span class="speed-label">1x</span>
            </button>
            
            <button class="video-control-btn" id="volume-btn" aria-label="Mute/Unmute">
              <svg class="volume-high-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
              <svg class="volume-muted-icon" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
            </button>
            
            <button class="video-control-btn" id="fullscreen-btn" aria-label="Fullscreen">
              <svg class="fullscreen-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
              </svg>
              <svg class="fullscreen-exit-icon" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    // Append elements
    this.elements.contentContainer.appendChild(video);
    this.elements.contentContainer.appendChild(controlsContainer);

    // Initialize custom controls
    this.initializeVideoControls(video);

    // Show the play overlay by default since we disabled auto-play
    const playOverlay = document.getElementById('play-overlay');
    if (playOverlay) {
      playOverlay.style.display = 'flex';
    }
  }

  /**
   * Initialize video controls
   * @param {HTMLVideoElement} video - Video element
   */
  initializeVideoControls(video) {
    const playOverlay = document.getElementById('play-overlay');
    const playBtnLarge = document.getElementById('play-btn-large');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const rewindBtn = document.getElementById('rewind-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const volumeBtn = document.getElementById('volume-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressFilled = document.getElementById('progress-filled');
    const progressBuffered = document.getElementById('progress-buffered');
    const progressHandle = document.getElementById('progress-handle');
    const progressTooltip = document.getElementById('progress-tooltip');
    const currentTimeEl = document.getElementById('current-time');
    const durationTimeEl = document.getElementById('duration-time');
    const loadingSpinner = document.getElementById('video-loading');
    const controlsBar = document.getElementById('controls-bar');

    let controlsTimeout;

    // Format time helper
    const formatTime = (seconds) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Play/Pause
    const togglePlay = () => {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    };

    playBtnLarge.addEventListener('click', togglePlay);
    playPauseBtn.addEventListener('click', togglePlay);
    video.addEventListener('click', togglePlay);

    video.addEventListener('play', () => {
      playOverlay.style.display = 'none';
      playPauseBtn.querySelector('.play-icon').style.display = 'none';
      playPauseBtn.querySelector('.pause-icon').style.display = 'block';
    });

    video.addEventListener('pause', () => {
      playOverlay.style.display = 'flex';
      playPauseBtn.querySelector('.play-icon').style.display = 'block';
      playPauseBtn.querySelector('.pause-icon').style.display = 'none';
    });

    // Rewind 15s
    rewindBtn.addEventListener('click', () => {
      video.currentTime = Math.max(0, video.currentTime - 15);
      this.showSkipFeedback('rewind');
    });

    // Forward 15s
    forwardBtn.addEventListener('click', () => {
      video.currentTime = Math.min(video.duration, video.currentTime + 15);
      this.showSkipFeedback('forward');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 5);
          break;
        case 'j':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'l':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
          break;
        case 'm':
          e.preventDefault();
          video.muted = !video.muted;
          break;
        case 'f':
          e.preventDefault();
          this.toggleFullscreen();
          break;
      }
    });

    // Volume
    volumeBtn.addEventListener('click', () => {
      video.muted = !video.muted;
    });

    video.addEventListener('volumechange', () => {
      if (video.muted || video.volume === 0) {
        volumeBtn.querySelector('.volume-high-icon').style.display = 'none';
        volumeBtn.querySelector('.volume-muted-icon').style.display = 'block';
      } else {
        volumeBtn.querySelector('.volume-high-icon').style.display = 'block';
        volumeBtn.querySelector('.volume-muted-icon').style.display = 'none';
      }
    });

    // Fullscreen
    fullscreenBtn.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        fullscreenBtn.querySelector('.fullscreen-icon').style.display = 'none';
        fullscreenBtn.querySelector('.fullscreen-exit-icon').style.display = 'block';
      } else {
        fullscreenBtn.querySelector('.fullscreen-icon').style.display = 'block';
        fullscreenBtn.querySelector('.fullscreen-exit-icon').style.display = 'none';
      }
    });

    // Speed control
    const speedBtn = document.getElementById('speed-btn');
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    let currentSpeedIndex = 2; // default 1x

    if (speedBtn) {
      speedBtn.addEventListener('click', () => {
        currentSpeedIndex = (currentSpeedIndex + 1) % speeds.length;
        const newSpeed = speeds[currentSpeedIndex];
        video.playbackRate = newSpeed;
        speedBtn.querySelector('.speed-label').textContent = `${newSpeed}x`;
      });
    }

    // Progress bar
    video.addEventListener('timeupdate', () => {
      const percent = (video.currentTime / video.duration) * 100;
      progressFilled.style.width = `${percent}%`;
      progressHandle.style.left = `${percent}%`;
      currentTimeEl.textContent = formatTime(video.currentTime);
    });

    video.addEventListener('loadedmetadata', () => {
      durationTimeEl.textContent = formatTime(video.duration);
    });

    video.addEventListener('progress', () => {
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const percent = (bufferedEnd / video.duration) * 100;
        progressBuffered.style.width = `${percent}%`;
      }
    });

    // Progress bar seeking
    const seek = (e) => {
      const rect = progressBar.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      video.currentTime = percent * video.duration;
    };

    let isSeeking = false;
    progressContainer.addEventListener('mousedown', (e) => {
      isSeeking = true;
      seek(e);
    });

    document.addEventListener('mousemove', (e) => {
      if (isSeeking) {
        seek(e);
      }

      // Show tooltip on hover
      if (e.target.closest('#progress-container')) {
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const time = percent * video.duration;
        progressTooltip.textContent = formatTime(time);
        progressTooltip.style.left = `${e.clientX - rect.left}px`;
        progressTooltip.style.display = 'block';
      } else {
        progressTooltip.style.display = 'none';
      }
    });

    document.addEventListener('mouseup', () => {
      isSeeking = false;
    });

    // Loading indicator
    video.addEventListener('waiting', () => {
      loadingSpinner.style.display = 'flex';
    });

    video.addEventListener('canplay', () => {
      loadingSpinner.style.display = 'none';
    });

    video.addEventListener('playing', () => {
      loadingSpinner.style.display = 'none';
    });

    // Auto-hide controls and header
    const showControls = () => {
      controlsBar.classList.add('visible');
      if (this.elements.mediaHeader) {
        this.elements.mediaHeader.classList.add('visible');
      }
      clearTimeout(controlsTimeout);

      if (!video.paused) {
        controlsTimeout = setTimeout(() => {
          controlsBar.classList.remove('visible');
          if (this.elements.mediaHeader) {
            this.elements.mediaHeader.classList.remove('visible');
          }
        }, 3000);
      }
    };

    this.elements.contentContainer.addEventListener('mousemove', showControls);
    this.elements.contentContainer.addEventListener('mouseenter', showControls);

    video.addEventListener('play', () => {
      controlsTimeout = setTimeout(() => {
        controlsBar.classList.remove('visible');
        if (this.elements.mediaHeader) {
          this.elements.mediaHeader.classList.remove('visible');
        }
      }, 3000);
    });

    video.addEventListener('pause', () => {
      clearTimeout(controlsTimeout);
      controlsBar.classList.add('visible');
      if (this.elements.mediaHeader) {
        this.elements.mediaHeader.classList.add('visible');
      }
    });

    // Show controls initially
    controlsBar.classList.add('visible');
    if (this.elements.mediaHeader) {
      this.elements.mediaHeader.classList.add('visible');
    }

    // Error handling
    video.addEventListener('error', (e) => {
      const error = video.error;
      let errorMsg = 'Failed to load video';
      
      if (error) {
        switch (error.code) {
          case 1: errorMsg = 'Playback aborted by user'; break;
          case 2: errorMsg = 'Network error during playback'; break;
          case 3: errorMsg = 'Video decoding failed (possibly unsupported codec)'; break;
          case 4: errorMsg = 'Video format or MIME type not supported'; break;
        }
        console.error('Video error:', error.code, error.message, errorMsg);
      }
      
      loadingSpinner.style.display = 'none';
      if (!this.isClosing) {
        this.showError(`${errorMsg}. Please try another file or browser.`);
      }
    });
  }

  /**
   * Show skip feedback animation
   * @param {string} direction - 'forward' or 'rewind'
   */
  showSkipFeedback(direction) {
    const feedback = document.createElement('div');
    feedback.className = `skip-feedback skip-${direction}`;
    feedback.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor">
        ${direction === 'forward' ?
        '<path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>' :
        '<path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>'
      }
      </svg>
      <span>15s</span>
    `;

    this.elements.contentContainer.appendChild(feedback);

    setTimeout(() => {
      feedback.remove();
    }, 500);
  }

  /**
   * Toggle fullscreen
   */
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.container.requestFullscreen().catch(err => {
        console.error('Fullscreen error:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  /**
   * Create image viewer
   * @param {Object} file - File object
   */
  createImageViewer(file) {
    const container = document.createElement('div');
    container.className = 'image-viewer-container';

    // 1. Background Thumbnail Layer (Immediate)
    const thumbnailImg = document.createElement('img');
    thumbnailImg.className = 'media-image thumbnail-placeholder';
    thumbnailImg.alt = `${escapeHtml(file.filename)} (loading)`;
    thumbnailImg.src = file.thumbnail || '';

    // 2. Full Resolution Layer
    const fullImg = document.createElement('img');
    fullImg.className = 'media-image full-res-image';
    fullImg.alt = escapeHtml(file.filename);

    const imageUrl = `/api/files/${file.id}/play`;
    const prefetchedImg = this.prefetchCache.get(file.id);

    // Helper to reveal the full image and remove the blurry thumbnail
    const revealFullImage = () => {
      fullImg.style.opacity = '1';
      thumbnailImg.style.opacity = '0';
      setTimeout(() => { try { thumbnailImg.remove(); } catch {} }, 500);
    };

    if (prefetchedImg && prefetchedImg.complete && prefetchedImg.naturalWidth > 0) {
      // Case A: Prefetch finished — browser cache hit, show instantly
      fullImg.src = imageUrl;
      fullImg.style.opacity = '1';
      thumbnailImg.style.opacity = '0';
      setTimeout(() => { try { thumbnailImg.remove(); } catch {} }, 100);
    } else if (prefetchedImg && !prefetchedImg.complete) {
      // Case B: Prefetch is IN PROGRESS — don't create a duplicate request!
      // Listen on the prefetched Image object, then assign src to get browser cache hit
      prefetchedImg.addEventListener('load', () => {
        fullImg.src = imageUrl; // Browser serves from its HTTP cache
        revealFullImage();
      });
      prefetchedImg.addEventListener('error', () => {
        // Prefetch failed — fall back to a direct request
        fullImg.src = imageUrl;
      });
    } else {
      // Case C: Not prefetched at all — load fresh
      fullImg.src = imageUrl;
    }

    // For cases B and C, also listen on fullImg's own load event
    fullImg.addEventListener('load', revealFullImage);

    // Cancel stale prefetches and start fresh ones for the new position
    this.cancelStalePrefetches();
    this.prefetchAdjacentImages();

    // Handle image errors
    fullImg.addEventListener('error', () => {
      console.error('Image load error');
      thumbnailImg.style.filter = 'grayscale(1) blur(5px)';
      this.showError('Failed to load full resolution image. Please try again.');
    });

    // Add zoom functionality to the full image
    let isZoomed = false;
    fullImg.addEventListener('dblclick', (e) => {
      e.preventDefault();
      isZoomed = !isZoomed;
      fullImg.classList.toggle('zoomed', isZoomed);
    });

    container.appendChild(thumbnailImg);
    container.appendChild(fullImg);
    this.elements.contentContainer.appendChild(container);

    // Add bottom info bar for images
    const counterText = this.fileList.length > 1
      ? `${this.currentIndex + 1} / ${this.fileList.length}`
      : '';

    const infoBar = document.createElement('div');
    infoBar.className = 'image-info-bar';
    infoBar.innerHTML = `
      ${counterText ? `<div class="image-info-counter">${counterText}</div>` : ''}
    `;
    this.elements.contentContainer.appendChild(infoBar);

    // Auto-hide header and info bar for images (same as video)
    let imageControlsTimeout;
    const showImageControls = () => {
      if (this.elements.mediaHeader) {
        this.elements.mediaHeader.classList.add('visible');
      }
      infoBar.classList.add('visible');
      clearTimeout(imageControlsTimeout);
      imageControlsTimeout = setTimeout(() => {
        if (this.elements.mediaHeader) {
          this.elements.mediaHeader.classList.remove('visible');
        }
        infoBar.classList.remove('visible');
      }, 3000);
    };

    this.elements.contentContainer.addEventListener('mousemove', showImageControls);
    this.elements.contentContainer.addEventListener('mouseenter', showImageControls);

    // Show initially
    showImageControls();
  }

  /**
   * Update media info display
   * @param {Object} file - File object
   */
  updateMediaInfo(file) {
    if (this.elements.mediaTitle) {
      this.elements.mediaTitle.textContent = file.filename;
    }

    if (this.elements.mediaMeta) {
      const parts = [
        formatBytes(file.size),
        `Uploaded ${formatDate(file.uploadedAt)}`,
        file.encrypted ? '🔒 Encrypted' : ''
      ].filter(Boolean);

      this.elements.mediaMeta.textContent = parts.join(' • ');
    }

    // Show the header
    if (this.elements.mediaHeader) {
      this.elements.mediaHeader.style.display = 'flex';
    }
  }

  /**
   * Show error message
   * @param {string} message - Error message
   */
  showError(message) {
    this.elements.contentContainer.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px;
        color: white;
        text-align: center;
      ">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 16px; opacity: 0.5;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p style="font-size: 18px; margin-bottom: 8px;">Playback Error</p>
        <p style="font-size: 14px; opacity: 0.7;">${escapeHtml(message)}</p>
      </div>
    `;
  }

  /**
   * Open media player modal
   */
  open() {
    this.isClosing = false;
    this.container.classList.add('active');
    this.container.classList.add('opening');
    document.body.style.overflow = 'hidden';

    // Set up focus trap
    this.focusTrap = trapFocus(this.container);

    // Remove opening class after animation
    setTimeout(() => {
      this.container.classList.remove('opening');
    }, 300);
  }

  /**
   * Close media player modal
   */
  close() {
    this.isClosing = true;
    this.container.classList.add('closing');

    // Stop video playback if playing
    const video = this.elements.contentContainer.querySelector('video');
    if (video) {
      video.pause();
      video.src = '';
    }

    // Remove focus trap
    if (this.focusTrap) {
      this.focusTrap();
      this.focusTrap = null;
    }

    setTimeout(() => {
      this.container.classList.remove('active');
      this.container.classList.remove('closing');
      document.body.style.overflow = '';

      // Clear content
      this.elements.contentContainer.innerHTML = '';
      if (this.elements.mediaHeader) {
        this.elements.mediaHeader.style.display = 'none';
      }

      this.currentFile = null;
    }, 200);
  }

  /**
   * Check if media player is open
   * @returns {boolean}
   */
  isOpen() {
    return this.container.classList.contains('active');
  }

  /**
   * Check if current file is an image
   * @returns {boolean}
   */
  isImage() {
    return this.currentFile?.mimeType?.startsWith('image/');
  }

  /**
   * Show previous file in the list
   */
  showPrevious() {
    if (this.currentIndex > 0 && this.fileList.length > 0) {
      const prevFile = this.fileList[this.currentIndex - 1];
      this.play(prevFile, this.fileList, this.currentIndex - 1);
    }
  }

  /**
   * Show next file in the list
   */
  showNext() {
    if (this.currentIndex < this.fileList.length - 1 && this.fileList.length > 0) {
      const nextFile = this.fileList[this.currentIndex + 1];
      this.play(nextFile, this.fileList, this.currentIndex + 1);
    }
  }

  /**
   * Update navigation buttons visibility and state
   */
  updateNavigationButtons() {
    const showNav = this.isImage() && this.fileList.length > 1;

    if (this.elements.prevButton) {
      this.elements.prevButton.style.display = showNav ? 'flex' : 'none';
      this.elements.prevButton.disabled = this.currentIndex <= 0;
    }

    if (this.elements.nextButton) {
      this.elements.nextButton.style.display = showNav ? 'flex' : 'none';
      this.elements.nextButton.disabled = this.currentIndex >= this.fileList.length - 1;
    }
  }

  /**
   * Get current file
   * @returns {Object|null}
   */
  getCurrentFile() {
    return this.currentFile;
  }

  /**
   * Destroy component and cleanup
   */
  destroy() {
    // Close if open
    if (this.isOpen()) {
      this.close();
    }

    // Remove event listeners by cloning elements
    if (this.elements.closeButton) {
      this.elements.closeButton.replaceWith(this.elements.closeButton.cloneNode(true));
    }

    this.container.replaceWith(this.container.cloneNode(true));
  }
  /**
   * Cancel prefetch requests for images that are no longer near the current view.
   * This frees up backend download slots for the image the user is actually looking at.
   */
  cancelStalePrefetches() {
    // Build a set of file IDs that are still relevant (current ±4)
    const relevantIds = new Set();
    for (let i = Math.max(0, this.currentIndex - 1); i <= Math.min(this.fileList.length - 1, this.currentIndex + 4); i++) {
      const f = this.fileList[i];
      if (f) relevantIds.add(f.id);
    }

    // Cancel any prefetch that is outside the relevant window and still loading
    for (const [fileId, img] of this.prefetchCache) {
      if (!relevantIds.has(fileId) && !img.complete) {
        img.src = ''; // Abort the HTTP request
        this.prefetchCache.delete(fileId);
      }
    }
  }

  /**
   * Prefetch the next 3 adjacent images for instant navigation.
   * Current image is included so it ends up in the browser cache for later.
   */
  prefetchAdjacentImages() {
    if (this.fileList.length <= 1) return;

    // Order: current first (highest priority), then next 3, then previous 1
    const indicesToPrefetch = [this.currentIndex];
    for (let i = 1; i <= 3; i++) {
      if (this.currentIndex + i < this.fileList.length) {
        indicesToPrefetch.push(this.currentIndex + i);
      }
    }
    if (this.currentIndex - 1 >= 0) {
      indicesToPrefetch.push(this.currentIndex - 1);
    }

    for (const idx of indicesToPrefetch) {
      const file = this.fileList[idx];
      if (!file || !file.mimeType?.startsWith('image/')) continue;
      if (this.prefetchCache.has(file.id)) continue;

      const img = new Image();
      img.src = `/api/files/${file.id}/play`;
      this.prefetchCache.set(file.id, img);
    }
  }
}

export default MediaPlayer;
