/**
 * HomePage Component
 * Simplified home page with two main navigation cards
 */

import api from '../api.js';
import { createElement, escapeHtml } from '../utils/dom.js';

class HomePage {
  constructor() {
    this.container = null;
    this.onNavigate = null;
  }

  /**
   * Render the home page
   * @param {HTMLElement} container - Container element
   * @param {Function} onNavigate - Navigation callback
   */
  render(container, onNavigate) {
    this.container = container;
    this.onNavigate = onNavigate;

    this.container.innerHTML = `
      <div class="home-container">
        <header class="home-header" style="background: rgba(10, 10, 10, 0.8); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-lg) 5%; position: sticky; top: 0; z-index: 100; backdrop-filter: blur(12px);">
          <div class="home-logo" style="font-size: 28px; font-weight: 800; color: var(--color-primary); letter-spacing: -1px; text-transform: uppercase; display: flex; align-items: center;">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width: 32px; height: 32px; margin-right: 12px;">
              <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z"/>
            </svg>
            StreamFun
          </div>
          <div class="home-user-menu">
            <button class="user-menu-button" id="dashboard-btn" style="background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-full); padding: 8px 24px; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 8px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
              <span>Dashboard</span>
            </button>
          </div>
        </header>
        
        <style>
          .hero-section {
            min-height: 70vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: flex-start;
            margin: 0 0 80px 0;
            padding: 60px 0;
            gap: 48px;
          }
          .hero-title {
            font-size: 5rem;
            font-weight: 900;
            margin: 0;
            letter-spacing: -3px;
            background: linear-gradient(to right, #fbbf24, #f59e0b, #ea580c);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
            line-height: 1.1;
          }
          .search-bar-container {
            position: relative; 
            max-width: 800px; 
            width: 100%;
            filter: drop-shadow(0 25px 45px rgba(0,0,0,0.5));
          }
          @media (max-width: 768px) {
            .hero-title { font-size: 3.5rem; }
            .hero-section { min-height: 50vh; gap: 32px; }
          }
        </style>
 
        <main class="home-main" style="padding: 0 5%; width: 100%; box-sizing: border-box;">
          <!-- Hero Search Section -->
          <section class="hero-section">
            <h1 class="hero-title">Good Evening.</h1>
            <div class="search-bar-container">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="position: absolute; left: 24px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; color: var(--color-primary); z-index: 10;">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input type="text" id="hero-search-input" placeholder="Search for movies, shows, or memories..." style="width: 100%; padding: 24px 32px 24px 72px; border-radius: 50px; background: rgba(25,25,25,0.95); border: 1px solid var(--border-color); color: white; font-size: 1.3rem; outline: none; transition: all 0.3s; backdrop-filter: blur(25px);">
            </div>
            
            <div class="quick-nav" style="display: flex; gap: 20px;">
              <button id="videos-pill" class="pill-btn active" style="background: var(--color-primary); color: #000; padding: 14px 32px; border-radius: 40px; font-weight: 700; border: none; cursor: pointer; display: flex; align-items: center; gap: 12px; box-shadow: 0 8px 25px rgba(251, 191, 36, 0.4); transition: all 0.3s transform;">
                <svg viewBox="0 0 24 24" fill="currentColor" style="width: 22px; height: 22px;"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg> 
                <span>Movies & TV</span>
              </button>
              <button id="images-pill" class="pill-btn" style="background: var(--bg-tertiary); color: var(--text-primary); padding: 14px 32px; border-radius: 40px; font-weight: 600; border: 1px solid var(--border-color); cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s;">
                <svg viewBox="0 0 24 24" fill="currentColor" style="width: 22px; height: 22px;"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg> 
                <span>Photos</span>
              </button>
            </div>
          </section>

          <!-- Media Sliders -->
          <section class="slider-section" style="margin-bottom: 40px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px;">
              <h2 style="font-size: 1.5rem; font-weight: 600; color: var(--text-primary);">Recently Added Videos</h2>
              <a href="#" id="view-all-videos" style="color: var(--color-primary); text-decoration: none; font-weight: 600; font-size: 0.9rem;">View All →</a>
            </div>
            <div id="recent-videos-slider" class="media-slider" style="display: flex; gap: 16px; overflow-x: auto; padding-bottom: 16px; scroll-snap-type: x mandatory; scrollbar-width: none; -ms-overflow-style: none;">
              <!-- Cards injected here via JS -->
              <div class="loading-spinner" style="margin: 40px auto; width: 30px; height: 30px;"></div>
            </div>
          </section>

          <section class="slider-section" style="margin-bottom: 60px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px;">
              <h2 style="font-size: 1.5rem; font-weight: 600; color: var(--text-primary);">Recently Added Photos</h2>
              <a href="#" id="view-all-images" style="color: var(--color-primary); text-decoration: none; font-weight: 600; font-size: 0.9rem;">View All →</a>
            </div>
            <div id="recent-images-slider" class="media-slider" style="display: flex; gap: 16px; overflow-x: auto; padding-bottom: 16px; scroll-snap-type: x mandatory; scrollbar-width: none; -ms-overflow-style: none;">
              <!-- Cards injected here via JS -->
              <div class="loading-spinner" style="margin: 40px auto; width: 30px; height: 30px;"></div>
            </div>
          </section>

        </main>
      </div>
    `;

    // Load dynamic data
    this.loadRecentMedia();

    this.attachEventListeners();
  }

  /**
   * Fetch and render recent media items for sliders
   */
  async loadRecentMedia() {
    try {
      // Fetch recent videos & images in parallel
      const [videosData, imagesData] = await Promise.all([
        api.fetchFilesPaginated({ type: 'video', limit: 15, page: 1 }),
        api.fetchFilesPaginated({ type: 'image', limit: 15, page: 1 })
      ]);

      const vSlider = this.container.querySelector('#recent-videos-slider');
      const iSlider = this.container.querySelector('#recent-images-slider');
      
      vSlider.innerHTML = '';
      iSlider.innerHTML = '';

      if (!videosData.items?.length) {
        vSlider.innerHTML = `<div style="padding: 24px; color: var(--text-muted); background: var(--bg-tertiary); border-radius: 12px; border: 1px dashed var(--border-color); width: 100%;">No recent videos found.</div>`;
      } else {
        videosData.items.forEach(file => vSlider.appendChild(this.createMediaCard(file, true)));
      }

      if (!imagesData.items?.length) {
        iSlider.innerHTML = `<div style="padding: 24px; color: var(--text-muted); background: var(--bg-tertiary); border-radius: 12px; border: 1px dashed var(--border-color); width: 100%;">No recent photos found.</div>`;
      } else {
        imagesData.items.forEach(file => iSlider.appendChild(this.createMediaCard(file, false)));
      }
    } catch (err) {
      console.error('Failed to load recent media:', err);
    }
  }

  createMediaCard(file, isVideo) {
    const card = createElement('div', { 
      className: 'media-card',
      style: `
        flex: 0 0 auto; 
        scroll-snap-align: start; 
        width: 300px; 
        background: var(--bg-tertiary); 
        border-radius: var(--radius-lg); 
        overflow: hidden; 
        cursor: pointer; 
        transition: transform 0.2s, box-shadow 0.2s;
        border: 1px solid var(--border-color);
      `
    });

    const thumbStyle = `
      width: 100%;
      height: 170px;
      object-fit: cover;
      background: var(--bg-secondary);
    `;

    // Dynamic thumbnail injection
    const imgHtml = file.thumbnail 
      ? `<img src="${file.thumbnail}" alt="${escapeHtml(file.filename)}" style="${thumbStyle}" loading="lazy">` 
      : `<div style="${thumbStyle}; display:flex; align-items:center; justify-content:center; color: var(--text-muted);">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:48px; height:48px;">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            ${isVideo ? '<polygon points="10 8 16 12 10 16 10 8"></polygon>' : '<circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'}
          </svg>
         </div>`;

    card.innerHTML = `
      <div style="position: relative;">
        ${imgHtml}
        ${isVideo ? `<div style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.7); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">VIDEO</div>` : ''}
      </div>
      <div style="padding: 12px 16px;">
        <h3 style="margin: 0 0 4px 0; font-size: 1rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(file.filename)}">
          ${escapeHtml(file.filename)}
        </h3>
        <p style="margin: 0; font-size: 0.85rem; color: var(--text-muted);">Added ${new Date(file.uploadedAt).toLocaleDateString()}</p>
      </div>
    `;

    // Hover effects via JS inline logic for exactness
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'translateY(-4px)';
      card.style.borderColor = 'var(--color-primary)';
      card.style.boxShadow = '0 10px 20px rgba(0,0,0,0.5)';
    });
    
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.borderColor = 'var(--border-color)';
      card.style.boxShadow = '';
    });

    // Handle clicks just like Gallery.js does (launching MediaPlayer)
    card.addEventListener('click', () => {
      // If we just inject a `media:play` event, the MediaPlayer expects the entire gallery context.
      // So instead, clicking a slider item navigates rapidly to the category, filtering that item.
      if (this.onNavigate) {
         this.onNavigate(isVideo ? 'videos' : 'images');
      }
    });

    return card;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    const dashboardBtn = this.container.querySelector('#dashboard-btn');
    if (dashboardBtn) {
      dashboardBtn.addEventListener('click', () => {
        if (this.onNavigate) this.onNavigate('dashboard');
      });
    }

    const videosPill = this.container.querySelector('#videos-pill');
    const viewAllVideos = this.container.querySelector('#view-all-videos');
    if (videosPill) {
      videosPill.addEventListener('click', () => {
        if (this.onNavigate) this.onNavigate('videos');
      });
    }
    if (viewAllVideos) {
      viewAllVideos.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.onNavigate) this.onNavigate('videos');
      });
    }

    const imagesPill = this.container.querySelector('#images-pill');
    const viewAllImages = this.container.querySelector('#view-all-images');
    if (imagesPill) {
      imagesPill.addEventListener('click', () => {
        if (this.onNavigate) this.onNavigate('images');
      });
    }
    if (viewAllImages) {
      viewAllImages.addEventListener('click', (e) => {
        e.preventDefault();
        if (this.onNavigate) this.onNavigate('images');
      });
    }

    const searchInput = this.container.querySelector('#hero-search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = searchInput.value.trim();
          if (query && this.onNavigate) {
            this.onNavigate('search', { q: query });
          }
        }
      });
    }
  }

  /**
   * Destroy the component
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.container = null;
    this.onNavigate = null;
  }
}

export default HomePage;
