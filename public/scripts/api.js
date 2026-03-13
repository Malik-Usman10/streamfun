/**
 * API Client Wrapper
 * Handles all API calls with consistent error handling and retry logic
 */

const API_BASE = 'http://localhost:3000/api';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms

/**
 * Custom error classes for better error handling
 */
class APIError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.data = data;
  }
}

class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make an API call with error handling
 * @param {string} url - API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise} Response data
 */
async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      // Try to parse error response
      let errorData = null;
      try {
        errorData = await response.json();
      } catch (e) {
        // Response is not JSON
      }

      const errorMessage = errorData?.error || errorData?.message || response.statusText;
      throw new APIError(response.status, errorMessage, errorData);
    }

    // Parse JSON response
    return await response.json();
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }

    // Network error (no response received)
    if (error.name === 'TypeError' || error.message.includes('fetch')) {
      throw new NetworkError('Unable to connect to server. Please check your connection.');
    }

    throw error;
  }
}

/**
 * Make an API call with retry logic
 * @param {string} url - API endpoint URL
 * @param {Object} options - Fetch options
 * @param {number} retries - Number of retries remaining
 * @returns {Promise} Response data
 */
async function apiCallWithRetry(url, options = {}, retries = MAX_RETRIES) {
  try {
    return await apiCall(url, options);
  } catch (error) {
    // Don't retry on client errors (4xx) or if no retries left
    if (error instanceof APIError && error.status >= 400 && error.status < 500) {
      throw error;
    }

    if (retries <= 0) {
      throw error;
    }

    // Wait before retrying
    await sleep(RETRY_DELAY);
    return apiCallWithRetry(url, options, retries - 1);
  }
}

/**
 * API Client
 */
const api = {
  /**
   * Fetch all files with full pagination response
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Object containing items and pagination details
   */
  async fetchFilesPaginated(options = {}) {
    const params = new URLSearchParams();

    if (options.category) {
      params.append('category', options.category);
    }

    if (options.type) {
      params.append('type', options.type);
    }

    if (options.page) {
      params.append('page', options.page);
    }

    if (options.limit) {
      params.append('limit', options.limit);
    }

    const url = `${API_BASE}/files/gallery${params.toString() ? '?' + params.toString() : ''}`;
    return await apiCallWithRetry(url);
  },

  /**
   * Search for files
   * @param {Object} options - Search options (q, type, etc.)
   * @returns {Promise<Object>} Search results with pagination
   */
  async fetchFilesSearch(options = {}) {
    const params = new URLSearchParams();
    if (options.q) params.append('q', options.q);
    if (options.type) params.append('type', options.type);
    if (options.page) params.append('page', options.page);
    if (options.limit) params.append('limit', options.limit);

    const url = `${API_BASE}/files/search?${params.toString()}`;
    return await apiCallWithRetry(url);
  },

  /**
   * Legacy Fetch all files
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of file objects
   */
  async fetchFiles(options = {}) {
    const data = await this.fetchFilesPaginated(options);
    return data.items || [];
  },

  /**
   * Fetch categories for a file type
   * @param {string} fileType - 'image' or 'video'
   * @returns {Promise<Array>} Array of category objects
   */
  async fetchCategories(fileType) {
    const data = await apiCallWithRetry(`${API_BASE}/files/categories?type=${fileType}`);
    return data.categories || [];
  },

  /**
   * Upload file using chunked upload
   * @param {File} file - File to upload
   * @param {Object} options - Upload options
   * @param {Function} onProgress - Progress callback (receives percentage)
   * @returns {Promise<Object>} Upload result
   */
  async uploadFile(file, options = {}, onProgress = null) {
    const {
      provider = 'google_drive',
      encrypt = true,
      collectionName = null
    } = options;

    const chunkSize = 10 * 1024 * 1024; // 10 MB chunks
    const totalChunks = Math.ceil(file.size / chunkSize);

    // Step 1: Initialize chunked upload
    const initBody = {
      filename: file.name,
      size: file.size,
      chunkSize: chunkSize,
      provider: provider,
      mimeType: file.type,
      encrypt: encrypt
    };

    if (collectionName) {
      initBody.collectionName = collectionName;
    }

    const { fileId } = await apiCall(`${API_BASE}/files/upload/chunked/init`, {
      method: 'POST',
      body: JSON.stringify(initBody)
    });

    // Step 2: Upload chunks in parallel for maximum speed
    const PARALLEL_UPLOADS = 3;
    let completedChunks = 0;

    async function uploadSingleChunk(index) {
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunkBlob = file.slice(start, end);

      const MAX_RETRIES = 3;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const resp = await fetch(`${API_BASE}/files/upload/chunked/${fileId}/chunk/${index}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: chunkBlob
          });
          if (!resp.ok) {
            throw new Error(`Chunk ${index} upload failed: ${resp.status}`);
          }

          completedChunks++;
          if (onProgress) {
            onProgress(Math.round((completedChunks / totalChunks) * 100));
          }
          return;
        } catch (err) {
          if (attempt === MAX_RETRIES) throw err;
          // Exponential backoff before retry
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
        }
      }
    }

    // Pool-based parallel upload: keep PARALLEL_UPLOADS in-flight at all times
    const pool = [];
    for (let i = 0; i < totalChunks; i++) {
      const p = uploadSingleChunk(i).then(() => {
        pool.splice(pool.indexOf(p), 1);
      });
      pool.push(p);
      if (pool.length >= PARALLEL_UPLOADS) {
        await Promise.race(pool);
      }
    }
    await Promise.all(pool);

    // Step 3: Complete upload
    const result = await apiCall(`${API_BASE}/files/upload/chunked/${fileId}/complete`, {
      method: 'POST'
    });

    return result;
  },

  /**
   * Download file
   * @param {string} fileId - File ID
   * @param {string} filename - Filename for download
   * @returns {Promise<void>}
   */
  async downloadFile(fileId, filename) {
    const response = await fetch(`${API_BASE}/files/${fileId}/download`);

    if (!response.ok) {
      throw new APIError(response.status, 'Failed to download file');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  /**
   * Delete file
   * @param {string} fileId - File ID
   * @returns {Promise<Object>} Delete result
   */
  async deleteFile(fileId) {
    return await apiCall(`${API_BASE}/files/${fileId}`, {
      method: 'DELETE'
    });
  },

  /**
   * Get streaming URL for file
   * @param {string} fileId - File ID
   * @returns {Promise<string>} Streaming URL
   */
  async getStreamUrl(fileId) {
    const data = await apiCall(`${API_BASE}/files/${fileId}/stream`);
    return data.url;
  },

  /**
   * Fetch all accounts
   * @returns {Promise<Array>} Array of account objects
   */
  async fetchAccounts() {
    const data = await apiCallWithRetry(`${API_BASE}/accounts`);
    return data.accounts || [];
  },

  /**
   * Add new account
   * @param {Object} accountData - Account data
   * @returns {Promise<Object>} Created account
   */
  async addAccount(accountData) {
    return await apiCall(`${API_BASE}/accounts`, {
      method: 'POST',
      body: JSON.stringify(accountData)
    });
  },

  /**
   * Delete account
   * @param {string} accountId - Account ID
   * @returns {Promise<Object>} Delete result
   */
  /**
   * Fetch dashboard statistics
   * @returns {Promise<Object>} Statistics object
   */
  async fetchStats() {
    return await apiCallWithRetry(`${API_BASE}/dashboard/stats`);
  },

  /**
   * Fetch backup configuration
   * @returns {Promise<Object>} Backup configuration and status
   */
  async fetchBackupConfig() {
    return await apiCallWithRetry(`${API_BASE}/backup/config`);
  },

  /**
   * Update backup configuration
   * @param {Object} data - { destination, frequency }
   * @returns {Promise<Object>} Update result
   */
  async updateBackupConfig(data) {
    return await apiCallWithRetry(`${API_BASE}/backup/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  },

  /**
   * Trigger manual backup
   * @returns {Promise<Object>} Trigger result
   */
  async triggerBackup() {
    return await apiCallWithRetry(`${API_BASE}/backup/trigger`, {
      method: 'POST'
    });
  }
};

// Export API client and error classes
export default api;
export { APIError, NetworkError };
