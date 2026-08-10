'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const SERVER_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(SERVER_ROOT, '..');

let server;
let baseUrl;
let tempDir;

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bwe-api-test-'));
  process.env.DATA_DIR = tempDir;
  process.env.DB_PATH = ':memory:';
  process.env.STATIC_ROOT = REPO_ROOT;

  const { start } = require('../server');
  server = start(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.DB_PATH;
  delete process.env.STATIC_ROOT;
});

test('seeds a new database and reports healthy', async () => {
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const response = await fetch(`${baseUrl}/api/settings`);
  assert.equal(response.status, 200);
  const settings = await response.json();
  assert.equal(settings.title, 'CKA BOOTCAMP');
  assert.equal(settings.subtitle, 'PRIZE WHEEL');
  assert.equal(settings.names.length, 12);
});

test('validates, normalizes, caps, and persists settings', async () => {
  const invalid = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '', subtitle: 'Valid', names: [] }),
  });
  assert.equal(invalid.status, 400);

  const names = Array.from({ length: 55 }, (_, index) => ` Name ${index + 1} `);
  const saved = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: ' Audit Wheel ', subtitle: ' Test Deck ', names }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), {
    title: 'Audit Wheel',
    subtitle: 'Test Deck',
    names: Array.from({ length: 50 }, (_, index) => `Name ${index + 1}`),
  });

  const reloaded = await fetch(`${baseUrl}/api/settings`);
  assert.equal((await reloaded.json()).names.length, 50);
});

test('records, lists, and clears run history', async () => {
  const created = await fetch(`${baseUrl}/api/history`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: ' Beta ' }),
  });
  assert.equal(created.status, 201);
  const entry = await created.json();
  assert.equal(entry.name, 'Beta');
  assert.match(entry.spunAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const listed = await fetch(`${baseUrl}/api/history?limit=10`);
  assert.deepEqual(await listed.json(), [entry]);

  const cleared = await fetch(`${baseUrl}/api/history`, { method: 'DELETE' });
  assert.equal(cleared.status, 204);
  const empty = await fetch(`${baseUrl}/api/history`);
  assert.deepEqual(await empty.json(), []);
});

test('serves the frontend without exposing server source', async () => {
  const index = await fetch(`${baseUrl}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<div id="root"><\/div>/);

  const source = await fetch(`${baseUrl}/server/server.js`);
  assert.equal(source.status, 404);
});
