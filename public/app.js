// StreamFun Frontend JavaScript

const API_BASE = 'http://localhost:3000/api';

// Handle file selection to show/hide collection name field
function handleFileSelect() {
  const fileInput = document.getElementById('file-input');
  const collectionGroup = document.getElementById('collection-group');
  
  if (fileInput.files && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    const mimeType = file.type;
    
    // Show collection name field for images
    if (mimeType.startsWith('image/')) {
      collectionGroup.style.display = 'block';
    } else {
      collectionGroup.style.display = 'none';
    }
  }
}

// Tab switching
function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected tab
  document.getElementById(`${tabName}-tab`).classList.add('active');
  document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
  
  // Load data for the tab
  if (tabName === 'files') {
    loadFiles();
  } else if (tabName === 'accounts') {
    loadAccounts();
  } else if (tabName === 'dashboard') {
    loadDashboard();
  }
}

// Upload file using chunked upload
async function uploadFile() {
  const fileInput = document.getElementById('file-input');
  const provider = document.getElementById('provider-select').value;
  const encrypt = document.getElementById('encrypt-checkbox').checked;
  const collectionInput = document.getElementById('collection-input');
  const alertDiv = document.getElementById('upload-alert');
  const progressDiv = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  
  if (!fileInput.files || fileInput.files.length === 0) {
    showAlert('Please select a file', 'error');
    return;
  }
  
  const file = fileInput.files[0];
  const chunkSize = 10 * 1024 * 1024; // 10 MB chunks
  const totalChunks = Math.ceil(file.size / chunkSize);
  
  // Get collection name if it's an image
  const collectionName = file.type.startsWith('image/') ? collectionInput.value : undefined;
  
  try {
    alertDiv.innerHTML = '';
    progressDiv.style.display = 'block';
    progressFill.style.width = '0%';
    progressFill.textContent = '0%';
    
    // Step 1: Initialize chunked upload
    const initBody = {
      filename: file.name,
      size: file.size,
      chunkSize: chunkSize,
      provider: provider,
      mimeType: file.type,
      encrypt: encrypt
    };
    
    // Add collection name if provided
    if (collectionName) {
      initBody.collectionName = collectionName;
    }
    
    const initResponse = await fetch(`${API_BASE}/files/upload/chunked/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initBody)
    });
    
    if (!initResponse.ok) {
      throw new Error('Failed to initialize upload');
    }
    
    const { fileId } = await initResponse.json();
    console.log('Upload initialized:', fileId);
    
    // Step 2: Upload chunks
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      
      const chunkResponse = await fetch(`${API_BASE}/files/upload/chunked/${fileId}/chunk/${i}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk
      });
      
      if (!chunkResponse.ok) {
        throw new Error(`Failed to upload chunk ${i + 1}`);
      }
      
      // Update progress
      const progress = Math.round(((i + 1) / totalChunks) * 100);
      progressFill.style.width = `${progress}%`;
      progressFill.textContent = `${progress}%`;
    }
    
    // Step 3: Complete upload
    const completeResponse = await fetch(`${API_BASE}/files/upload/chunked/${fileId}/complete`, {
      method: 'POST'
    });
    
    if (!completeResponse.ok) {
      throw new Error('Failed to complete upload');
    }
    
    const result = await completeResponse.json();
    console.log('Upload complete:', result);
    
    showAlert('File uploaded successfully!', 'success');
    fileInput.value = '';
    
    setTimeout(() => {
      progressDiv.style.display = 'none';
    }, 2000);
    
  } catch (error) {
    console.error('Upload error:', error);
    showAlert(`Upload failed: ${error.message}`, 'error');
    progressDiv.style.display = 'none';
  }
}

// Load files list
async function loadFiles() {
  const listDiv = document.getElementById('files-list');
  
  try {
    listDiv.innerHTML = '<div class="empty-state">Loading...</div>';
    
    const response = await fetch(`${API_BASE}/files`);
    if (!response.ok) {
      throw new Error('Failed to load files');
    }
    
    const data = await response.json();
    
    if (data.files.length === 0) {
      listDiv.innerHTML = '<div class="empty-state">No files uploaded yet</div>';
      return;
    }
    
    listDiv.innerHTML = data.files.map(file => {
      const isVideo = file.mimeType?.startsWith('video/');
      const isImage = file.mimeType?.startsWith('image/');
      const hasThumbnail = file.thumbnail;
      
      let thumbnailHtml = '';
      if (hasThumbnail) {
        thumbnailHtml = `<img src="${file.thumbnail}" alt="Thumbnail" style="width: 120px; height: 68px; object-fit: cover; border-radius: 4px; margin-right: 15px; cursor: pointer;" onclick="playMedia('${file.id}', '${isVideo ? 'video' : 'image'}', '${escapeHtml(file.filename)}')" />`;
      }
      
      return `
        <div class="file-item">
          ${thumbnailHtml}
          <div class="file-info">
            <div class="file-name">${escapeHtml(file.filename)}</div>
            <div class="file-meta">
              ${formatBytes(file.size)} • ${file.provider} • 
              ${file.encrypted ? '🔒 Encrypted' : 'Not encrypted'} • 
              ${new Date(file.uploadedAt).toLocaleString()}
            </div>
          </div>
          <div class="file-actions">
            ${(isVideo || isImage) ? `<button onclick="playMedia('${file.id}', '${isVideo ? 'video' : 'image'}', '${escapeHtml(file.filename)}')" class="btn-secondary">Play</button>` : ''}
            <button onclick="downloadFile('${file.id}', '${escapeHtml(file.filename)}')" class="btn-secondary">Download</button>
            <button onclick="deleteFile('${file.id}')" class="btn-danger">Delete</button>
          </div>
        </div>
      `;
    }).join('');
    
  } catch (error) {
    console.error('Load files error:', error);
    listDiv.innerHTML = `<div class="empty-state">Error loading files: ${error.message}</div>`;
  }
}

// Download file
async function downloadFile(fileId, filename) {
  try {
    const response = await fetch(`${API_BASE}/files/${fileId}/download`);
    if (!response.ok) {
      throw new Error('Failed to download file');
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
    
  } catch (error) {
    console.error('Download error:', error);
    alert(`Download failed: ${error.message}`);
  }
}

// Get streaming link
async function getStreamLink(fileId) {
  try {
    const response = await fetch(`${API_BASE}/files/${fileId}/stream`);
    if (!response.ok) {
      throw new Error('Failed to get streaming link');
    }
    
    const data = await response.json();
    prompt('Streaming URL (copy to clipboard):', data.url);
    
  } catch (error) {
    console.error('Stream link error:', error);
    alert(`Failed to get streaming link: ${error.message}`);
  }
}

// Delete file
async function deleteFile(fileId) {
  if (!confirm('Are you sure you want to delete this file?')) {
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/files/${fileId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete file');
    }
    
    loadFiles();
    
  } catch (error) {
    console.error('Delete error:', error);
    alert(`Delete failed: ${error.message}`);
  }
}

// Load accounts
async function loadAccounts() {
  const listDiv = document.getElementById('accounts-list');
  
  try {
    listDiv.innerHTML = '<div class="empty-state">Loading...</div>';
    
    const response = await fetch(`${API_BASE}/accounts`);
    if (!response.ok) {
      throw new Error('Failed to load accounts');
    }
    
    const data = await response.json();
    
    if (data.accounts.length === 0) {
      listDiv.innerHTML = '<div class="empty-state">No accounts configured</div>';
      return;
    }
    
    listDiv.innerHTML = data.accounts.map(account => `
      <div class="account-item">
        <div class="account-info">
          <div class="account-name">${account.provider}</div>
          <div class="account-meta">
            Status: ${account.status} • 
            Quota: ${formatBytes(account.quotaUsed || 0)} / ${formatBytes(account.quotaTotal || 0)} 
            (${account.quotaPercent?.toFixed(1) || 0}%)
          </div>
        </div>
        <div class="account-actions">
          <button onclick="deleteAccount('${account.id}')" class="btn-danger">Delete</button>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Load accounts error:', error);
    listDiv.innerHTML = `<div class="empty-state">Error loading accounts: ${error.message}</div>`;
  }
}

// Show add account form
function showAddAccount() {
  document.getElementById('add-account-form').style.display = 'block';
}

// Hide add account form
function hideAddAccount() {
  document.getElementById('add-account-form').style.display = 'none';
}

// Add account
async function addAccount() {
  const provider = document.getElementById('account-provider').value;
  const remoteName = document.getElementById('remote-name').value;
  const remotePath = document.getElementById('remote-path').value;
  
  if (!remoteName) {
    alert('Please enter rclone remote name');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: provider,
        remoteName: remoteName,
        remotePath: remotePath || 'streamfun'
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to add account');
    }
    
    hideAddAccount();
    loadAccounts();
    alert('Account added successfully!');
    
  } catch (error) {
    console.error('Add account error:', error);
    alert(`Failed to add account: ${error.message}`);
  }
}

// Delete account
async function deleteAccount(accountId) {
  if (!confirm('Are you sure you want to delete this account?')) {
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/accounts/${accountId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete account');
    }
    
    loadAccounts();
    
  } catch (error) {
    console.error('Delete account error:', error);
    alert(`Delete failed: ${error.message}`);
  }
}

// Load dashboard stats
async function loadDashboard() {
  try {
    const response = await fetch(`${API_BASE}/dashboard/stats`);
    if (!response.ok) {
      throw new Error('Failed to load dashboard stats');
    }
    
    const data = await response.json();
    
    document.getElementById('stat-files').textContent = data.files.total;
    document.getElementById('stat-size').textContent = formatBytes(data.files.totalSize);
    document.getElementById('stat-accounts').textContent = data.accounts.total;
    document.getElementById('stat-active').textContent = data.accounts.active;
    
  } catch (error) {
    console.error('Load dashboard error:', error);
    document.getElementById('stat-files').textContent = 'Error';
  }
}

// Utility functions
function showAlert(message, type) {
  const alertDiv = document.getElementById('upload-alert');
  alertDiv.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
  
  setTimeout(() => {
    alertDiv.innerHTML = '';
  }, 5000);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Load initial data
document.addEventListener('DOMContentLoaded', () => {
  console.log('StreamFun Frontend loaded');
});

// Play media (video or image) in modal
function playMedia(fileId, type, filename) {
  const streamUrl = `${API_BASE}/files/${fileId}/play`;
  
  // Create modal
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    max-width: 90%;
    max-height: 90%;
    position: relative;
  `;
  
  if (type === 'video') {
    content.innerHTML = `
      <video controls autoplay style="max-width: 100%; max-height: 90vh;">
        <source src="${streamUrl}" type="video/mp4">
        Your browser does not support video playback.
      </video>
      <button onclick="this.parentElement.parentElement.remove()" style="position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.9); border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px;">Close</button>
    `;
  } else {
    content.innerHTML = `
      <img src="${streamUrl}" alt="${filename}" style="max-width: 100%; max-height: 90vh; border-radius: 4px;">
      <button onclick="this.parentElement.parentElement.remove()" style="position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.9); border: none; padding: 10px 15px; cursor: pointer; border-radius: 4px;">Close</button>
    `;
  }
  
  modal.appendChild(content);
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  document.body.appendChild(modal);
}
