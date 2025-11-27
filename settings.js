/**
 * Settings functionality for BWE (Big Wheel of Excitement)
 * Adds a settings icon and modal for customizing wheel names, title, and subtitle
 */

(function() {
  'use strict';

  // Configuration key for localStorage
  const STORAGE_KEY = 'bwe_settings';

  // Default settings
  const DEFAULT_SETTINGS = {
    title: 'BIG WHEEL',
    subtitle: 'OF EXCITEMENT',
    names: []
  };

  // Initialize settings from localStorage or defaults
  function getSettings() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
    return { ...DEFAULT_SETTINGS };
  }

  // Save settings to localStorage
  function saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return true;
    } catch (e) {
      console.error('Error saving settings:', e);
      return false;
    }
  }

  // Create settings icon
  function createSettingsIcon() {
    const icon = document.createElement('button');
    icon.id = 'bwe-settings-icon';
    icon.className = 'bwe-settings-icon';
    icon.innerHTML = '⚙️';
    icon.title = 'Settings';
    icon.setAttribute('aria-label', 'Open settings');

    icon.addEventListener('click', () => {
      openSettingsModal();
    });

    return icon;
  }

  // Create settings modal
  function createSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'bwe-settings-modal';
    modal.className = 'bwe-modal';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="bwe-modal-content">
        <div class="bwe-modal-header">
          <h2>⚙️ Settings</h2>
          <button class="bwe-modal-close" aria-label="Close settings">&times;</button>
        </div>

        <div class="bwe-modal-body">
          <!-- Title and Subtitle Section -->
          <div class="bwe-settings-section">
            <h3>Wheel Text</h3>

            <div class="bwe-form-group">
              <label for="bwe-title-input">Title:</label>
              <input
                type="text"
                id="bwe-title-input"
                class="bwe-input"
                placeholder="Enter title"
                maxlength="50"
              />
            </div>

            <div class="bwe-form-group">
              <label for="bwe-subtitle-input">Subtitle:</label>
              <input
                type="text"
                id="bwe-subtitle-input"
                class="bwe-input"
                placeholder="Enter subtitle"
                maxlength="50"
              />
            </div>
          </div>

          <!-- Names Section -->
          <div class="bwe-settings-section">
            <div class="bwe-section-header">
              <h3>Wheel Names</h3>
              <button id="bwe-add-name-btn" class="bwe-btn bwe-btn-secondary">
                ➕ Add Name
              </button>
            </div>

            <div id="bwe-names-list" class="bwe-names-list">
              <!-- Names will be added dynamically -->
            </div>
          </div>
        </div>

        <div class="bwe-modal-footer">
          <button id="bwe-reset-btn" class="bwe-btn bwe-btn-danger">
            Reset to Default
          </button>
          <button id="bwe-save-btn" class="bwe-btn bwe-btn-primary">
            Save Changes
          </button>
        </div>
      </div>
    `;

    // Close button handler
    modal.querySelector('.bwe-modal-close').addEventListener('click', closeSettingsModal);

    // Click outside modal to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeSettingsModal();
      }
    });

    // Add name button handler
    modal.querySelector('#bwe-add-name-btn').addEventListener('click', () => {
      addNameRow('');
    });

    // Save button handler
    modal.querySelector('#bwe-save-btn').addEventListener('click', saveSettingsFromModal);

    // Reset button handler
    modal.querySelector('#bwe-reset-btn').addEventListener('click', resetSettings);

    return modal;
  }

  // Add a name row to the list
  function addNameRow(name = '', focus = true) {
    const namesList = document.getElementById('bwe-names-list');
    const row = document.createElement('div');
    row.className = 'bwe-name-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'bwe-input bwe-name-input';
    input.placeholder = 'Enter name';
    input.value = name;
    input.maxLength = 50;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'bwe-btn bwe-btn-danger bwe-btn-icon';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.title = 'Remove name';
    deleteBtn.setAttribute('aria-label', 'Remove name');
    deleteBtn.addEventListener('click', () => {
      row.remove();
    });

    row.appendChild(input);
    row.appendChild(deleteBtn);
    namesList.appendChild(row);

    if (focus) {
      input.focus();
    }

    return row;
  }

  // Open settings modal
  function openSettingsModal() {
    const modal = document.getElementById('bwe-settings-modal');
    if (!modal) return;

    // Load current settings
    const settings = getSettings();

    // Populate title and subtitle
    document.getElementById('bwe-title-input').value = settings.title || '';
    document.getElementById('bwe-subtitle-input').value = settings.subtitle || '';

    // Clear and populate names list
    const namesList = document.getElementById('bwe-names-list');
    namesList.innerHTML = '';

    if (settings.names && settings.names.length > 0) {
      settings.names.forEach(name => addNameRow(name, false));
    } else {
      // If no names, try to extract from the page
      extractNamesFromPage();
    }

    modal.style.display = 'flex';

    // Focus first input
    setTimeout(() => {
      document.getElementById('bwe-title-input').focus();
    }, 100);
  }

  // Close settings modal
  function closeSettingsModal() {
    const modal = document.getElementById('bwe-settings-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  // Extract names from the current page (if possible)
  function extractNamesFromPage() {
    // Try to find names in the React app's state or DOM
    // This is a fallback in case no settings exist yet
    const settings = getSettings();

    if (settings.names && settings.names.length > 0) {
      settings.names.forEach(name => addNameRow(name, false));
    } else {
      // Add some default placeholder rows
      addNameRow('', false);
    }
  }

  // Save settings from modal
  function saveSettingsFromModal() {
    const title = document.getElementById('bwe-title-input').value.trim();
    const subtitle = document.getElementById('bwe-subtitle-input').value.trim();

    // Collect all names
    const nameInputs = document.querySelectorAll('.bwe-name-input');
    const names = Array.from(nameInputs)
      .map(input => input.value.trim())
      .filter(name => name.length > 0);

    const settings = {
      title: title || DEFAULT_SETTINGS.title,
      subtitle: subtitle || DEFAULT_SETTINGS.subtitle,
      names: names
    };

    if (saveSettings(settings)) {
      // Apply settings to the page
      applySettings(settings);
      closeSettingsModal();

      // Show success message
      showNotification('Settings saved successfully! Reload the page to see changes.', 'success');
    } else {
      showNotification('Error saving settings. Please try again.', 'error');
    }
  }

  // Reset settings to default
  function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to default?')) {
      localStorage.removeItem(STORAGE_KEY);

      // Reload settings in modal
      const settings = getSettings();
      document.getElementById('bwe-title-input').value = settings.title;
      document.getElementById('bwe-subtitle-input').value = settings.subtitle;

      const namesList = document.getElementById('bwe-names-list');
      namesList.innerHTML = '';
      addNameRow('', false);

      showNotification('Settings reset to default. Save to apply changes.', 'info');
    }
  }

  // Apply settings to the page (update title and subtitle)
  function applySettings(settings) {
    // Try to update title
    const titleElements = document.querySelectorAll('h1.main-title, h1');
    if (titleElements.length > 0 && settings.title) {
      titleElements[0].textContent = settings.title;
    }

    // Try to update subtitle
    const subtitleElements = document.querySelectorAll('h2.sub-title, h2');
    if (subtitleElements.length > 0 && settings.subtitle) {
      subtitleElements[0].textContent = settings.subtitle;
    }

    // Note: The names need to be handled by the React app
    // We're just storing them for now, and they'll be used on page reload
  }

  // Show notification
  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `bwe-notification bwe-notification-${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    // Trigger animation
    setTimeout(() => {
      notification.classList.add('bwe-notification-show');
    }, 10);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.classList.remove('bwe-notification-show');
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 3000);
  }

  // Initialize settings on page load
  function initSettings() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  function init() {
    // Create and add settings icon to page
    const root = document.getElementById('root');
    if (root) {
      const icon = createSettingsIcon();
      document.body.appendChild(icon);

      // Create and add modal
      const modal = createSettingsModal();
      document.body.appendChild(modal);

      // Apply saved settings on page load
      const settings = getSettings();
      if (settings.title || settings.subtitle) {
        // Wait a bit for React to render
        setTimeout(() => {
          applySettings(settings);
        }, 500);
      }

      // Listen for Escape key to close modal
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeSettingsModal();
        }
      });
    }
  }

  // Export to window for potential use by the React app
  window.BWESettings = {
    get: getSettings,
    save: saveSettings,
    apply: applySettings
  };

  // Initialize
  initSettings();
})();
