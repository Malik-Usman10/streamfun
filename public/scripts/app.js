// StreamFun Frontend - Main Application Entry Point
import themeManager from './utils/theme.js';
import appState from './state.js';
import Sidebar from './components/Sidebar.js';
import Header from './components/Header.js';
import Gallery from './components/Gallery.js';
import MediaPlayer from './components/MediaPlayer.js';
import Dashboard from './components/Dashboard.js';

console.log('StreamFun Frontend loaded');

// Initialize theme system
themeManager.init();

// Initialize components
const sidebarElement = document.getElementById('sidebar');
const sidebarComponent = new Sidebar(sidebarElement);

const headerElement = document.querySelector('.header');
const headerComponent = new Header(headerElement);

const galleryContainer = document.querySelector('.gallery-container');
const galleryComponent = new Gallery(galleryContainer);

const mediaPlayerModal = document.getElementById('media-player-modal');
const mediaPlayerComponent = new MediaPlayer(mediaPlayerModal);

const dashboardModal = document.getElementById('dashboard-modal');
const dashboardComponent = new Dashboard(dashboardModal);

// Mobile sidebar backdrop click handler
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
if (sidebarBackdrop) {
  sidebarBackdrop.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const hamburger = document.getElementById('hamburger');
    
    if (sidebar) sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('active');
    if (hamburger) hamburger.classList.remove('active');
    
    appState.setState({ sidebarOpen: false });
  });
}

// File action handlers
import api from './api.js';
import { showSuccess, showError } from './utils/dom.js';

// Handle file download
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

// Handle file delete
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

// Dashboard button handler
const dashboardButton = document.getElementById('dashboard-button');
if (dashboardButton) {
  dashboardButton.addEventListener('click', () => {
    dashboardComponent.open();
  });
}

// Initial data loading
async function loadInitialData() {
  try {
    // Set loading state
    appState.setState({ isLoading: true });

    // Fetch files from API
    const files = await api.fetchFiles();
    appState.setState({ files, isLoading: false });

  } catch (error) {
    console.error('Failed to load initial data:', error);
    appState.setState({ isLoading: false });
    showError('Failed to load files. Please refresh the page.', {
      action: 'Retry',
      onAction: loadInitialData
    });
  }
}

// Load data on page load
loadInitialData();

// Show empty state initially
const emptyState = document.getElementById('empty-state');
if (emptyState) {
  emptyState.style.display = 'flex';
}
