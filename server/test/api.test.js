'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const SERVER_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(SERVER_ROOT, '..');

let child;
let baseUrl;
let tempDir;
let serverOutput = '';

async function reservePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

async function waitUntilReady(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${url}/readyz`);
      if (response.ok) return;
    } catch (err) {
      // The child may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not become ready. Output:\n${serverOutput}`);
}

before(async () => {
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bwe-api-test-'));

  child = spawn(process.execPath, [path.join(SERVER_ROOT, 'server.js')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: tempDir,
      DB_PATH: ':memory:',
      STATIC_ROOT: REPO_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  await waitUntilReady(baseUrl);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
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
