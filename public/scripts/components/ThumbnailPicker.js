/**
 * Thumbnail Picker Component
 * Allows users to regenerate thumbnails and pick from multiple candidates (for videos)
 */

import api from '../api.js';
import { createElement, openModal, closeModal, showSuccess, showError } from '../utils/dom.js';

class ThumbnailPicker {
  constructor() {
    this.modal = null;
    this.currentFile = null;
    this.onUpdate = null;
    this.selectedThumbnail = null;
    
    this.init();
  }

  init() {
    this.createModal();
  }

  createModal() {
    this.modal = createElement('div', { className: 'modal-overlay thumbnail-picker-modal' });
    
    const content = createElement('div', { className: 'modal-content thumbnail-picker-content' });
    
    // Header
    const header = createElement('div', { className: 'modal-header' });
    header.innerHTML = `
      <h2>Regenerate Thumbnail</h2>
      <button class="modal-close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;
    
    header.querySelector('.modal-close').onclick = () => this.close();
    
    // Body
    const body = createElement('div', { className: 'modal-body' });
    body.innerHTML = `
      <p style="color:var(--text-secondary);margin-bottom:1rem;">
        Generate a new high-quality thumbnail. For videos, you can pick from several frames.
      </p>
      <div class="thumbnail-loading-canvas">
        <div class="thumbnail-spinner"></div>
        <p style="color:var(--text-secondary);">Analysing media frames...</p>
      </div>
      <div class="thumbnail-picker-grid" style="display:none;"></div>
    `;
    
    // Footer
    const footer = createElement('div', { className: 'modal-footer' });
    const cancelBtn = createElement('button', { className: 'btn btn-secondary' }, 'Cancel');
    cancelBtn.onclick = () => this.close();
    
    const saveBtn = createElement('button', { 
        className: 'btn btn-primary', 
        style: { display: 'none' } 
    }, 'Apply Selected');
    saveBtn.onclick = () => this.handleSave();
    
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    
    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    this.modal.appendChild(content);
    
    document.body.appendChild(this.modal);
    
    this.elements = {
        grid: body.querySelector('.thumbnail-picker-grid'),
        loading: body.querySelector('.thumbnail-loading-canvas'),
        saveBtn: saveBtn
    };
  }

  async open(file, onUpdate) {
    this.currentFile = file;
    this.onUpdate = onUpdate;
    this.selectedThumbnail = null;
    this.elements.saveBtn.style.display = 'none';
    this.elements.loading.style.display = 'flex';
    this.elements.grid.style.display = 'none';
    this.elements.grid.innerHTML = '';
    
    openModal(this.modal);
    
    try {
        const { candidates } = await api.fetchThumbnailCandidates(file.id);
        
        this.elements.loading.style.display = 'none';
        this.elements.grid.style.display = 'grid';
        
        if (!candidates || candidates.length === 0) {
            this.elements.grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding: 2rem;">Failed to generate candidates.</p>';
            return;
        }

        candidates.forEach((src, idx) => {
            const option = createElement('div', { 
                className: `thumbnail-option ${candidates.length === 1 ? 'selected' : ''}`,
                dataset: { index: idx }
            });
            
            if (candidates.length === 1) this.selectedThumbnail = src;

            const img = createElement('img', { src, alt: `Candidate ${idx + 1}` });
            const badge = createElement('div', { className: 'selection-badge' });
            badge.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:12px;height:12px;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;
            
            option.appendChild(img);
            option.appendChild(badge);
            
            option.onclick = () => {
                this.modal.querySelectorAll('.thumbnail-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                this.selectedThumbnail = src;
                this.elements.saveBtn.style.display = 'block';
            };
            
            this.elements.grid.appendChild(option);
        });

        if (candidates.length === 1 || this.selectedThumbnail) {
            this.elements.saveBtn.style.display = 'block';
        }

    } catch (err) {
        console.error('Picker error:', err);
        showError('Failed to load thumbnail candidates');
        this.close();
    }
  }

  async handleSave() {
    if (!this.selectedThumbnail || !this.currentFile) return;
    
    try {
        this.elements.saveBtn.disabled = true;
        this.elements.saveBtn.textContent = 'Applying...';
        
        await api.applyThumbnail(this.currentFile.id, this.selectedThumbnail);
        
        if (this.onUpdate) {
            this.onUpdate(this.selectedThumbnail);
        }
        
        showSuccess('Thumbnail updated successfully');
        this.close();
    } catch (err) {
        showError('Failed to apply thumbnail');
    } finally {
        this.elements.saveBtn.disabled = false;
        this.elements.saveBtn.textContent = 'Apply Selected';
    }
  }

  close() {
    closeModal(this.modal);
  }
}

// Singleton instance
const thumbnailPicker = new ThumbnailPicker();
export default thumbnailPicker;
