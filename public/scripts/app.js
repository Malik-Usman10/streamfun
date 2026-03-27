// StreamFun Frontend - Main Application Entry Point
// Version: 3.0 - Category-based Gallery Views
import themeManager from './utils/theme.js';
import appState from './state.js';
import router from './router.js';
import HomePage from './components/HomePage.js';
import CategoryView from './components/CategoryView.js';
import Gallery from './components/Gallery.js';
import MediaPlayer from './components/MediaPlayer.js';
import FullPageDashboard from './components/FullPageDashboard.js';
import LoginView from './components/LoginView.js';
import api from './api.js';
import { showSuccess, showError } from './utils/dom.js';

console.log('StreamFun Frontend loaded');

// Initialize theme system
themeManager.init();

// Get app root container
const appRoot = document.getElementById('app-root');

// Initialize global components (modals)
const mediaPlayerModal = document.getElementById('media-player-modal');
const mediaPlayerComponent = new MediaPlayer(mediaPlayerModal);



// Register routes
router.register('home', () => {
  const homePage = new HomePage();
  homePage.render(appRoot, (destination, params) => {
    if (destination === 'search') {
      router.navigate('search', params);
    } else {
      router.navigate(destination);
    }
  });
  return homePage;
});

router.register('search', (params) => {
  const query = params.q || '';
  
  appRoot.innerHTML = `
    <div class="gallery-container">
      <header class="gallery-header">
        <div class="gallery-header-content">
          <div class="gallery-header-left">
            <button class="back-button" id="back-to-home" aria-label="Back to home">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>
            <div class="gallery-header-title">
              <h1>Search Results</h1>
              <span class="file-count" id="file-count">"${query}"</span>
            </div>
          </div>
          <div class="gallery-header-actions">
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
      <main class="gallery-main" id="gallery-main">
        <div class="loading-state" id="loading-state">
          <div class="spinner"></div>
          <p>Searching for "${query}"...</p>
        </div>
        <div class="gallery-grid" id="gallery-grid" style="display: none;"></div>
        <div class="empty-state" id="empty-state" style="display: none;">
          <h2 id="empty-title">No results found</h2>
          <p id="empty-description">Try a different search term</p>
        </div>
      </main>
    </div>
  `;

  // Attach back button listener
  document.getElementById('back-to-home')?.addEventListener('click', () => {
    router.navigate('home');
  });

  const galleryMain = document.getElementById('gallery-main');
  const gallery = new Gallery(galleryMain);

  // Fetch search results
  loadSearchFiles(query);

  return gallery;
});

router.register('videos', () => {
  const categoryView = new CategoryView(appRoot, 'videos');
  categoryView.render();
  return categoryView;
});

router.register('images', (params) => {
  const categoryView = new CategoryView(appRoot, 'images');
  categoryView.render();
  // If a specific category was requested (e.g. from home screen collection card), open it
  if (params && params.openCategory) {
    categoryView.openCategory(params.openCategory);
  }
  return categoryView;
});

router.register('dashboard', () => {
  const dashboard = new FullPageDashboard(appRoot);
  dashboard.render();
  return dashboard;
});

// Navigation event handlers
window.addEventListener('navigate:home', () => {
  router.navigate('home');
});

window.addEventListener('navigate:videos', () => {
  router.navigate('videos');
});

window.addEventListener('navigate:images', (e) => {
  router.navigate('images', e.detail || {});
});

window.addEventListener('navigate:dashboard', () => {
  router.navigate('dashboard');
});

// File action handlers
window.addEventListener('file:download', async (e) => {
  const { file } = e.detail;

  try {
    await api.downloadFile(file.id, file.filename);
    showSuccess(`Downloading ${file.filename}...`);
  } catch (error) {
    console.error('Download error:', error);
    showError(`Failed to download file: ${error.message}`);
  }
});

window.addEventListener('file:delete', async (e) => {
  const { file } = e.detail;

  // Show confirmation dialog
  if (!confirm(`Are you sure you want to delete "${file.filename}"?`)) {
    return;
  }

  try {
    await api.deleteFile(file.id);

    // Remove file from state
    appState.removeFile(file.id);

    showSuccess(`File "${file.filename}" deleted successfully`);
  } catch (error) {
    console.error('Delete error:', error);
    showError(`Failed to delete file: ${error.message}`);
  }
});

// Dashboard button handler (delegated)
document.addEventListener('click', (e) => {
  const dashboardButton = e.target.closest('#dashboard-button');
  if (dashboardButton) {
    window.dispatchEvent(new CustomEvent('navigate:dashboard'));
  }
});

// Load files for a search query
async function loadSearchFiles(query) {
  try {
    appState.setState({ isLoading: true, files: [] });
    
    // Fetch from search API
    const response = await api.fetchFilesSearch({ q: query, limit: 50 });
    
    appState.setState({ 
      files: response.files || [], 
      isLoading: false,
      pagination: response.pagination || { page: 1, limit: 50, total: (response.files || []).length, hasMore: false }
    });
  } catch (error) {
    console.error('Search failed:', error);
    appState.setState({ isLoading: false });
    showError('Search failed. Please try again.');
  }
}

// Load files for a category
async function loadFiles(category) {
  try {
    // Set loading state and current category
    // Using setCategory ensures categoryFilter is reset
    appState.setCategory(category === 'videos' || category === 'images' ? category : (category.startsWith('video') ? 'videos' : 'images'));
    appState.setLoading(true);

    // Fetch files from API
    // If category is 'videos' or 'images', we want all files of that type
    const fetchOptions = (category === 'videos' || category === 'images')
      ? { type: category === 'videos' ? 'video' : 'image', page: 1, limit: 50 }
      : { category, page: 1, limit: 50 };

    const response = await api.fetchFilesPaginated(fetchOptions);
    appState.setPagination(response.pagination);
    appState.setState({ files: response.items || [], isLoading: false });

  } catch (error) {
    console.error('Failed to load files:', error);
    appState.setState({ isLoading: false });
    showError('Failed to load files. Please refresh the page.', {
      action: 'Retry',
      onAction: () => loadFiles(category)
    });
  }
}

// Handle infinite scrolling load-more event globally
window.addEventListener('gallery:load-more', async () => {
  const state = appState.getState();
  if (state.isLoadingMore || !state.pagination.hasMore) return;

  try {
    appState.setLoadingMore(true);

    const fetchOptions = {
      page: state.pagination.page + 1,
      limit: state.pagination.limit
    };

    if (state.categoryFilter) {
      fetchOptions.category = state.categoryFilter;
    } else {
      fetchOptions.type = state.currentCategory === 'videos' ? 'video' : 'image';
    }

    const response = await api.fetchFilesPaginated(fetchOptions);
    
    appState.setPagination(response.pagination);
    appState.appendFiles(response.items || []);
  } catch (error) {
    console.error('Failed to load more files:', error);
    showError('Failed to load more files.');
  } finally {
    appState.setLoadingMore(false);
  }
});

// Initialize App Flow
async function initializeApp() {
  try {
    // Check authentication status
    const authStatus = await fetch('/api/auth/status');
    const authData = await authStatus.json();

    if (authData.enabled) {
      // Test if we have a valid session by trying to ping a protected route
      const testReq = await fetch('/api/dashboard/stats');
      if (testReq.status === 401) {
        // Show login view
        const loginView = new LoginView();
        loginView.render(appRoot);
        return; // Halt further app initialization
      }
    }

    // Initialize router
    router.init();

    // If no route, navigate to home
    if (!router.getCurrentRoute()) {
      router.navigate('home');
    }
  } catch (error) {
    console.error('Failed to initialize application:', error);
    showError('Application failed to initialize. Please refresh.');
  }
}

// Boot the application
initializeApp();
