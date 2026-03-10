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
      mediaInfo: null,
      mediaTitle: null,
      mediaMeta: null
    };
    this.currentFile = null;
    this.focusTrap = null;
    
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
    this.elements.mediaInfo = document.getElementById('media-info');
    this.elements.mediaTitle = document.getElementById('media-title');
    this.elements.mediaMeta = document.getElementById('media-meta');
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

    // Listen for media play events
    window.addEventListener('media:play', (e) => {
      const { file } = e.detail;
      this.play(file);
    });
  }

  /**
   * Play media file
   * @param {Object} file - File object to play
   */
  play(file) {
    this.currentFile = file;
    
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
    video.preload = 'metadata';
    video.id = 'custom-video-player';

    const source = document.createElement('source');
    source.src = `http://localhost:3000/api/files/${file.id}/play`;
    source.type = file.mimeType || 'video/mp4';

    video.appendChild(source);

    // Create custom controls container
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

    // Auto-play
    video.play().catch(err => {
      console.log('Autoplay prevented:', err);
    });
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
      
      switch(e.key) {
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

    // Auto-hide controls
    const showControls = () => {
      controlsBar.classList.add('visible');
      clearTimeout(controlsTimeout);
      
      if (!video.paused) {
        controlsTimeout = setTimeout(() => {
          controlsBar.classList.remove('visible');
        }, 3000);
      }
    };

    this.elements.contentContainer.addEventListener('mousemove', showControls);
    this.elements.contentContainer.addEventListener('mouseenter', showControls);
    
    video.addEventListener('play', () => {
      controlsTimeout = setTimeout(() => {
        controlsBar.classList.remove('visible');
      }, 3000);
    });

    video.addEventListener('pause', () => {
      clearTimeout(controlsTimeout);
      controlsBar.classList.add('visible');
    });

    // Show controls initially
    controlsBar.classList.add('visible');

    // Error handling
    video.addEventListener('error', (e) => {
      console.error('Video playback error:', e);
      loadingSpinner.style.display = 'none';
      this.showError('Failed to load video. Please try again.');
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
    const img = document.createElement('img');
    img.className = 'media-image';
    img.alt = escapeHtml(file.filename);
    img.src = `http://localhost:3000/api/files/${file.id}/play`;

    // Add error handling
    img.addEventListener('error', () => {
      console.error('Image load error');
      this.showError('Failed to load image. Please try again.');
    });

    // Add loading indicator
    img.style.opacity = '0';
    img.addEventListener('load', () => {
      img.style.transition = 'opacity 0.3s';
      img.style.opacity = '1';
    });

    this.elements.contentContainer.appendChild(img);
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

    if (this.elements.mediaInfo) {
      this.elements.mediaInfo.style.display = 'block';
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
      if (this.elements.mediaInfo) {
        this.elements.mediaInfo.style.display = 'none';
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
}

export default MediaPlayer;
