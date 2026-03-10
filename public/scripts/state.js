/**
 * Application State Management
 * Centralized state with subscribe/notify pattern for reactive updates
 */

class AppState {
  constructor() {
    this.state = {
      currentCategory: 'videos', // 'videos' | 'images'
      theme: 'light',            // 'light' | 'dark'
      files: [],                 // Array of file objects
      accounts: [],              // Array of account objects
      stats: {},                 // Statistics object
      isLoading: false,          // Global loading state
      sidebarOpen: false,        // Mobile sidebar state
      error: null                // Global error state
    };
    
    this.listeners = [];
  }

  /**
   * Get current state
   * @returns {Object} Current state object
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Get specific state value
   * @param {string} key - State key to retrieve
   * @returns {*} State value
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Update state with new values
   * @param {Object} updates - Object with state updates
   * @param {boolean} notify - Whether to notify listeners (default: true)
   */
  setState(updates, notify = true) {
    // Merge updates into current state
    const prevState = { ...this.state };
    this.state = { ...this.state, ...updates };
    
    // Notify listeners if requested
    if (notify) {
      this.notifyListeners(this.state, prevState);
    }
  }

  /**
   * Subscribe to state changes
   * @param {Function} listener - Callback function called with (newState, prevState)
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }
    
    this.listeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notify all listeners of state change
   * @param {Object} newState - New state
   * @param {Object} prevState - Previous state
   */
  notifyListeners(newState, prevState) {
    this.listeners.forEach(listener => {
      try {
        listener(newState, prevState);
      } catch (error) {
        console.error('Error in state listener:', error);
      }
    });
  }

  /**
   * Reset state to initial values
   */
  reset() {
    this.setState({
      currentCategory: 'videos',
      theme: 'light',
      files: [],
      accounts: [],
      stats: {},
      isLoading: false,
      sidebarOpen: false,
      error: null
    });
  }

  /**
   * Get filtered files based on current category
   * @returns {Array} Filtered files array
   */
  getFilteredFiles() {
    const { files, currentCategory } = this.state;
    
    if (currentCategory === 'videos') {
      return files.filter(file => file.mimeType?.startsWith('video/'));
    } else if (currentCategory === 'images') {
      return files.filter(file => file.mimeType?.startsWith('image/'));
    }
    
    return files;
  }

  /**
   * Get file count for current category
   * @returns {number} Number of files in current category
   */
  getFileCount() {
    return this.getFilteredFiles().length;
  }

  /**
   * Set loading state
   * @param {boolean} isLoading - Loading state
   */
  setLoading(isLoading) {
    this.setState({ isLoading });
  }

  /**
   * Set error state
   * @param {string|null} error - Error message or null to clear
   */
  setError(error) {
    this.setState({ error });
  }

  /**
   * Clear error state
   */
  clearError() {
    this.setState({ error: null });
  }

  /**
   * Set current category
   * @param {string} category - 'videos' or 'images'
   */
  setCategory(category) {
    if (category !== 'videos' && category !== 'images') {
      console.warn(`Invalid category: ${category}`);
      return;
    }
    
    this.setState({ currentCategory: category });
  }

  /**
   * Set files array
   * @param {Array} files - Array of file objects
   */
  setFiles(files) {
    this.setState({ files: Array.isArray(files) ? files : [] });
  }

  /**
   * Add a file to the files array
   * @param {Object} file - File object to add
   */
  addFile(file) {
    this.setState({ files: [...this.state.files, file] });
  }

  /**
   * Remove a file from the files array
   * @param {string} fileId - ID of file to remove
   */
  removeFile(fileId) {
    this.setState({
      files: this.state.files.filter(file => file.id !== fileId)
    });
  }

  /**
   * Set accounts array
   * @param {Array} accounts - Array of account objects
   */
  setAccounts(accounts) {
    this.setState({ accounts: Array.isArray(accounts) ? accounts : [] });
  }

  /**
   * Set statistics
   * @param {Object} stats - Statistics object
   */
  setStats(stats) {
    this.setState({ stats: stats || {} });
  }
}

// Create singleton instance
const appState = new AppState();

// Export for use in other modules
export default appState;
