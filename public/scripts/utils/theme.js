/**
 * Theme Management Utility
 * Simplified to always use DARK theme as per user preference.
 */

const THEME_DARK = 'dark';

class ThemeManager {
  constructor() {
    this.html = document.documentElement;
    this.currentTheme = THEME_DARK;
  }

  /**
   * Initialize theme system
   * Always applies dark theme
   */
  init() {
    this.applyTheme(THEME_DARK);
    return this;
  }

  /**
   * Apply theme to document
   */
  applyTheme(theme) {
    this.html.setAttribute('data-theme', THEME_DARK);
    this.currentTheme = THEME_DARK;
  }

  /**
   * Set theme (no-op now, always dark)
   */
  setTheme(theme) {
    this.applyTheme(THEME_DARK);
  }

  /**
   * Toggle (no-op now, always dark)
   */
  toggle() {
    return THEME_DARK;
  }

  /**
   * Get current theme
   */
  getTheme() {
    return THEME_DARK;
  }

  /**
   * Check if current theme is dark
   */
  isDark() {
    return true;
  }

  /**
   * Check if current theme is light
   */
  isLight() {
    return false;
  }

  /**
   * Subscribe to theme changes
   */
  subscribe(callback) {
    return () => {};
  }
}

// Create singleton instance
const themeManager = new ThemeManager();

export default themeManager;
export { THEME_DARK };
