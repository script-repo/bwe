/**
 * BWE shared core: API client, notification toasts, and the mechanism used to
 * feed persisted data into the compiled React wheel without touching its source.
 *
 * The wheel only ever accepts names through a hidden `<input type="file" accept=".csv">`
 * that it wires up to Papa.parse internally. So instead of reaching into React
 * state, we synthesize a CSV `File`, attach it to that input via `DataTransfer`,
 * and dispatch a `change` event - the app then ingests it exactly as if a human
 * had picked a file.
 */

(function () {
  'use strict';

  const LOCAL_CACHE_KEY = 'bwe_settings_cache';

  const DRAWN_KEY = 'bwe_drawn_names';

  // Names currently on the wheel. `fullNames` is the configured (de-duplicated)
  // list from settings; `remainingNames` shrinks as winners are drawn. Drawn
  // names are remembered in localStorage (tied to the exact name list) so a
  // page reload doesn't bring them back. Saving settings starts a new round.
  let fullNames = [];
  let remainingNames = [];

  function nameKey(name) {
    return String(name).trim().toLowerCase();
  }

  // Keep the first spelling of each name; drop blanks and case-insensitive repeats.
  function dedupeNames(names) {
    const seen = new Set();
    return names.filter((name) => {
      const key = nameKey(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function listFingerprint(names) {
    return JSON.stringify(names.map(nameKey));
  }

  function loadDrawnKeys(names) {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAWN_KEY) || 'null');
      if (saved && saved.fingerprint === listFingerprint(names) && Array.isArray(saved.drawn)) {
        return new Set(saved.drawn);
      }
    } catch (e) {
      // unreadable or unavailable storage: start a fresh round
    }
    return new Set();
  }

  function saveDrawnKeys(names, drawnKeys) {
    try {
      localStorage.setItem(
        DRAWN_KEY,
        JSON.stringify({ fingerprint: listFingerprint(names), drawn: Array.from(drawnKeys) })
      );
    } catch (e) {
      // best-effort only
    }
  }

  function resetDrawnNames() {
    try {
      localStorage.removeItem(DRAWN_KEY);
    } catch (e) {
      // best-effort only
    }
  }

  async function fetchSettings() {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
    const settings = await res.json();
    cacheSettingsLocally(settings);
    return settings;
  }

  async function saveSettings(settings) {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Failed to save settings (${res.status})`);
    }
    const updated = await res.json();
    cacheSettingsLocally(updated);
    return updated;
  }

  function cacheSettingsLocally(settings) {
    try {
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(settings));
    } catch (e) {
      // best-effort offline cache only; ignore quota/availability errors
    }
  }

  function readCachedSettings() {
    try {
      const raw = localStorage.getItem(LOCAL_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  async function fetchMeta() {
    const res = await fetch('/api/meta');
    if (!res.ok) throw new Error(`Failed to load meta (${res.status})`);
    return res.json();
  }

  async function fetchHistory(limit) {
    const query = limit ? `?limit=${encodeURIComponent(limit)}` : '';
    const res = await fetch(`/api/history${query}`);
    if (!res.ok) throw new Error(`Failed to load history (${res.status})`);
    return res.json();
  }

  async function addHistoryEntry(name) {
    const res = await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`Failed to save history entry (${res.status})`);
    return res.json();
  }

  async function clearHistory() {
    const res = await fetch('/api/history', { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`Failed to clear history (${res.status})`);
  }

  // --- Feed names into the compiled wheel via its own CSV upload path ---
  function namesToCsv(names) {
    return names.map((n) => `"${String(n).replace(/"/g, '""')}"`).join('\n');
  }

  function waitForWheelInput(timeoutMs = 2000) {
    return new Promise((resolve) => {
      const existing = document.querySelector('input[type="file"][accept=".csv"]');
      if (existing) {
        resolve(existing);
        return;
      }

      let timeout;
      const observer = new MutationObserver(() => {
        const input = document.querySelector('input[type="file"][accept=".csv"]');
        if (!input) return;
        observer.disconnect();
        clearTimeout(timeout);
        resolve(input);
      });
      observer.observe(document.body, { childList: true, subtree: true });

      timeout = setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector('input[type="file"][accept=".csv"]'));
      }, timeoutMs);
    });
  }

  function findWheelResetButton() {
    return Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent.trim().toLowerCase() === 'reset'
    );
  }

  function dispatchNamesToInput(input, names) {
    if (!input) return false;

    const csv = namesToCsv(names);
    const file = new File([csv], 'wheel-names.csv', { type: 'text/csv' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function injectNames(rawNames) {
    if (!Array.isArray(rawNames)) return false;
    const names = dedupeNames(rawNames);
    if (names.length === 0) return false;

    let input = document.querySelector('input[type="file"][accept=".csv"]');
    if (!input) {
      // Once the compiled React wheel has participants, it removes its CSV
      // input from the DOM. Its Reset button is the only public path back to
      // that input, so use it and wait for React to render the upload screen.
      const resetButton = findWheelResetButton();
      if (resetButton) resetButton.click();
      // On initial page load neither the input nor Reset may exist yet because
      // the module bundle is still rendering. The same wait covers both cases.
      input = await waitForWheelInput(resetButton ? 2000 : 5000);
    }

    const injected = dispatchNamesToInput(input, names);
    if (injected) remainingNames = names.slice();
    return injected;
  }

  function applyText(title, subtitle) {
    const titleEl = document.querySelector('h1.main-title, h1');
    if (titleEl && title) titleEl.textContent = title;
    const subtitleEl = document.querySelector('h2.sub-title, h2');
    if (subtitleEl && subtitle) subtitleEl.textContent = subtitle;
  }

  async function applySettings(settings) {
    if (!settings) return false;
    applyText(settings.title, settings.subtitle);
    if (!Array.isArray(settings.names)) return false;

    fullNames = dedupeNames(settings.names);
    if (fullNames.length === 0) return false;

    const drawnKeys = loadDrawnKeys(fullNames);
    let remaining = fullNames.filter((name) => !drawnKeys.has(nameKey(name)));
    if (remaining.length === 0) {
      // Every name was already drawn: start a fresh round rather than show an empty wheel.
      resetDrawnNames();
      remaining = fullNames;
    }
    return injectNames(remaining);
  }

  /**
   * Remove a drawn winner from the live wheel so they can never be picked
   * again this round. The wheel is not refilled automatically: once one name
   * is left, saving settings starts a new round.
   *
   * Resolves to { removed, applied, remaining }.
   */
  async function removeWinner(name) {
    const key = nameKey(name);
    const next = remainingNames.filter((n) => nameKey(n) !== key);
    if (next.length === remainingNames.length) {
      return { removed: false, applied: false, remaining: remainingNames.slice() };
    }

    const drawnKeys = loadDrawnKeys(fullNames);
    drawnKeys.add(key);
    saveDrawnKeys(fullNames, drawnKeys);

    const applied = await injectNames(next);
    if (!applied) remainingNames = next;
    return { removed: true, applied, remaining: next.slice() };
  }

  function getRemainingNames() {
    return remainingNames.slice();
  }

  // --- Shared toast notifications, reused by settings.js and history.js ---
  function notify(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `bwe-notification bwe-notification-${type}`;
    el.textContent = message;
    document.body.appendChild(el);

    requestAnimationFrame(() => el.classList.add('bwe-notification-show'));

    setTimeout(() => {
      el.classList.remove('bwe-notification-show');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // --- Shared floating icon-button cluster (top-right): settings + history live here ---
  function getIconCluster() {
    let cluster = document.getElementById('bwe-icon-cluster');
    if (!cluster) {
      cluster = document.createElement('div');
      cluster.id = 'bwe-icon-cluster';
      cluster.className = 'bwe-icon-cluster';
      document.body.appendChild(cluster);
    }
    return cluster;
  }

  window.BWE = {
    fetchSettings,
    saveSettings,
    readCachedSettings,
    fetchMeta,
    fetchHistory,
    addHistoryEntry,
    clearHistory,
    injectNames,
    applyText,
    applySettings,
    removeWinner,
    getRemainingNames,
    resetDrawnNames,
    dedupeNames,
    notify,
    getIconCluster,
  };
})();
