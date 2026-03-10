/**
 * DOM Manipulation Helpers
 * Utilities for creating elements, showing notifications, and managing modals
 */

/**
 * Create an element with attributes and children
 * @param {string} tag - HTML tag name
 * @param {Object} attributes - Element attributes
 * @param {Array|string} children - Child elements or text content
 * @returns {HTMLElement} Created element
 */
export function createElement(tag, attributes = {}, children = []) {
  const element = document.createElement(tag);

  // Set attributes
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'dataset') {
      Object.entries(value).forEach(([dataKey, dataValue]) => {
        element.dataset[dataKey] = dataValue;
      });
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.substring(2).toLowerCase();
      element.addEventListener(eventName, value);
    } else {
      element.setAttribute(key, value);
    }
  });

  // Add children
  if (typeof children === 'string') {
    element.textContent = children;
  } else if (Array.isArray(children)) {
    children.forEach(child => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof HTMLElement) {
        element.appendChild(child);
      }
    });
  }

  return element;
}

/**
 * Show notification message
 * @param {string} message - Notification message
 * @param {Object} options - Notification options
 */
export function showNotification(message, options = {}) {
  const {
    type = 'info',        // 'success', 'error', 'warning', 'info'
    duration = 5000,      // Duration in ms (0 = permanent)
    action = null,        // Action button text
    onAction = null       // Action button callback
  } = options;

  // Create notification container if it doesn't exist
  let container = document.getElementById('notification-container');
  if (!container) {
    container = createElement('div', {
      id: 'notification-container',
      className: 'notification-container',
      style: {
        position: 'fixed',
        top: '80px',
        right: '20px',
        zIndex: '9999',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        maxWidth: '400px'
      }
    });
    document.body.appendChild(container);
  }

  // Create notification element
  const notification = createElement('div', {
    className: `notification notification-${type} notification-enter`,
    style: {
      padding: '16px',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      backgroundColor: type === 'success' ? 'rgba(16, 185, 129, 0.1)' :
                       type === 'error' ? 'rgba(239, 68, 68, 0.1)' :
                       type === 'warning' ? 'rgba(245, 158, 11, 0.1)' :
                       'rgba(59, 130, 246, 0.1)',
      border: `1px solid ${type === 'success' ? 'rgba(16, 185, 129, 0.3)' :
                           type === 'error' ? 'rgba(239, 68, 68, 0.3)' :
                           type === 'warning' ? 'rgba(245, 158, 11, 0.3)' :
                           'rgba(59, 130, 246, 0.3)'}`,
      color: 'var(--text-primary)'
    }
  });

  // Message
  const messageEl = createElement('div', {
    className: 'notification-message',
    style: { flex: '1', fontSize: '14px' }
  }, message);

  notification.appendChild(messageEl);

  // Action button
  if (action && onAction) {
    const actionBtn = createElement('button', {
      className: 'notification-action',
      style: {
        padding: '4px 12px',
        fontSize: '12px',
        fontWeight: '500',
        borderRadius: '4px',
        backgroundColor: 'var(--color-primary)',
        color: 'white',
        cursor: 'pointer'
      },
      onClick: () => {
        onAction();
        removeNotification(notification);
      }
    }, action);

    notification.appendChild(actionBtn);
  }

  // Close button
  const closeBtn = createElement('button', {
    className: 'notification-close',
    'aria-label': 'Close notification',
    style: {
      padding: '4px',
      cursor: 'pointer',
      color: 'var(--text-tertiary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    onClick: () => removeNotification(notification)
  });

  closeBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  notification.appendChild(closeBtn);

  // Add to container
  container.appendChild(notification);

  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      removeNotification(notification);
    }, duration);
  }

  return notification;
}

/**
 * Remove notification with animation
 * @param {HTMLElement} notification - Notification element to remove
 */
function removeNotification(notification) {
  notification.classList.add('notification-exit');
  
  setTimeout(() => {
    notification.remove();
    
    // Remove container if empty
    const container = document.getElementById('notification-container');
    if (container && container.children.length === 0) {
      container.remove();
    }
  }, 200);
}

/**
 * Show success notification
 * @param {string} message - Success message
 * @param {Object} options - Additional options
 */
export function showSuccess(message, options = {}) {
  return showNotification(message, { ...options, type: 'success' });
}

/**
 * Show error notification
 * @param {string} message - Error message
 * @param {Object} options - Additional options
 */
export function showError(message, options = {}) {
  return showNotification(message, { ...options, type: 'error', duration: 0 });
}

/**
 * Show warning notification
 * @param {string} message - Warning message
 * @param {Object} options - Additional options
 */
export function showWarning(message, options = {}) {
  return showNotification(message, { ...options, type: 'warning' });
}

/**
 * Show info notification
 * @param {string} message - Info message
 * @param {Object} options - Additional options
 */
export function showInfo(message, options = {}) {
  return showNotification(message, { ...options, type: 'info' });
}

/**
 * Open modal with animation
 * @param {HTMLElement} modal - Modal element
 */
export function openModal(modal) {
  if (!modal) return;

  modal.classList.add('active');
  modal.classList.add('opening');
  document.body.style.overflow = 'hidden';

  // Remove opening class after animation
  setTimeout(() => {
    modal.classList.remove('opening');
  }, 300);
}

/**
 * Close modal with animation
 * @param {HTMLElement} modal - Modal element
 */
export function closeModal(modal) {
  if (!modal) return;

  modal.classList.add('closing');

  setTimeout(() => {
    modal.classList.remove('active');
    modal.classList.remove('closing');
    document.body.style.overflow = '';
  }, 200);
}

/**
 * Trap focus within an element (for modals)
 * @param {HTMLElement} element - Element to trap focus within
 * @returns {Function} Cleanup function
 */
export function trapFocus(element) {
  // Save the currently focused element to restore later
  const previouslyFocused = document.activeElement;

  const focusableElements = element.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  function handleTabKey(e) {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  }

  element.addEventListener('keydown', handleTabKey);

  // Focus first element
  if (firstFocusable) {
    firstFocusable.focus();
  }

  // Return cleanup function that restores focus
  return () => {
    element.removeEventListener('keydown', handleTabKey);
    
    // Restore focus to previously focused element
    if (previouslyFocused && previouslyFocused.focus) {
      previouslyFocused.focus();
    }
  };
}

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in ms
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
  let inThrottle;
  
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Query selector with error handling
 * @param {string} selector - CSS selector
 * @param {HTMLElement} parent - Parent element (default: document)
 * @returns {HTMLElement|null} Found element or null
 */
export function qs(selector, parent = document) {
  try {
    return parent.querySelector(selector);
  } catch (error) {
    console.error(`Invalid selector: ${selector}`, error);
    return null;
  }
}

/**
 * Query selector all with error handling
 * @param {string} selector - CSS selector
 * @param {HTMLElement} parent - Parent element (default: document)
 * @returns {Array} Array of found elements
 */
export function qsa(selector, parent = document) {
  try {
    return Array.from(parent.querySelectorAll(selector));
  } catch (error) {
    console.error(`Invalid selector: ${selector}`, error);
    return [];
  }
}
