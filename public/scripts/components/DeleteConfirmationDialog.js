/**
 * DeleteConfirmationDialog Component
 * Confirmation dialog for deleting remotes
 */

import { trapFocus } from '../utils/dom.js';

class DeleteConfirmationDialog {
  constructor() {
    this.modal = null;
    this.focusTrap = null;
    this.onConfirm = null;
    this.onCancel = null;
    this.remoteName = null;
    this.isInUse = false;
    
    this.createModal();
  }

  /**
   * Create modal element
   */
  createModal() {
    // Create modal overlay
    this.modal = document.createElement('div');
    this.modal.className = 'modal-overlay delete-confirmation-modal';
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-labelledby', 'delete-confirmation-title');
    
    this.modal.innerHTML = `
      <div class="modal-content modal-small">
        <div class="modal-header">
          <h2 id="delete-confirmation-title">Confirm Deletion</h2>
          <button class="modal-close" id="delete-confirmation-close" aria-label="Close dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div class="modal-body" id="delete-confirmation-body">
          <!-- Content will be dynamically inserted -->
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-secondary" id="delete-cancel-btn">Cancel</button>
          <button class="btn btn-danger" id="delete-confirm-btn">Delete</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.modal);
    
    this.attachEventListeners();
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button
    const closeButton = this.modal.querySelector('#delete-confirmation-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        this.handleCancel();
      });
    }

    // Cancel button
    const cancelButton = this.modal.querySelector('#delete-cancel-btn');
    if (cancelButton) {
      cancelButton.addEventListener('click', () => {
        this.handleCancel();
      });
    }

    // Confirm button
    const confirmButton = this.modal.querySelector('#delete-confirm-btn');
    if (confirmButton) {
      confirmButton.addEventListener('click', () => {
        this.handleConfirm();
      });
    }

    // Backdrop click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.handleCancel();
      }
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal.classList.contains('active')) {
        this.handleCancel();
      }
    });
  }

  /**
   * Show confirmation dialog
   * @param {string} remoteName - Remote name to delete
   * @param {Object} options - Options
   * @param {boolean} options.isInUse - Whether remote is in use
   * @param {Function} options.onConfirm - Callback on confirm
   * @param {Function} options.onCancel - Callback on cancel
   */
  show(remoteName, options = {}) {
    this.remoteName = remoteName;
    this.isInUse = options.isInUse || false;
    this.onConfirm = options.onConfirm || null;
    this.onCancel = options.onCancel || null;
    
    this.render();
    this.open();
  }

  /**
   * Render modal content
   */
  render() {
    const body = this.modal.querySelector('#delete-confirmation-body');
    if (!body) return;

    if (this.isInUse) {
      // Show warning if remote is in use
      body.innerHTML = `
        <div class="warning-message">
          <svg class="warning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <div class="warning-content">
            <h3>Remote is currently in use</h3>
            <p>The remote <strong>"${this.remoteName}"</strong> is currently being used for active uploads or operations.</p>
            <p>Deleting it now may cause these operations to fail. Please wait for ongoing operations to complete before deleting this remote.</p>
          </div>
        </div>
      `;

      // Disable confirm button
      const confirmButton = this.modal.querySelector('#delete-confirm-btn');
      if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.textContent = 'Cannot Delete';
      }
    } else {
      // Show normal confirmation
      body.innerHTML = `
        <div class="confirmation-message">
          <svg class="confirmation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div class="confirmation-content">
            <p>Are you sure you want to delete the remote <strong>"${this.remoteName}"</strong>?</p>
            <p class="confirmation-warning">This action cannot be undone. The remote configuration and associated account data will be permanently removed.</p>
          </div>
        </div>
      `;

      // Enable confirm button
      const confirmButton = this.modal.querySelector('#delete-confirm-btn');
      if (confirmButton) {
        confirmButton.disabled = false;
        confirmButton.textContent = 'Delete';
      }
    }
  }

  /**
   * Handle confirm button click
   */
  handleConfirm() {
    if (this.isInUse) {
      // Don't allow deletion if in use
      return;
    }

    if (this.onConfirm) {
      this.onConfirm(this.remoteName);
    }

    this.close();
  }

  /**
   * Handle cancel button click
   */
  handleCancel() {
    if (this.onCancel) {
      this.onCancel();
    }

    this.close();
  }

  /**
   * Open modal
   */
  open() {
    this.modal.classList.add('active');
    this.modal.classList.add('opening');
    document.body.style.overflow = 'hidden';

    // Set up focus trap
    this.focusTrap = trapFocus(this.modal);

    // Remove opening class after animation
    setTimeout(() => {
      this.modal.classList.remove('opening');
    }, 300);

    // Focus on cancel button by default
    const cancelButton = this.modal.querySelector('#delete-cancel-btn');
    if (cancelButton) {
      setTimeout(() => cancelButton.focus(), 100);
    }
  }

  /**
   * Close modal
   */
  close() {
    this.modal.classList.add('closing');

    // Remove focus trap
    if (this.focusTrap) {
      this.focusTrap();
      this.focusTrap = null;
    }

    setTimeout(() => {
      this.modal.classList.remove('active');
      this.modal.classList.remove('closing');
      document.body.style.overflow = '';
      
      // Reset state
      this.remoteName = null;
      this.isInUse = false;
      this.onConfirm = null;
      this.onCancel = null;
    }, 200);
  }

  /**
   * Check if modal is open
   * @returns {boolean}
   */
  isOpen() {
    return this.modal.classList.contains('active');
  }

  /**
   * Destroy modal and cleanup
   */
  destroy() {
    if (this.isOpen()) {
      this.close();
    }

    if (this.modal && this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }

    this.modal = null;
    this.focusTrap = null;
    this.onConfirm = null;
    this.onCancel = null;
  }
}

export default DeleteConfirmationDialog;
