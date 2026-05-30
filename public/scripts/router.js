/**
 * Simple Router for handling navigation
 */

class Router {
  constructor() {
    this.routes = new Map();
    this.currentRoute = null;
    this.currentView = null;
    this.currentParams = {};
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
   * @param {boolean} replaceState - If true, replace current history entry instead of pushing new one
   */
  navigate(path, params = {}, replaceState = false) {
    const handler = this.routes.get(path);
    
    if (!handler) {
      console.error(`Route not found: ${path}`);
      return;
    }

    // Only destroy and re-render if path changed or replaceState is false
    if (!replaceState || this.currentRoute !== path) {
      // Destroy current view if exists
      if (this.currentView && typeof this.currentView.destroy === 'function') {
        this.currentView.destroy();
      }

      // Call route handler
      this.currentRoute = path;
      this.currentView = handler(params);
    }

    // Store current params
    this.currentParams = params;

    // Update URL without page reload
    if (window.history) {
      const hashUrl = this.buildHashUrl(path, params);
      if (replaceState) {
        window.history.replaceState({ path, params }, '', hashUrl);
      } else {
        window.history.pushState({ path, params }, '', hashUrl);
      }
    }
  }

  /**
   * Build hash URL with parameters
   * @param {string} path - Route path
   * @param {Object} params - Route parameters
   * @returns {string} Hash URL
   */
  buildHashUrl(path, params = {}) {
    const queryString = Object.keys(params)
      .filter(key => params[key] !== undefined && params[key] !== null)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    
    return queryString ? `#${path}?${queryString}` : `#${path}`;
  }

  /**
   * Parse hash URL to extract path and parameters
   * @param {string} hash - Hash string from URL
   * @returns {Object} Object with path and params
   */
  parseHash(hash) {
    if (!hash || hash === '#') {
      return { path: null, params: {} };
    }

    // Remove leading #
    hash = hash.slice(1);

    // Split path and query string
    const [path, queryString] = hash.split('?');
    const params = {};

    if (queryString) {
      queryString.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        if (key) {
          params[decodeURIComponent(key)] = decodeURIComponent(value || '');
        }
      });
    }

    return { path, params };
  }

  /**
   * Get current route
   * @returns {string} Current route path
   */
  getCurrentRoute() {
    return this.currentRoute;
  }

  /**
   * Get current route parameters
   * @returns {Object} Current route parameters
   */
  getCurrentParams() {
    return this.currentParams;
  }

  /**
   * Initialize router with hash-based routing
   */
  init() {
    // Handle browser back/forward
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.path) {
        this.navigate(e.state.path, e.state.params || {});
      } else {
        // Fallback: parse hash from URL
        const { path, params } = this.parseHash(window.location.hash);
        if (path && this.routes.has(path)) {
          this.navigate(path, params);
        }
      }
    });

    // Handle initial hash on page load
    const { path, params } = this.parseHash(window.location.hash);
    if (path && this.routes.has(path)) {
      this.navigate(path, params);
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
