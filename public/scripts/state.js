/**
 * Application State Management
 * Centralized state with subscribe/notify pattern for reactive updates
 */

class AppState {
  constructor() {
    this.state = {
      currentCategory: 'videos', // 'videos' | 'images'
      categoryFilter: null,      // Current category filter (e.g., 'Wallpapers')
      currentFile: null,         // Currently playing/viewing file
      theme: 'light',            // 'light' | 'dark'
      files: [],                 // Array of file objects
      accounts: [],              // Array of account objects
      stats: {},                 // Statistics object
      isLoading: false,          // Global loading state
      isLoadingMore: false,      // Pagination loading state
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
        hasMore: false
      },
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
      categoryFilter: null,
      theme: 'light',
      files: [],
      accounts: [],
      stats: {},
      isLoading: false,
      isLoadingMore: false,
      pagination: {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0,
        hasMore: false
      },
      sidebarOpen: false,
      error: null
    });
  }

  /**
   * Get filtered files based on current category and category filter
   * @returns {Array} Filtered files array
   */
  getFilteredFiles() {
    const { files, currentCategory, categoryFilter } = this.state;
    
    let filteredFiles = files;
    
    // Filter by file type (videos/images)
    if (currentCategory === 'videos') {
      filteredFiles = filteredFiles.filter(file => file.mimeType?.startsWith('video/'));
    } else if (currentCategory === 'images') {
      filteredFiles = filteredFiles.filter(file => file.mimeType?.startsWith('image/'));
    }
    
    // Filter by category (collection name)
    if (categoryFilter) {
      filteredFiles = filteredFiles.filter(file => 
        file.collectionName === categoryFilter || 
        (categoryFilter === 'Uncategorized' && !file.collectionName)
      );
    }
    
    return filteredFiles;
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
   * Set loading more state
   * @param {boolean} isLoadingMore - Loading more state
   */
  setLoadingMore(isLoadingMore) {
    this.setState({ isLoadingMore });
  }

  /**
   * Set pagination state
   * @param {Object} pagination - Pagination object
   */
  setPagination(pagination) {
    this.setState({
      pagination: {
        ...this.state.pagination,
        ...pagination,
        hasMore: pagination.page < pagination.totalPages
      }
    });
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
    
    this.setState({ currentCategory: category, categoryFilter: null });
  }

  /**
   * Set category filter
   * @param {string|null} categoryFilter - Category name to filter by
   */
  setCategoryFilter(categoryFilter) {
    this.setState({ categoryFilter });
  }

  /**
   * Set files array (resets current files)
   * @param {Array} files - Array of file objects
   */
  setFiles(files) {
    this.setState({ files: Array.isArray(files) ? files : [] });
  }

  /**
   * Append files to the existing array
   * @param {Array} newFiles - Array of file objects to append
   */
  appendFiles(newFiles) {
    if (!Array.isArray(newFiles)) return;
    
    // Prevent duplicates by checking IDs
    const currentIds = new Set(this.state.files.map(f => f.id));
    const uniqueNewFiles = newFiles.filter(f => !currentIds.has(f.id));
    
    this.setState({ 
      files: [...this.state.files, ...uniqueNewFiles] 
    });
  }

  /**
   * Add a single file to the files array
   * @param {Object} file - File object to add
   */
  addFile(file) {
    // Only add if not strictly managed by pagination
    this.setState({ files: [file, ...this.state.files] });
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

  /**
   * Set currently playing/viewing file
   * @param {Object|null} file - File object or null to clear
   */
  setCurrentFile(file) {
    this.setState({ currentFile: file });
  }

  /**
   * Clear currently playing/viewing file
   */
  clearCurrentFile() {
    this.setState({ currentFile: null });
  }
}

// Create singleton instance
const appState = new AppState();

// Export for use in other modules
export default appState;
