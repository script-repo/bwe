/**
 * Boots the page: loads persisted settings from the server, feeds them into
 * the compiled wheel, and renders the pod/node info badge used to demonstrate
 * that compute is ephemeral while PVC-backed data survives pod restarts.
 */

(function () {
  'use strict';

  function showLoadingOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'bwe-loading-overlay';
    overlay.className = 'bwe-loading-overlay';
    overlay.innerHTML = '<div class="bwe-spinner"></div><p>Loading wheel data&hellip;</p>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function hideLoadingOverlay(overlay) {
    if (!overlay) return;
    overlay.classList.add('bwe-loading-overlay-hide');
    setTimeout(() => overlay.remove(), 300);
  }

  function renderPodBadge(meta) {
    const badge = document.createElement('div');
    badge.className = 'bwe-pod-badge';

    const parts = [];
    if (meta && meta.podName) parts.push(`pod: ${meta.podName}`);
    if (meta && meta.nodeName) parts.push(`node: ${meta.nodeName}`);
    badge.textContent = parts.length ? parts.join(' \u00b7 ') : 'running locally (no pod metadata)';
    badge.title =
      'Proof of persistence: delete this pod and reload the page. This badge will show a new pod name, ' +
      'but your names and run history will still be here because they live on the PVC, not in the pod.';

    document.body.appendChild(badge);
  }

  async function loadAndApplySettings() {
    let settings;
    try {
      settings = await window.BWE.fetchSettings();
    } catch (err) {
      console.error('[bootstrap] Failed to load settings from server:', err);
      const cached = window.BWE.readCachedSettings();
      if (cached) {
        try {
          await window.BWE.applySettings(cached);
        } catch (applyErr) {
          console.error('[bootstrap] Failed to apply cached settings:', applyErr);
        }
        window.BWE.notify('Server unreachable - showing last cached data.', 'info');
      } else {
        window.BWE.notify('Could not load settings from the server. Is the backend running?', 'error');
      }
      return;
    }

    try {
      const applied = await window.BWE.applySettings(settings);
      if (!applied && Array.isArray(settings.names) && settings.names.length > 0) {
        window.BWE.notify('Could not initialize the wheel names. Reload to try again.', 'error');
      }
    } catch (err) {
      console.error('[bootstrap] Failed to apply settings to the wheel:', err);
      window.BWE.notify('Could not initialize the wheel names. Reload to try again.', 'error');
    }
  }

  async function loadPodBadge() {
    try {
      const meta = await window.BWE.fetchMeta();
      renderPodBadge(meta);
    } catch (err) {
      console.warn('[bootstrap] Failed to load pod metadata:', err);
    }
  }

  async function init() {
    const overlay = showLoadingOverlay();
    try {
      await loadAndApplySettings();
    } finally {
      hideLoadingOverlay(overlay);
    }
    loadPodBadge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
