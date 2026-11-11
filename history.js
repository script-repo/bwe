/**
 * Run History feature for BWE.
 * Adds a trophy icon + modal showing persisted spin history, and captures
 * winners as they appear on screen (the compiled wheel has no API of its own,
 * so we watch the DOM for its winner overlay instead).
 */

(function () {
  'use strict';

  let cachedHistory = [];
  const capturedOverlays = new WeakSet();
  // Winners waiting to be removed from the wheel once their overlay closes.
  const pendingRemovals = [];

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatRelativeTime(spunAt) {
    // Server timestamps are SQLite CURRENT_TIMESTAMP: "YYYY-MM-DD HH:MM:SS" (UTC).
    const date = new Date(spunAt.replace(' ', 'T') + 'Z');
    if (Number.isNaN(date.getTime())) return spunAt;

    const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.round(diffHr / 24);
    return `${diffDay}d ago`;
  }

  function createHistoryIcon() {
    const icon = document.createElement('button');
    icon.id = 'bwe-history-icon';
    icon.className = 'bwe-icon-btn bwe-history-icon';
    icon.innerHTML = '\ud83c\udfc6';
    icon.title = 'Run History';
    icon.setAttribute('aria-label', 'Open run history');
    icon.addEventListener('click', openHistoryModal);
    return icon;
  }

  function createHistoryModal() {
    const modal = document.createElement('div');
    modal.id = 'bwe-history-modal';
    modal.className = 'bwe-modal';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="bwe-modal-content">
        <div class="bwe-modal-header">
          <h2>\ud83c\udfc6 Run History</h2>
          <button class="bwe-modal-close" aria-label="Close history">&times;</button>
        </div>

        <div class="bwe-modal-body">
          <div id="bwe-history-list" class="bwe-history-list">
            <p class="bwe-history-empty">No spins yet - give the wheel a spin!</p>
          </div>
        </div>

        <div class="bwe-modal-footer">
          <button id="bwe-history-clear-btn" class="bwe-btn bwe-btn-danger">Clear History</button>
          <button id="bwe-history-export-btn" class="bwe-btn bwe-btn-secondary">Export CSV</button>
        </div>
      </div>
    `;

    modal.querySelector('.bwe-modal-close').addEventListener('click', closeHistoryModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeHistoryModal();
    });
    modal.querySelector('#bwe-history-clear-btn').addEventListener('click', handleClearHistory);
    modal.querySelector('#bwe-history-export-btn').addEventListener('click', exportHistoryCsv);

    return modal;
  }

  async function refreshHistoryList() {
    const list = document.getElementById('bwe-history-list');
    if (!list) return;

    try {
      cachedHistory = await window.BWE.fetchHistory(200);
    } catch (err) {
      console.error('[history] Failed to load history:', err);
      window.BWE.notify('Could not load run history from the server.', 'error');
      return;
    }

    if (cachedHistory.length === 0) {
      list.innerHTML = '<p class="bwe-history-empty">No spins yet - give the wheel a spin!</p>';
      return;
    }

    list.innerHTML = cachedHistory
      .map(
        (entry) => `
          <div class="bwe-history-row">
            <span class="bwe-history-name">${escapeHtml(entry.name)}</span>
            <span class="bwe-history-time">${formatRelativeTime(entry.spunAt)}</span>
          </div>
        `
      )
      .join('');
  }

  async function openHistoryModal() {
    const modal = document.getElementById('bwe-history-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    await refreshHistoryList();
  }

  function closeHistoryModal() {
    const modal = document.getElementById('bwe-history-modal');
    if (modal) modal.style.display = 'none';
  }

  async function handleClearHistory() {
    if (!confirm('Clear the entire run history? This cannot be undone.')) return;

    try {
      await window.BWE.clearHistory();
      cachedHistory = [];
      await refreshHistoryList();
      window.BWE.notify('Run history cleared.', 'success');
    } catch (err) {
      console.error('[history] Failed to clear history:', err);
      window.BWE.notify('Could not clear run history.', 'error');
    }
  }

  function exportHistoryCsv() {
    if (cachedHistory.length === 0) {
      window.BWE.notify('No history to export yet.', 'info');
      return;
    }

    const rows = [
      'name,spun_at',
      ...cachedHistory.map((e) => `"${e.name.replace(/"/g, '""')}","${e.spunAt}"`),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bwe-run-history.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Re-injecting names resets the wheel, so wait until the winner overlay has
  // been dismissed ("Play Again" / click outside) before removing the winner.
  function processPendingRemovals() {
    for (let i = pendingRemovals.length - 1; i >= 0; i -= 1) {
      const { overlay, name } = pendingRemovals[i];
      if (overlay.isConnected !== false) continue;
      pendingRemovals.splice(i, 1);

      if (typeof window.BWE.removeWinner !== 'function') continue;
      window.BWE.removeWinner(name)
        .then((result) => {
          if (result && result.removed && result.remaining.length === 1) {
            window.BWE.notify(
              `Only ${result.remaining[0]} is left. Save settings to start a new round.`,
              'info'
            );
          }
        })
        .catch((err) => {
          console.error('[history] Failed to remove winner from the wheel:', err);
        });
    }
  }

  // The compiled wheel has no event/callback we can hook, so we watch the DOM
  // for its winner overlay (`.winner-overlay` > `.winner-card` > name `<div>`)
  // and record whatever name shows up there. Once that overlay
  // closes, the winner is removed from the wheel so they can't be drawn again.
  function observeWinnerOverlay() {
    const observer = new MutationObserver(() => {
      processPendingRemovals();
      document.querySelectorAll('.winner-overlay').forEach((overlay) => {
        if (capturedOverlays.has(overlay)) return;

        const nameEl = overlay.querySelector('.winner-card > div');
        const winnerName = nameEl && nameEl.textContent.trim();
        if (!winnerName) return;

        // Track the overlay node rather than a short time window. Confetti and
        // other UI mutations can continue for several seconds, but one overlay
        // always represents exactly one completed spin.
        capturedOverlays.add(overlay);
        pendingRemovals.push({ overlay, name: winnerName });
        window.BWE.addHistoryEntry(winnerName).catch((err) => {
          console.error('[history] Failed to record winner:', err);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    const cluster = window.BWE.getIconCluster();
    cluster.appendChild(createHistoryIcon());
    document.body.appendChild(createHistoryModal());
    observeWinnerOverlay();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeHistoryModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
