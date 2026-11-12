'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SETTINGS_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'settings.js'), 'utf8');

// Just enough DOM for settings.js: elements by id, child lists for the name
// rows, click listeners, and querySelectorAll('.bwe-name-input').
function createHarness({ serverNames = ['Ada', 'Alan'], applyResult = true } = {}) {
  const byId = new Map();
  const notifications = [];
  const saved = [];

  class FakeElement {
    constructor() {
      this.style = {};
      this.children = [];
      this.parent = null;
      this.listeners = {};
      this.value = '';
      this.disabled = false;
      this.title = '';
      this.className = '';
      this.selectorCache = new Map();
    }
    set id(value) {
      this._id = value;
      byId.set(value, this);
    }
    get id() {
      return this._id;
    }
    set innerHTML(value) {
      this.children.forEach((child) => (child.parent = null));
      this.children = [];
      this.html = value;
    }
    get innerHTML() {
      return this.html || '';
    }
    addEventListener(type, callback) {
      (this.listeners[type] = this.listeners[type] || []).push(callback);
    }
    async click() {
      await Promise.all((this.listeners.click || []).map((cb) => cb({ target: this })));
    }
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
      return child;
    }
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
    setAttribute() {}
    focus() {}
    querySelector(selector) {
      if (selector.startsWith('#')) return getElementById(selector.slice(1));
      if (!this.selectorCache.has(selector)) this.selectorCache.set(selector, new FakeElement());
      return this.selectorCache.get(selector);
    }
  }

  function getElementById(id) {
    if (!byId.has(id)) new FakeElement().id = id;
    return byId.get(id);
  }

  function nameInputs() {
    return getElementById('bwe-names-list')
      .children.flatMap((row) => row.children)
      .filter((el) => el.className.includes('bwe-name-input'));
  }

  let ready;
  const cluster = new FakeElement();
  const document = {
    readyState: 'loading',
    body: new FakeElement(),
    createElement: () => new FakeElement(),
    getElementById,
    querySelectorAll: (selector) => (selector === '.bwe-name-input' ? nameInputs() : []),
    addEventListener(type, callback) {
      if (type === 'DOMContentLoaded') ready = callback;
    },
  };

  const window = {
    BWE: {
      getIconCluster: () => cluster,
      notify: (message, type) => notifications.push({ message, type }),
      fetchSettings: async () => ({ title: 'T', subtitle: 'S', names: serverNames.slice() }),
      readCachedSettings: () => null,
      saveSettings: async (settings) => {
        saved.push(settings);
        return settings;
      },
      resetDrawnNames() {},
      applySettings: async () => applyResult,
      dedupeNames(names) {
        const seen = new Set();
        return names.filter((n) => {
          const key = n.trim().toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      },
    },
  };

  vm.runInNewContext(
    SETTINGS_SOURCE,
    { window, document, console, confirm: () => true, setTimeout: () => {} },
    { filename: 'settings.js' }
  );
  ready();

  return {
    async open() {
      await cluster.children[0].click();
      await new Promise((resolve) => setImmediate(resolve));
    },
    setNames(names) {
      nameInputs().forEach((input) => input.parent.remove());
      names.forEach(() => getElementById('bwe-add-name-btn').click());
      nameInputs().forEach((input, i) => (input.value = names[i]));
    },
    save: () => getElementById('bwe-save-btn').click(),
    addNameButton: () => getElementById('bwe-add-name-btn'),
    nameInputs,
    notifications,
    saved,
  };
}

test('does not save, or claim success, with fewer than 2 names', async () => {
  for (const names of [[], [''], ['Solo'], ['Ada', ' ada ']]) {
    const harness = createHarness();
    await harness.open();
    harness.setNames(names);
    await harness.save();

    assert.equal(harness.saved.length, 0, JSON.stringify(names));
    assert.equal(harness.notifications.length, 1);
    assert.equal(harness.notifications[0].type, 'error');
    assert.match(harness.notifications[0].message, /at least 2 different names/);
  }
});

test('saves 2 or more names and reports success only when the wheel was updated', async () => {
  const applied = createHarness();
  await applied.open();
  applied.setNames(['Ada', 'Grace']);
  await applied.save();
  assert.deepEqual([...applied.saved[0].names], ['Ada', 'Grace']);
  assert.ok(applied.notifications.some((n) => n.type === 'success'));

  const notApplied = createHarness({ applyResult: false });
  await notApplied.open();
  notApplied.setNames(['Ada', 'Grace']);
  await notApplied.save();
  assert.equal(notApplied.saved.length, 1);
  assert.ok(!notApplied.notifications.some((n) => n.type === 'success'));
  assert.ok(notApplied.notifications.some((n) => /Reload the page/.test(n.message)));
});

test('caps the name list at 50 rows', async () => {
  const fifty = Array.from({ length: 50 }, (_, i) => `Name ${i + 1}`);
  const harness = createHarness({ serverNames: fifty });
  await harness.open();

  assert.equal(harness.nameInputs().length, 50);
  assert.equal(harness.addNameButton().disabled, true);

  await harness.addNameButton().click();
  assert.equal(harness.nameInputs().length, 50);
  assert.match(harness.notifications.at(-1).message, /at most 50 names/);

  // Removing a row re-enables "Add Name".
  const deleteButton = harness.nameInputs()[0].parent.children[1];
  await deleteButton.click();
  assert.equal(harness.nameInputs().length, 49);
  assert.equal(harness.addNameButton().disabled, false);
});
