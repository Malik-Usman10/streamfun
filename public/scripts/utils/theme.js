/**
 * Theme Management Utility
 * Handles light/dark mode switching with localStorage persistence
 * and system color scheme detection
 */

const THEME_KEY = 'theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

class ThemeManager {
  constructor() {
    this.html = document.documentElement;
    this.listeners = [];
    this.currentTheme = this.getInitialTheme();
  }

  /**
   * Get initial theme from localStorage or system preference
   * @returns {string} 'light' or 'dark'
   */
  getInitialTheme() {
    // Check localStorage first
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === THEME_LIGHT || savedTheme === THEME_DARK) {
      return savedTheme;
    }

    // Fall back to system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? THEME_DARK : THEME_LIGHT;
  }

  /**
   * Initialize theme system
   * Applies saved theme and sets up system preference listener
   */
  init() {
    // Apply initial theme
    this.applyTheme(this.currentTheme);

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', (e) => {
      // Only update if user hasn't set a preference
      if (!localStorage.getItem(THEME_KEY)) {
        const newTheme = e.matches ? THEME_DARK : THEME_LIGHT;
        this.setTheme(newTheme, false); // Don't save to localStorage
      }
    });

    return this;
  }

  /**
   * Apply theme to document
   * @param {string} theme - 'light' or 'dark'
   */
  applyTheme(theme) {
    this.html.setAttribute('data-theme', theme);
    this.currentTheme = theme;
    
    // Notify listeners
    this.notifyListeners(theme);
  }

  /**
   * Set theme and optionally persist to localStorage
   * @param {string} theme - 'light' or 'dark'
   * @param {boolean} persist - Whether to save to localStorage (default: true)
   */
  setTheme(theme, persist = true) {
    if (theme !== THEME_LIGHT && theme !== THEME_DARK) {
      console.warn(`Invalid theme: ${theme}. Using light theme.`);
      theme = THEME_LIGHT;
    }

    this.applyTheme(theme);

    if (persist) {
      localStorage.setItem(THEME_KEY, theme);
    }
  }

  /**
   * Toggle between light and dark themes
   * @returns {string} The new theme
   */
  toggle() {
    const newTheme = this.currentTheme === THEME_LIGHT ? THEME_DARK : THEME_LIGHT;
    this.setTheme(newTheme);
    return newTheme;
  }

  /**
   * Get current theme
   * @returns {string} 'light' or 'dark'
   */
  getTheme() {
    return this.currentTheme;
  }

  /**
   * Check if current theme is dark
   * @returns {boolean}
   */
  isDark() {
    return this.currentTheme === THEME_DARK;
  }

  /**
   * Check if current theme is light
   * @returns {boolean}
   */
  isLight() {
    return this.currentTheme === THEME_LIGHT;
  }

  /**
   * Subscribe to theme changes
   * @param {Function} callback - Called with new theme when it changes
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.listeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(listener => listener !== callback);
    };
  }

  /**
   * Notify all listeners of theme change
   * @param {string} theme - The new theme
   */
  notifyListeners(theme) {
    this.listeners.forEach(listener => {
      try {
        listener(theme);
      } catch (error) {
        console.error('Error in theme listener:', error);
      }
    });
  }

  /**
   * Clear saved theme preference
   * Will fall back to system preference on next load
   */
  clearPreference() {
    localStorage.removeItem(THEME_KEY);
  }
}

// Create singleton instance
const themeManager = new ThemeManager();

// Export for use in other modules
export default themeManager;

// Also export constants
export { THEME_LIGHT, THEME_DARK };
