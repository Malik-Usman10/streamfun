import { createElement } from '../utils/dom.js';
import api from '../api.js';
import { showSuccess, showError } from '../utils/dom.js';

class LoginView {
  constructor() {
    this.container = createElement('div', { className: 'login-container' });
  }

  render(parentElement) {
    this.container.innerHTML = `
      <div class="login-card">
        <div class="login-header">
          <svg class="login-logo" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
          </svg>
          <h1 class="login-title">StreamFun</h1>
          <p class="login-subtitle">Please sign in to access your media</p>
        </div>
        
        <form id="login-form" class="login-form">
          <div class="form-group">
            <label for="password">Admin Password</label>
            <input 
              type="password" 
              id="password" 
              required 
              placeholder="Enter your password"
              autocomplete="current-password"
            >
          </div>
          
          <button type="submit" class="btn btn-primary btn-block login-btn">
            Sign In
            <span class="spinner" id="login-spinner" style="display: none; width: 16px; height: 16px; margin-left: 8px;"></span>
          </button>
        </form>
      </div>
    `;

    parentElement.innerHTML = '';
    parentElement.appendChild(this.container);

    this.attachEventListeners();
  }

  attachEventListeners() {
    const form = this.container.querySelector('#login-form');
    const passwordInput = this.container.querySelector('#password');
    const spinner = this.container.querySelector('#login-spinner');
    const submitBtn = this.container.querySelector('.login-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const password = passwordInput.value;
      if (!password) return;

      try {
        submitBtn.disabled = true;
        spinner.style.display = 'inline-block';

        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (response.ok) {
          showSuccess('Logged in successfully');
          // Reload the page to initialize the app normally
          window.location.href = '/';
        } else {
          showError(data.error || 'Login failed');
          passwordInput.value = '';
          passwordInput.focus();
        }
      } catch (error) {
        showError('Network error during login');
      } finally {
        submitBtn.disabled = false;
        spinner.style.display = 'none';
      }
    });
    
    // Auto-focus password field
    setTimeout(() => passwordInput.focus(), 100);
  }
}

export default LoginView;
