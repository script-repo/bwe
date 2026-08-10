'use strict';

/**
 * SQLite persistence layer for BWE.
 *
 * The database file lives under DATA_DIR, which in Kubernetes is a PVC mount.
 * On first boot (no rows in `settings`), the wheel is seeded from SEED_FILE so
 * the demo is never empty - by default that's the file bundled in the image,
 * but in the cluster it can point at a ConfigMap-mounted file instead so an
 * instructor can change the default deck without rebuilding the image.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'bwe.db');
const SEED_FILE = process.env.SEED_FILE || path.join(__dirname, 'seed', 'seed-data.json');

const FALLBACK_SEED = { title: 'CKA BOOTCAMP', subtitle: 'PRIZE WHEEL', names: [] };

let db;

function loadSeed() {
  try {
    const raw = fs.readFileSync(SEED_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : FALLBACK_SEED.title,
      subtitle: typeof parsed.subtitle === 'string' && parsed.subtitle.trim() ? parsed.subtitle.trim() : FALLBACK_SEED.subtitle,
      names: Array.isArray(parsed.names)
        ? parsed.names.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim())
        : [],
    };
  } catch (err) {
    console.warn(`[db] Could not read seed file at ${SEED_FILE} (${err.message}); using built-in defaults.`);
    return { ...FALLBACK_SEED };
  }
}

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      spun_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const settingsCount = db.prepare('SELECT COUNT(*) AS count FROM settings').get().count;
  if (settingsCount === 0) {
    seedDefaults();
  }

  console.log(`[db] Ready at ${DB_PATH}`);
}

function seedDefaults() {
  const seed = loadSeed();
  writeSettingsAndNames(seed.title, seed.subtitle, seed.names);
  console.log(`[db] Seeded defaults from ${SEED_FILE} (${seed.names.length} names).`);
}

function writeSettingsAndNames(title, subtitle, names) {
  const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const clearNames = db.prepare('DELETE FROM names');
  const insertName = db.prepare('INSERT INTO names (name, position) VALUES (?, ?)');

  const tx = db.transaction(() => {
    setSetting.run('title', title);
    setSetting.run('subtitle', subtitle);
    clearNames.run();
    names.forEach((name, index) => insertName.run(name, index));
  });
  tx();
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { title: FALLBACK_SEED.title, subtitle: FALLBACK_SEED.subtitle };
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  const names = db.prepare('SELECT name FROM names ORDER BY position ASC, id ASC').all().map((r) => r.name);
  return { ...settings, names };
}

function saveSettings({ title, subtitle, names }) {
  writeSettingsAndNames(title, subtitle, names);
  return getSettings();
}

function getHistory(limit = 100) {
  return db
    .prepare('SELECT id, name, spun_at AS spunAt FROM history ORDER BY id DESC LIMIT ?')
    .all(limit);
}

function addHistoryEntry(name) {
  const result = db.prepare('INSERT INTO history (name) VALUES (?)').run(name);
  return db
    .prepare('SELECT id, name, spun_at AS spunAt FROM history WHERE id = ?')
    .get(result.lastInsertRowid);
}

function clearHistory() {
  db.prepare('DELETE FROM history').run();
}

function isReady() {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  init,
  getSettings,
  saveSettings,
  getHistory,
  addHistoryEntry,
  clearHistory,
  isReady,
  DB_PATH,
  DATA_DIR,
};
