/**
 * ErrorDisplay Component
 * Displays error messages with appropriate styling and retry options
 */

import ErrorHandler from '../utils/error-handler.js';

class ErrorDisplay {
  constructor() {
    this.container = null;
  }

  /**
   * Show error message
   * @param {HTMLElement} container - Container element
   * @param {Error|Object} error - Error object
   * @param {Function} onRetry - Retry callback (optional)
   */
  show(container, error, onRetry = null) {
    if (!container) return;

    this.container = container;

    const formattedError = ErrorHandler.formatError(error);

    container.innerHTML = `
      <div class="error-display ${formattedError.type}">
        <div class="error-icon">
          ${formattedError.icon}
        </div>
        <div class="error-content">
          <h4 class="error-title">Error</h4>
          <p class="error-message">${formattedError.message}</p>
          ${formattedError.suggestions && formattedError.suggestions.length > 0 ? `
            <div class="error-suggestions">
              <p class="suggestions-title">Suggestions:</p>
              <ul>
                ${formattedError.suggestions.map(s => `<li>${s}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${formattedError.retryable && onRetry ? `
            <button class="btn btn-sm btn-secondary retry-btn">Retry</button>
          ` : ''}
        </div>
      </div>
    `;

    // Attach retry button listener
    if (formattedError.retryable && onRetry) {
      const retryBtn = container.querySelector('.retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          this.hide();
          onRetry();
        });
      }
    }
  }

  /**
   * Show field-specific error
   * @param {HTMLElement} fieldElement - Field element
   * @param {string} errorMessage - Error message
   */
  showFieldError(fieldElement, errorMessage) {
    if (!fieldElement) return;

    // Remove existing error
    this.clearFieldError(fieldElement);

    // Add error class to field
    fieldElement.classList.add('error');

    // Create error message element
    const errorElement = document.createElement('div');
    errorElement.className = 'field-error';
    errorElement.textContent = errorMessage;

    // Insert after field
    fieldElement.parentNode.insertBefore(errorElement, fieldElement.nextSibling);
  }

  /**
   * Clear field-specific error
   * @param {HTMLElement} fieldElement - Field element
   */
  clearFieldError(fieldElement) {
    if (!fieldElement) return;

    // Remove error class
    fieldElement.classList.remove('error');

    // Remove error message
    const errorElement = fieldElement.parentNode.querySelector('.field-error');
    if (errorElement) {
      errorElement.remove();
    }
  }

  /**
   * Show inline error in a form
   * @param {HTMLElement} formElement - Form element
   * @param {Object} errors - Field errors object
   */
  showFormErrors(formElement, errors) {
    if (!formElement || !errors) return;

    // Clear existing errors
    this.clearFormErrors(formElement);

    // Show each field error
    Object.entries(errors).forEach(([fieldName, errorMessage]) => {
      const fieldElement = formElement.querySelector(`[name="${fieldName}"], #${fieldName}`);
      if (fieldElement) {
        this.showFieldError(fieldElement, errorMessage);
      }
    });
  }

  /**
   * Clear all form errors
   * @param {HTMLElement} formElement - Form element
   */
  clearFormErrors(formElement) {
    if (!formElement) return;

    // Remove all error classes
    const errorFields = formElement.querySelectorAll('.error');
    errorFields.forEach(field => {
      field.classList.remove('error');
    });

    // Remove all error messages
    const errorMessages = formElement.querySelectorAll('.field-error');
    errorMessages.forEach(msg => {
      msg.remove();
    });
  }

  /**
   * Hide error display
   */
  hide() {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
  }

  /**
   * Clear error display
   */
  clear() {
    this.hide();
  }
}

export default ErrorDisplay;
