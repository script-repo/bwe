'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CORE_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'bwe-core.js'), 'utf8');

function createHarness({ inputPresent = false, resetPresent = false, storage = new Map() } = {}) {
  const observers = new Set();
  const title = { textContent: '' };
  const subtitle = { textContent: '' };
  const state = { input: inputPresent ? createInput() : null, resetClicks: 0 };

  function createInput() {
    return {
      files: [],
      dispatchedEvents: [],
      dispatchEvent(event) {
        this.dispatchedEvents.push(event);
      },
    };
  }

  function renderInput() {
    state.input = createInput();
    observers.forEach((observer) => observer.callback());
  }

  const resetButton = {
    textContent: ' Reset ',
    click() {
      state.resetClicks += 1;
      setTimeout(renderInput, 0);
    },
  };

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      observers.add(this);
    }
    disconnect() {
      observers.delete(this);
    }
  }

  class FakeFile {
    constructor(parts, name, options) {
      this.parts = parts;
      this.name = name;
      this.type = options.type;
    }
  }

  class FakeDataTransfer {
    constructor() {
      this.files = [];
      this.items = { add: (file) => this.files.push(file) };
    }
  }

  const document = {
    body: { appendChild() {} },
    querySelector(selector) {
      if (selector === 'input[type="file"][accept=".csv"]') return state.input;
      if (selector === 'h1.main-title, h1') return title;
      if (selector === 'h2.sub-title, h2') return subtitle;
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'button' && resetPresent ? [resetButton] : [];
    },
    createElement() {
      return { classList: { add() {}, remove() {} }, remove() {} };
    },
    getElementById() {
      return null;
    },
  };

  const window = {};
  const context = {
    window,
    document,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async () => {
      throw new Error('Unexpected fetch');
    },
    File: FakeFile,
    DataTransfer: FakeDataTransfer,
    MutationObserver: FakeMutationObserver,
    Event: class FakeEvent {
      constructor(type, options) {
        this.type = type;
        this.bubbles = options.bubbles;
      }
    },
    requestAnimationFrame: (callback) => callback(),
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(CORE_SOURCE, context, { filename: 'bwe-core.js' });

  return { BWE: window.BWE, state, title, subtitle, renderInput };
}

function injectedCsv(harness) {
  assert.equal(harness.state.input.dispatchedEvents.length, 1);
  assert.equal(harness.state.input.dispatchedEvents[0].type, 'change');
  assert.equal(harness.state.input.files.length, 1);
  return harness.state.input.files[0].parts[0];
}

test('injects persisted names through an existing CSV input', async () => {
  const harness = createHarness({ inputPresent: true });
  assert.equal(await harness.BWE.injectNames(['Alpha', 'B"eta']), true);
  assert.equal(injectedCsv(harness), '"Alpha"\n"B""eta"');
});

test('uses Reset to restore the CSV input before applying live settings', async () => {
  const harness = createHarness({ resetPresent: true });
  const applied = await harness.BWE.applySettings({
    title: 'Updated Wheel',
    subtitle: 'Updated Deck',
    names: ['Gamma', 'Delta'],
  });

  assert.equal(applied, true);
  assert.equal(harness.state.resetClicks, 1);
  assert.equal(harness.title.textContent, 'Updated Wheel');
  assert.equal(harness.subtitle.textContent, 'Updated Deck');
  assert.equal(injectedCsv(harness), '"Gamma"\n"Delta"');
});

test('waits for the compiled wheel input during initial render', async () => {
  const harness = createHarness();
  setTimeout(harness.renderInput, 10);

  assert.equal(await harness.BWE.injectNames(['Initial', 'Deck']), true);
  assert.equal(harness.state.resetClicks, 0);
  assert.equal(injectedCsv(harness), '"Initial"\n"Deck"');
});

test('removes a drawn winner from the live wheel', async () => {
  const harness = createHarness({ inputPresent: true });
  await harness.BWE.applySettings({ names: ['Alpha', 'Beta', 'Gamma'] });

  harness.state.input.dispatchedEvents = [];
  const result = await harness.BWE.removeWinner('Beta');

  assert.equal(result.removed, true);
  assert.equal(result.applied, true);
  assert.equal(injectedCsv(harness), '"Alpha"\n"Gamma"');
  assert.deepEqual([...harness.BWE.getRemainingNames()], ['Alpha', 'Gamma']);
});

test('never puts the same name on the wheel twice', async () => {
  const harness = createHarness({ inputPresent: true });
  await harness.BWE.applySettings({ names: ['Alpha', 'Beta', 'alpha ', 'Beta'] });

  assert.equal(injectedCsv(harness), '"Alpha"\n"Beta"');
});

test('does not refill the wheel when one name is left', async () => {
  const harness = createHarness({ inputPresent: true });
  await harness.BWE.applySettings({ names: ['Alpha', 'Beta'] });

  harness.state.input.dispatchedEvents = [];
  const result = await harness.BWE.removeWinner('Alpha');

  assert.deepEqual([...result.remaining], ['Beta']);
  assert.equal(injectedCsv(harness), '"Beta"');
});

test('drawn names stay off the wheel after a page reload', async () => {
  const storage = new Map();
  const settings = { names: ['Alpha', 'Beta', 'Gamma'] };

  const first = createHarness({ inputPresent: true, storage });
  await first.BWE.applySettings(settings);
  await first.BWE.removeWinner('Beta');

  const reloaded = createHarness({ inputPresent: true, storage });
  await reloaded.BWE.applySettings(settings);
  assert.equal(injectedCsv(reloaded), '"Alpha"\n"Gamma"');
});

test('resetting drawn names or changing the list starts a new round', async () => {
  const storage = new Map();
  const first = createHarness({ inputPresent: true, storage });
  await first.BWE.applySettings({ names: ['Alpha', 'Beta', 'Gamma'] });
  await first.BWE.removeWinner('Beta');

  const changed = createHarness({ inputPresent: true, storage });
  await changed.BWE.applySettings({ names: ['Alpha', 'Beta', 'Gamma', 'Delta'] });
  assert.equal(injectedCsv(changed), '"Alpha"\n"Beta"\n"Gamma"\n"Delta"');

  await changed.BWE.removeWinner('Delta');
  changed.BWE.resetDrawnNames();
  const reset = createHarness({ inputPresent: true, storage });
  await reset.BWE.applySettings({ names: ['Alpha', 'Beta', 'Gamma', 'Delta'] });
  assert.equal(injectedCsv(reset), '"Alpha"\n"Beta"\n"Gamma"\n"Delta"');
});

test('ignores winners that are not on the wheel', async () => {
  const harness = createHarness({ inputPresent: true });
  await harness.BWE.applySettings({ names: ['Alpha', 'Beta', 'Gamma'] });

  harness.state.input.dispatchedEvents = [];
  const result = await harness.BWE.removeWinner('Zed');

  assert.equal(result.removed, false);
  assert.equal(harness.state.input.dispatchedEvents.length, 0);
});
