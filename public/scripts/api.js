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
   * Fetch all files
   * @returns {Promise<Array>} Array of file objects
   */
  async fetchFiles() {
    const data = await apiCallWithRetry(`${API_BASE}/files`);
    return data.files || [];
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

    // Step 2: Upload chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      await fetch(`${API_BASE}/files/upload/chunked/${fileId}/chunk/${i}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk
      });

      // Report progress
      if (onProgress) {
        const progress = Math.round(((i + 1) / totalChunks) * 100);
        onProgress(progress);
      }
    }

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
  async deleteAccount(accountId) {
    return await apiCall(`${API_BASE}/accounts/${accountId}`, {
      method: 'DELETE'
    });
  },

  /**
   * Fetch dashboard statistics
   * @returns {Promise<Object>} Statistics object
   */
  async fetchStats() {
    return await apiCallWithRetry(`${API_BASE}/dashboard/stats`);
  }
};

// Export API client and error classes
export default api;
export { APIError, NetworkError };
