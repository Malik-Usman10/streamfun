/**
 * Sidebar Component
 * Handles sidebar navigation between Videos and Images categories
 */

import appState from '../state.js';

class Sidebar {
  constructor(container) {
    this.container = container;
    this.navItems = [];
    this.unsubscribe = null;
    
    this.init();
  }

  /**
   * Initialize sidebar component
   */
  init() {
    this.attachEventListeners();
    this.subscribeToState();
    this.updateActiveState();
  }

  /**
   * Attach event listeners to navigation items
   */
  attachEventListeners() {
    this.navItems = Array.from(this.container.querySelectorAll('.nav-item'));
    
    this.navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const category = item.dataset.category;
        
        if (category) {
          this.handleCategoryChange(category);
        }
      });
    });
  }

  /**
   * Handle category change
   * @param {string} category - Category to switch to ('videos' or 'images')
   */
  handleCategoryChange(category) {
    // Update state
    appState.setCategory(category);
    
    // Close mobile sidebar if open
    if (window.innerWidth < 768) {
      this.closeMobileSidebar();
    }
  }

  /**
   * Close mobile sidebar
   */
  closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const hamburger = document.getElementById('hamburger');
    
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
    if (hamburger) hamburger.classList.remove('active');
    
    appState.setState({ sidebarOpen: false });
  }

  /**
   * Subscribe to state changes
   */
  subscribeToState() {
    this.unsubscribe = appState.subscribe((newState, prevState) => {
      // Update active state when category changes
      if (newState.currentCategory !== prevState.currentCategory) {
        this.updateActiveState();
      }
    });
  }

  /**
   * Update active state of navigation items
   */
  updateActiveState() {
    const currentCategory = appState.get('currentCategory');
    
    this.navItems.forEach(item => {
      const category = item.dataset.category;
      
      if (category === currentCategory) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
      } else {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
      }
    });
  }

  /**
   * Destroy component and cleanup
   */
  destroy() {
    // Unsubscribe from state changes
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    
    // Remove event listeners
    this.navItems.forEach(item => {
      item.replaceWith(item.cloneNode(true));
    });
  }
}

export default Sidebar;
