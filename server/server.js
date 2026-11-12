'use strict';

const os = require('os');
const path = require('path');
const express = require('express');
const db = require('./db');

const PORT = process.env.PORT || 8080;
// Repo layout is mirrored 1:1 into the container, so the frontend files
// (index.html, assets/, etc.) live one level above this file.
const STATIC_ROOT = process.env.STATIC_ROOT || path.join(__dirname, '..');

db.init();

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// --- Kubernetes probes ---
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/readyz', (req, res) => {
  if (db.isReady()) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not-ready' });
  }
});

// --- Pod / node metadata, populated via the Kubernetes Downward API ---
app.get('/api/meta', (req, res) => {
  res.json({
    podName: process.env.POD_NAME || os.hostname(),
    podNamespace: process.env.POD_NAMESPACE || null,
    nodeName: process.env.NODE_NAME || null,
    podIp: process.env.POD_IP || null,
  });
});

// --- Settings: title, subtitle, wheel names ---
app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

app.put('/api/settings', (req, res) => {
  const { title, subtitle, names } = req.body || {};

  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  if (typeof subtitle !== 'string' || !subtitle.trim()) {
    return res.status(400).json({ error: 'subtitle is required' });
  }
  if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) {
    return res.status(400).json({ error: 'names must be an array of strings' });
  }

  // Drop blanks and duplicates (case-insensitive, first spelling wins) so a
  // name can never appear on the wheel more than once.
  const seen = new Set();
  const cleanNames = names
    .map((n) => n.trim())
    .filter((n) => {
      const key = n.toLowerCase();
      if (!n || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
  const updated = db.saveSettings({ title: title.trim(), subtitle: subtitle.trim(), names: cleanNames });
  res.json(updated);
});

// --- Run history ---
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 500;

// Only a positive integer is honoured (clamped to MAX_HISTORY_LIMIT). Anything
// else - missing, zero, negative, fractional, non-numeric - falls back to the
// default. This matters because SQLite treats a negative LIMIT as "no limit".
function parseHistoryLimit(raw) {
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) return DEFAULT_HISTORY_LIMIT;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1) return DEFAULT_HISTORY_LIMIT;
  return Math.min(limit, MAX_HISTORY_LIMIT);
}

app.get('/api/history', (req, res) => {
  res.json(db.getHistory(parseHistoryLimit(req.query.limit)));
});

app.post('/api/history', (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const entry = db.addHistoryEntry(name.trim().slice(0, 100));
  res.status(201).json(entry);
});

app.delete('/api/history', (req, res) => {
  db.clearHistory();
  res.status(204).end();
});

// --- Static frontend (existing React bundle + settings/history glue) ---
// Only an explicit allowlist is served. The repo root also holds server/,
// k8s/, tests and node_modules, so serving the whole directory (even behind a
// prefix deny list) could be bypassed with encodings like /%73erver/db.js or
// //server/db.js. Routes match the raw path; anything not listed here 404s.
const PUBLIC_FILES = new Set([
  'index.html',
  'bwe-core.js',
  'bootstrap.js',
  'settings.js',
  'history.js',
  'settings.css',
  'history.css',
  'beer-glass.png',
  'beer-glass-v2.png',
  'center-logo.png',
  'vite.svg',
]);
const SEND_OPTIONS = { root: STATIC_ROOT, dotfiles: 'deny' };

app.get('/', (req, res, next) => {
  res.sendFile('index.html', SEND_OPTIONS, (err) => err && next(err));
});

app.get('/:file', (req, res, next) => {
  if (!PUBLIC_FILES.has(req.params.file)) return next();
  res.sendFile(req.params.file, SEND_OPTIONS, (err) => err && next(err));
});

// Compiled Vite bundle. express.static resolves paths inside this directory
// only and rejects traversal attempts.
app.use('/assets', express.static(path.join(STATIC_ROOT, 'assets'), { index: false, dotfiles: 'deny' }));

function start(port = PORT, host) {
  const onListening = () => {
    console.log(`BWE server listening on port ${port}`);
    console.log(`Serving static files from ${STATIC_ROOT}`);
    console.log(`Data directory: ${db.DATA_DIR}`);
  };

  return host ? app.listen(port, host, onListening) : app.listen(port, onListening);
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
