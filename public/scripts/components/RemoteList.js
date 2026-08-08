/**
 * RemoteList Component
 * Displays and manages rclone remotes
 */

import api from '../api.js';
import { formatBytes } from '../utils/format.js';
import { showError, showSuccess } from '../utils/dom.js';
import RemoteDetailsModal from './RemoteDetailsModal.js';
import DeleteConfirmationDialog from './DeleteConfirmationDialog.js';
import RemoteConfigWizard from './RemoteConfigWizard.js';
import RemoteEditModal from './RemoteEditModal.js';

// Cache to store remote statuses and quotas across component unmounts (e.g., tab switching)
const globalRemotesStatusCache = {};

class RemoteList {
  constructor(container) {
    this.container = container;
    this.remotes = [];
    this.isLoading = false;
    this.detailsModal = null;
    this.deleteDialog = null;
    this.configWizard = null;
    this.editModal = null;
    
    this.init();
  }

  /**
   * Initialize component
   */
  async init() {
    // Create modals and dialogs
    this.detailsModal = new RemoteDetailsModal();
    this.deleteDialog = new DeleteConfirmationDialog();
    this.configWizard = new RemoteConfigWizard();
    this.editModal = new RemoteEditModal();
    
    await this.fetchRemotes();
    this.render();
  }

  /**
   * Fetch remotes from API
   */
  async fetchRemotes() {
    this.isLoading = true;
    this.render();

    try {
      const response = await fetch('/api/rclone/remotes');
      const data = await response.json();
      
      if (data.success) {
        const newRemotes = data.data || [];
        let needsStatusFetch = false;
        
        // Initialize remotes with loading state for status and quota
        // but preserve any existing loaded status from local or global cache
        this.remotes = newRemotes.map(newRemote => {
          // Check if status/quota was already provided in the listing (from backend DB cache)
          const hasProvidedStatus = newRemote.connectionStatus && !newRemote.connectionStatus.loading;
          const hasProvidedQuota = newRemote.quota && !newRemote.quota.loading;

          const existing = this.remotes.find(r => r.name === newRemote.name) || globalRemotesStatusCache[newRemote.name];
          
          if (hasProvidedStatus || hasProvidedQuota) {
             const status = newRemote.connectionStatus || (existing ? existing.connectionStatus : { loading: true });
             const quota = newRemote.quota || (existing ? existing.quota : { loading: true });
             
             globalRemotesStatusCache[newRemote.name] = {
               connectionStatus: status,
               quota: quota
             };
             
             if (status.loading || quota.loading) {
               needsStatusFetch = true;
             }

             return {
               ...newRemote,
               connectionStatus: status,
               quota: quota
             };
          } else if (existing && existing.connectionStatus && !existing.connectionStatus.loading) {
            // Ensure global cache stays updated
            globalRemotesStatusCache[newRemote.name] = {
              connectionStatus: existing.connectionStatus,
              quota: existing.quota
            };
            return {
              ...newRemote,
              connectionStatus: existing.connectionStatus,
              quota: existing.quota
            };
          } else {
            needsStatusFetch = true;
            return {
              ...newRemote,
              connectionStatus: { loading: true },
              quota: { loading: true }
            };
          }
        });
        
        // Start fetching statuses asynchronously
        if (needsStatusFetch) {
          this.fetchRemoteStatuses();
        }
      } else {
        throw new Error(data.error || 'Failed to fetch remotes');
      }
    } catch (error) {
      console.error('Failed to fetch remotes:', error);
      showError(`Failed to load remotes: ${error.message}`);
      this.remotes = [];
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  /**
   * Fetch statuses and quotas for all remotes asynchronously
   */
  async fetchRemoteStatuses() {
    for (const remote of this.remotes) {
      if (remote.connectionStatus?.loading) {
        this.fetchSingleRemoteStatus(remote.name);
      }
    }
  }

  /**
   * Fetch status and quota for a single remote
   * @param {string} remoteName - Remote name
   */
  async fetchSingleRemoteStatus(remoteName, force = false) {
    try {
      const url = `/api/rclone/remotes/${remoteName}/status${force ? '?force=true' : ''}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.success && data.data) {
        // Update the specific remote in state
        const index = this.remotes.findIndex(r => r.name === remoteName);
        if (index !== -1) {
          this.remotes[index] = {
            ...this.remotes[index],
            connectionStatus: data.data.connectionStatus,
            quota: data.data.quota
          };
          
          // Save to global cache
          globalRemotesStatusCache[remoteName] = {
             connectionStatus: data.data.connectionStatus,
             quota: data.data.quota
          };
          
          // Re-render only this specific card if it exists in DOM
          const cardElement = this.container.querySelector(`.remote-card[data-remote-name="${remoteName}"]`);
          if (cardElement) {
             const newCardHtml = this.renderRemoteCard(this.remotes[index]);
             // Create a temporary container to extract the new card's inner HTML and classes
             const temp = document.createElement('div');
             temp.innerHTML = newCardHtml;
             const newCard = temp.firstElementChild;
             cardElement.replaceWith(newCard);
             
             // Re-attach listeners to the new card's buttons
             this.attachCardEventListeners(newCard);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to fetch status for ${remoteName}:`, error);
      // Update state to show error
      const index = this.remotes.findIndex(r => r.name === remoteName);
      if (index !== -1) {
        this.remotes[index].connectionStatus = { success: false, message: 'Status check failed' };
        this.remotes[index].quota = { available: false };
        
        globalRemotesStatusCache[remoteName] = {
           connectionStatus: this.remotes[index].connectionStatus,
           quota: this.remotes[index].quota
        };
        
        this.render(); // full render as fallback
      }
    }
  }

  /**
   * Render component
   */
  render() {
    if (!this.container) return;

    // Show loading state
    if (this.isLoading) {
      this.container.innerHTML = `
        <div class="loading-state" style="display: flex; justify-content: center; align-items: center; padding: 48px;">
          <div class="spinner"></div>
          <p style="margin-left: 16px;">Loading remotes...</p>
        </div>
      `;
      return;
    }

    // Show empty state
    if (this.remotes.length === 0) {
      this.container.innerHTML = `
        <div class="empty-state">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          <h2>No remotes configured</h2>
          <p>Add your first cloud storage remote to get started</p>
          <button class="btn btn-primary" id="add-remote-btn">Add Remote</button>
        </div>
      `;
      
      this.attachEmptyStateListeners();
      return;
    }

    // Render remotes list
    this.container.innerHTML = `
      <div class="remotes-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <h2>Cloud Storage Remotes</h2>
        <button class="btn btn-primary" id="add-remote-btn">Add Remote</button>
      </div>
      
      <div class="remotes-list">
        ${this.remotes.map(remote => this.renderRemoteCard(remote)).join('')}
      </div>
    `;

    this.attachEventListeners();
  }

  /**
   * Render a single remote card
   * @param {Object} remote - Remote object
   * @returns {string} HTML string
   */
  renderRemoteCard(remote) {
    const isLoadingStatus = remote.connectionStatus?.loading;
    
    let statusClass = 'status-loading';
    let statusText = 'Checking...';
    let statusIcon = '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>';
    
    if (!isLoadingStatus) {
      statusClass = remote.connectionStatus?.success ? 'status-online' : 'status-offline';
      statusText = remote.connectionStatus?.message || (remote.connectionStatus?.success ? 'Online' : 'Offline');
      statusIcon = remote.connectionStatus?.success 
        ? '<circle cx="12" cy="12" r="10"></circle><polyline points="9 12 11 14 15 10"></polyline>'
        : '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>';
    }

    const isLoadingQuota = remote.quota?.loading;
    let quotaText = 'Loading quota...';
    let quotaPercent = 0;
    
    if (!isLoadingQuota) {
      const total = Number(remote.quota?.total || 0);
      const used = Number(remote.quota?.used || 0);
      
      quotaText = remote.quota?.available 
        ? `${formatBytes(used)} / ${formatBytes(total)}`
        : 'Quota unavailable';
      
      quotaPercent = remote.quota?.available && total > 0
        ? Math.round((used / total) * 100)
        : 0;
    }

    return `
      <div class="remote-card" data-remote-name="${remote.name}">
        <div class="remote-header">
          <div class="remote-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </div>
          <div class="remote-info">
            <h3 class="remote-name">${remote.name}</h3>
            <p class="remote-type">${this.formatProviderName(remote.type)}</p>
          </div>
          <div class="remote-status ${statusClass}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${statusIcon}
            </svg>
            <span>${statusText}</span>
          </div>
        </div>
        
        <div class="remote-body">
          ${isLoadingQuota ? `
            <p class="quota-text">${quotaText}</p>
          ` : remote.quota?.available ? `
            <div class="remote-quota">
              <div class="quota-bar">
                <div class="quota-fill" style="width: ${quotaPercent}%"></div>
              </div>
              <p class="quota-text">${quotaText} (${quotaPercent}%)</p>
            </div>
          ` : `
            <p class="quota-text">${quotaText}</p>
          `}
          
          ${!isLoadingStatus && !remote.connectionStatus?.success && remote.connectionStatus?.error ? `
            <p class="remote-error">${remote.connectionStatus.message}</p>
          ` : ''}
        </div>
        
        <div class="remote-actions">
          <button class="btn btn-sm btn-secondary" data-action="test" data-remote-name="${remote.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            Test
          </button>
          <button class="btn btn-sm btn-secondary" data-action="details" data-remote-name="${remote.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            Details
          </button>
          <button class="btn btn-sm btn-secondary" data-action="edit" data-remote-name="${remote.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Edit
          </button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-remote-name="${remote.name}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Delete
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Format provider name for display
   * @param {string} type - Provider type
   * @returns {string} Formatted name
   */
  formatProviderName(type) {
    const names = {
      'koofr': 'Koofr',
      'blomp': 'Blomp',
      'filen': 'Filen'
    };
    return names[type] || type;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Add remote button
    const addRemoteBtn = document.getElementById('add-remote-btn');
    if (addRemoteBtn) {
      addRemoteBtn.addEventListener('click', () => {
        this.handleAddRemote();
      });
    }

    // Attach listeners to all currently rendered cards
    this.container.querySelectorAll('.remote-card').forEach(card => {
       this.attachCardEventListeners(card);
    });
  }

  /**
   * Attach event listeners to a specific card's buttons
   * @param {Element} card - Remote card element
   */
  attachCardEventListeners(card) {
    const actionButtons = card.querySelectorAll('[data-action]');
    actionButtons.forEach(btn => {
      // Remove old listener if re-attaching
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      
      newBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = newBtn.dataset.action;
        const remoteName = newBtn.dataset.remoteName;
        this.handleAction(action, remoteName);
      });
    });
  }

  /**
   * Attach empty state listeners
   */
  attachEmptyStateListeners() {
    const addRemoteBtn = document.getElementById('add-remote-btn');
    if (addRemoteBtn) {
      addRemoteBtn.addEventListener('click', () => {
        this.handleAddRemote();
      });
    }
  }

  /**
   * Handle action button click
   * @param {string} action - Action type (test, details, edit, delete)
   * @param {string} remoteName - Remote name
   */
  async handleAction(action, remoteName) {
    switch (action) {
      case 'test':
        await this.testConnection(remoteName);
        break;
      case 'details':
        await this.showDetails(remoteName);
        break;
      case 'edit':
        this.editRemote(remoteName);
        break;
      case 'delete':
        await this.deleteRemote(remoteName);
        break;
      default:
        console.warn('Unknown action:', action);
    }
  }

  /**
   * Handle add remote button click
   */
  handleAddRemote() {
    if (this.configWizard) {
      this.configWizard.show({
        onComplete: async (wizardData) => {
          showSuccess(`Remote "${wizardData.remoteName}" added successfully!`);
          await this.fetchRemotes();
        },
        onCancel: () => {
          // User cancelled, do nothing
        }
      });
    }
  }

  /**
   * Test connection to a remote
   * @param {string} remoteName - Remote name
   */
  async testConnection(remoteName) {
    try {
      showSuccess(`Testing connection to ${remoteName}...`);

      const response = await fetch(`/api/rclone/remotes/${remoteName}/test`, {
        method: 'POST'
      });

      const data = await response.json();

      if (data.success && data.data.success) {
        showSuccess(`Connection to ${remoteName} successful!`);
      } else {
        showError(`Connection to ${remoteName} failed: ${data.data.message || data.error}`);
      }

      // Re-fetch only this specific remote's status so the dashboard updates smoothly
      // First, set the specific remote to loading
      const index = this.remotes.findIndex(r => r.name === remoteName);
      if (index !== -1) {
        this.remotes[index].connectionStatus = { loading: true };
        this.remotes[index].quota = { loading: true };
        
        const cardElement = this.container.querySelector(`.remote-card[data-remote-name="${remoteName}"]`);
        if (cardElement) {
           const newCardHtml = this.renderRemoteCard(this.remotes[index]);
           const temp = document.createElement('div');
           temp.innerHTML = newCardHtml;
           const newCard = temp.firstElementChild;
           cardElement.replaceWith(newCard);
           this.attachCardEventListeners(newCard);
        }
      }

      await this.fetchSingleRemoteStatus(remoteName, true); // Force refresh on test

    } catch (error) {
      console.error('Test connection error:', error);
      showError(`Failed to test connection: ${error.message}`);
    }
  }

  /**
   * Show remote details
   * @param {string} remoteName - Remote name
   */
  async showDetails(remoteName) {
    if (this.detailsModal) {
      await this.detailsModal.show(remoteName);
    }
  }

  /**
   * Edit remote configuration
   * @param {string} remoteName - Remote name
   */
  editRemote(remoteName) {
    if (this.editModal) {
      this.editModal.show(remoteName, {
        onSave: async () => {
          // Force a status recheck for the edited remote
          const index = this.remotes.findIndex(r => r.name === remoteName);
          if (index !== -1) {
            this.remotes[index].connectionStatus = { loading: true };
            this.remotes[index].quota = { loading: true };
          }
          // Refresh remotes list after save
          await this.fetchRemotes();
        },
        onCancel: () => {
          // User cancelled, do nothing
        }
      });
    }
  }

  /**
   * Delete a remote
   * @param {string} remoteName - Remote name
   */
  async deleteRemote(remoteName) {
    // Check if remote is in use (for now, we'll assume it's not in use)
    // TODO: Implement actual check for active uploads
    const isInUse = false;

    // Show confirmation dialog
    this.deleteDialog.show(remoteName, {
      isInUse,
      onConfirm: async (name) => {
        await this.performDelete(name);
      },
      onCancel: () => {
        // User cancelled, do nothing
      }
    });
  }

  /**
   * Perform the actual deletion
   * @param {string} remoteName - Remote name
   */
  async performDelete(remoteName) {
    try {
      const response = await fetch(`/api/rclone/remotes/${remoteName}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        showSuccess(`Remote "${remoteName}" deleted successfully`);
        
        // Remove from global cache so it doesn't glitch if added again
        if (typeof globalRemotesStatusCache !== 'undefined') {
          delete globalRemotesStatusCache[remoteName];
        }
        
        // Refresh remotes list
        await this.fetchRemotes();
      } else {
        throw new Error(data.error || 'Failed to delete remote');
      }

    } catch (error) {
      console.error('Delete remote error:', error);
      showError(`Failed to delete remote: ${error.message}`);
    }
  }

  /**
   * Refresh remotes list
   */
  async refresh() {
    // Clear global cache for forced refresh
    for (const remote of this.remotes) {
       delete globalRemotesStatusCache[remote.name];
    }
    this.remotes = [];
    await this.fetchRemotes();
  }

  /**
   * Destroy component and cleanup
   */
  destroy() {
    // Destroy details modal
    if (this.detailsModal) {
      this.detailsModal.destroy();
      this.detailsModal = null;
    }

    // Destroy delete dialog
    if (this.deleteDialog) {
      this.deleteDialog.destroy();
      this.deleteDialog = null;
    }

    // Destroy config wizard
    if (this.configWizard) {
      this.configWizard.destroy();
      this.configWizard = null;
    }

    // Destroy edit modal
    if (this.editModal) {
      this.editModal.destroy();
      this.editModal = null;
    }

    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

export default RemoteList;
