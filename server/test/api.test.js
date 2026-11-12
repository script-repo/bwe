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

test('drops duplicate names case-insensitively when saving', async () => {
  const saved = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'T', subtitle: 'S', names: ['Ada', ' ada', 'Alan', 'ALAN ', 'Grace'] }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).names, ['Ada', 'Alan', 'Grace']);
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

test('only honours positive-integer history limits, clamped to 500', async () => {
  await fetch(`${baseUrl}/api/history`, { method: 'DELETE' });
  for (let i = 0; i < 510; i += 1) {
    const created = await fetch(`${baseUrl}/api/history`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Spin ${i}` }),
    });
    assert.equal(created.status, 201);
  }

  const count = async (query) => (await (await fetch(`${baseUrl}/api/history${query}`)).json()).length;
  assert.equal(await count(''), 100);
  assert.equal(await count('?limit=1'), 1);
  assert.equal(await count('?limit=25'), 25);
  assert.equal(await count('?limit=500'), 500);
  assert.equal(await count('?limit=100000'), 500);
  assert.equal(await count('?limit=-1'), 100);
  assert.equal(await count('?limit=0'), 100);
  assert.equal(await count('?limit=2.5'), 100);
  assert.equal(await count('?limit=abc'), 100);
  assert.equal(await count('?limit=10&limit=20'), 100);

  await fetch(`${baseUrl}/api/history`, { method: 'DELETE' });
});

test('serves the frontend without exposing server source', async () => {
  const index = await fetch(`${baseUrl}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<div id="root"><\/div>/);

  const source = await fetch(`${baseUrl}/server/server.js`);
  assert.equal(source.status, 404);
});

test('serves every allowlisted frontend file', async () => {
  const files = [
    '/index.html',
    '/bwe-core.js',
    '/bootstrap.js',
    '/settings.js',
    '/history.js',
    '/settings.css',
    '/history.css',
    '/beer-glass.png',
    '/beer-glass-v2.png',
    '/center-logo.png',
    '/vite.svg',
  ];
  const index = await (await fetch(`${baseUrl}/`)).text();
  for (const asset of index.match(/\.\/assets\/[^"]+/g)) files.push(asset.slice(1));

  for (const file of files) {
    const response = await fetch(`${baseUrl}${file}`);
    assert.equal(response.status, 200, `${file} should be served`);
    await response.arrayBuffer();
  }
});

test('does not expose repository files under any path encoding', async () => {
  const blocked = [
    '/server/db.js',
    '/%73erver/db.js',
    '/server%2fdb.js',
    '/server%2Fdb.js',
    '//server/db.js',
    '/./server/db.js',
    '/SERVER/db.js',
    '/server/package.json',
    '/server/test/api.test.js',
    '/server/seed/seed-data.json',
    '/server/node_modules/express/package.json',
    '/k8s/03-deployment.yaml',
    '/%6b8s/03-deployment.yaml',
    '/k8s%2f03-deployment.yaml',
    '/.git/config',
    '/%2egit/config',
    '/.github/workflows/publish-image.yml',
    '/README.md',
    '/Dockerfile',
    '/assets/..%2fserver%2fdb.js',
    '/assets/%2e%2e/server/db.js',
    '/index',
  ];

  for (const file of blocked) {
    const response = await fetch(`${baseUrl}${file}`);
    const body = await response.text();
    assert.ok(response.status >= 400, `${file} should not be served (got ${response.status})`);
    assert.doesNotMatch(body, /better-sqlite3|apiVersion|\[core\]/, `${file} leaked repository content`);
  }
});
