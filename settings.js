/**
 * Settings functionality for BWE (Big Wheel of Excitement)
 * Adds a settings icon and modal for customizing wheel names, title, and subtitle.
 *
 * Persistence lives on the server (SQLite on a PVC in Kubernetes) via the
 * shared window.BWE API client defined in bwe-core.js. Saving here also
 * re-injects the new names into the live wheel immediately - no reload needed.
 */

(function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    title: 'BIG WHEEL',
    subtitle: 'OF EXCITEMENT',
    names: [],
  };

  // Create settings icon
  function createSettingsIcon() {
    const icon = document.createElement('button');
    icon.id = 'bwe-settings-icon';
    icon.className = 'bwe-icon-btn bwe-settings-icon';
    icon.innerHTML = '\u2699\ufe0f';
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
          <h2>\u2699\ufe0f Settings</h2>
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
                \u2795 Add Name
              </button>
            </div>

            <div id="bwe-names-list" class="bwe-names-list">
              <!-- Names will be added dynamically -->
            </div>
          </div>
        </div>

        <div class="bwe-modal-footer">
          <button id="bwe-reset-btn" class="bwe-btn bwe-btn-danger">
            Reset Fields
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
    modal.querySelector('#bwe-reset-btn').addEventListener('click', resetFormFields);

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
    deleteBtn.innerHTML = '\ud83d\uddd1\ufe0f';
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

  function populateNamesList(names) {
    const namesList = document.getElementById('bwe-names-list');
    namesList.innerHTML = '';

    if (names && names.length > 0) {
      names.forEach((name) => addNameRow(name, false));
    } else {
      addNameRow('', false);
    }
  }

  // Open settings modal - loads current settings from the server
  async function openSettingsModal() {
    const modal = document.getElementById('bwe-settings-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    document.getElementById('bwe-title-input').value = '';
    document.getElementById('bwe-subtitle-input').value = '';
    document.getElementById('bwe-names-list').innerHTML = '<p class="bwe-history-empty">Loading&hellip;</p>';

    let settings;
    try {
      settings = await window.BWE.fetchSettings();
    } catch (err) {
      console.error('[settings] Failed to load settings:', err);
      settings = window.BWE.readCachedSettings() || { ...DEFAULT_SETTINGS };
      window.BWE.notify('Could not reach the server - showing last known settings.', 'info');
    }

    document.getElementById('bwe-title-input').value = settings.title || '';
    document.getElementById('bwe-subtitle-input').value = settings.subtitle || '';
    populateNamesList(settings.names);

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

  // Save settings from modal - persists to the server and applies live
  async function saveSettingsFromModal() {
    const title = document.getElementById('bwe-title-input').value.trim();
    const subtitle = document.getElementById('bwe-subtitle-input').value.trim();

    const nameInputs = document.querySelectorAll('.bwe-name-input');
    const names = Array.from(nameInputs)
      .map((input) => input.value.trim())
      .filter((name) => name.length > 0);

    const settings = {
      title: title || DEFAULT_SETTINGS.title,
      subtitle: subtitle || DEFAULT_SETTINGS.subtitle,
      names,
    };

    const saveBtn = document.getElementById('bwe-save-btn');
    saveBtn.disabled = true;

    try {
      const updated = await window.BWE.saveSettings(settings);
      let applied = false;
      try {
        applied = await window.BWE.applySettings(updated);
      } catch (applyErr) {
        // The server save already succeeded. Treat a compiled-wheel bridge
        // failure as a refresh problem rather than claiming persistence failed.
        console.error('[settings] Saved settings but could not refresh the wheel:', applyErr);
      }
      closeSettingsModal();
      if (applied || updated.names.length === 0) {
        window.BWE.notify('Settings saved and applied to the wheel!', 'success');
      } else {
        window.BWE.notify('Settings saved. Reload the page to refresh the wheel names.', 'info');
      }
    } catch (err) {
      console.error('[settings] Failed to save settings:', err);
      window.BWE.notify(err.message || 'Error saving settings. Please try again.', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  // Reset the in-modal fields back to blank defaults (does not touch saved data until Save is clicked)
  function resetFormFields() {
    if (!confirm('Reset the form fields to blank defaults? Click Save Changes afterwards to apply.')) return;

    document.getElementById('bwe-title-input').value = DEFAULT_SETTINGS.title;
    document.getElementById('bwe-subtitle-input').value = DEFAULT_SETTINGS.subtitle;
    populateNamesList([]);

    window.BWE.notify('Fields reset. Click Save Changes to apply.', 'info');
  }

  function init() {
    const cluster = window.BWE.getIconCluster();
    cluster.appendChild(createSettingsIcon());
    document.body.appendChild(createSettingsModal());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeSettingsModal();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
