/**
 * Simple Router for handling navigation
 */

class Router {
  constructor() {
    this.routes = new Map();
    this.currentRoute = null;
    this.currentView = null;
  }

  /**
   * Register a route
   * @param {string} path - Route path
   * @param {Function} handler - Route handler function
   */
  register(path, handler) {
    this.routes.set(path, handler);
  }

  /**
   * Navigate to a route
   * @param {string} path - Route path
   * @param {Object} params - Route parameters
   */
  navigate(path, params = {}) {
    const handler = this.routes.get(path);
    
    if (!handler) {
      console.error(`Route not found: ${path}`);
      return;
    }

    // Destroy current view if exists
    if (this.currentView && typeof this.currentView.destroy === 'function') {
      this.currentView.destroy();
    }

    // Call route handler
    this.currentRoute = path;
    this.currentView = handler(params);

    // Update URL without page reload (optional)
    if (window.history && window.history.pushState) {
      window.history.pushState({ path, params }, '', `#${path}`);
    }
  }

  /**
   * Get current route
   * @returns {string} Current route path
   */
  getCurrentRoute() {
    return this.currentRoute;
  }

  /**
   * Initialize router with hash-based routing
   */
  init() {
    // Handle browser back/forward
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.path) {
        this.navigate(e.state.path, e.state.params || {});
      }
    });

    // Handle initial hash
    const hash = window.location.hash.slice(1);
    if (hash && this.routes.has(hash)) {
      this.navigate(hash);
    } else {
      // Navigate to default route
      const defaultRoute = this.routes.keys().next().value;
      if (defaultRoute) {
        this.navigate(defaultRoute);
      }
    }
  }
}

export default new Router();
