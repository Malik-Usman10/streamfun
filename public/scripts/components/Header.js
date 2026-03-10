/**
 * Header Component
 * Handles header with hamburger menu, title, file count, theme toggle, and dashboard button
 */

import appState from '../state.js';
import themeManager from '../utils/theme.js';
import { capitalize } from '../utils/format.js';

class Header {
  constructor(container) {
    this.container = container;
    this.elements = {
      hamburger: null,
      categoryTitle: null,
      fileCount: null,
      themeToggle: null,
      dashboardButton: null,
      iconSun: null,
      iconMoon: null
    };
    this.unsubscribe = null;
    
    this.init();
  }

  /**
   * Initialize header component
   */
  init() {
    this.cacheElements();
    this.attachEventListeners();
    this.subscribeToState();
    this.updateDisplay();
  }

  /**
   * Cache DOM elements
   */
  cacheElements() {
    this.elements.hamburger = document.getElementById('hamburger');
    this.elements.categoryTitle = document.getElementById('category-title');
    this.elements.fileCount = document.getElementById('file-count');
    this.elements.themeToggle = document.getElementById('theme-toggle');
    this.elements.dashboardButton = document.getElementById('dashboard-button');
    this.elements.iconSun = this.container.querySelector('.icon-sun');
    this.elements.iconMoon = this.container.querySelector('.icon-moon');
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Hamburger menu toggle
    if (this.elements.hamburger) {
      this.elements.hamburger.addEventListener('click', () => {
        this.toggleMobileSidebar();
      });
    }

    // Theme toggle
    if (this.elements.themeToggle) {
      this.elements.themeToggle.addEventListener('click', () => {
        themeManager.toggle();
      });
    }

    // Dashboard button
    if (this.elements.dashboardButton) {
      this.elements.dashboardButton.addEventListener('click', () => {
        this.openDashboard();
      });
    }

    // Subscribe to theme changes
    themeManager.subscribe((theme) => {
      this.updateThemeIcon(theme);
    });
  }

  /**
   * Toggle mobile sidebar
   */
  toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    
    if (sidebar && backdrop) {
      const isOpen = sidebar.classList.toggle('open');
      backdrop.classList.toggle('active');
      this.elements.hamburger.classList.toggle('active');
      
      appState.setState({ sidebarOpen: isOpen });
    }
  }

  /**
   * Open dashboard modal
   */
  openDashboard() {
    const dashboardModal = document.getElementById('dashboard-modal');
    if (dashboardModal) {
      dashboardModal.classList.add('active');
      document.body.style.overflow = 'hidden';
      
      // Dispatch custom event for dashboard open
      window.dispatchEvent(new CustomEvent('dashboard:open'));
    }
  }

  /**
   * Update theme icon based on current theme
   * @param {string} theme - Current theme ('light' or 'dark')
   */
  updateThemeIcon(theme) {
    if (this.elements.iconSun && this.elements.iconMoon) {
      if (theme === 'dark') {
        this.elements.iconSun.style.display = 'none';
        this.elements.iconMoon.style.display = 'block';
      } else {
        this.elements.iconSun.style.display = 'block';
        this.elements.iconMoon.style.display = 'none';
      }
    }
  }

  /**
   * Subscribe to state changes
   */
  subscribeToState() {
    this.unsubscribe = appState.subscribe((newState, prevState) => {
      // Update title when category changes
      if (newState.currentCategory !== prevState.currentCategory) {
        this.updateCategoryTitle(newState.currentCategory);
      }

      // Update file count when files or category changes
      if (newState.files !== prevState.files || 
          newState.currentCategory !== prevState.currentCategory) {
        this.updateFileCount();
      }
    });
  }

  /**
   * Update category title
   * @param {string} category - Current category
   */
  updateCategoryTitle(category) {
    if (this.elements.categoryTitle) {
      this.elements.categoryTitle.textContent = capitalize(category);
    }
  }

  /**
   * Update file count display
   */
  updateFileCount() {
    if (this.elements.fileCount) {
      const count = appState.getFileCount();
      this.elements.fileCount.textContent = `${count} ${count === 1 ? 'file' : 'files'}`;
    }
  }

  /**
   * Update all display elements
   */
  updateDisplay() {
    const currentCategory = appState.get('currentCategory');
    const currentTheme = themeManager.getTheme();
    
    this.updateCategoryTitle(currentCategory);
    this.updateFileCount();
    this.updateThemeIcon(currentTheme);
  }

  /**
   * Destroy component and cleanup
   */
  destroy() {
    // Unsubscribe from state changes
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    
    // Remove event listeners by cloning elements
    Object.values(this.elements).forEach(element => {
      if (element && element.parentNode) {
        element.replaceWith(element.cloneNode(true));
      }
    });
  }
}

export default Header;
