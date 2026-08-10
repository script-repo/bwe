'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HISTORY_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'history.js'), 'utf8');

test('records each winner overlay exactly once across later DOM mutations', () => {
  const documentListeners = new Map();
  const recordedNames = [];
  let mutationCallback;

  class FakeElement {
    constructor() {
      this.style = {};
      this.textContent = '';
    }
    addEventListener() {}
    appendChild() {}
    setAttribute() {}
    querySelector() {
      return new FakeElement();
    }
  }

  class FakeMutationObserver {
    constructor(callback) {
      mutationCallback = callback;
    }
    observe() {}
  }

  const winnerName = { textContent: 'Ada Lovelace' };
  const overlay = {
    querySelector(selector) {
      return selector === '.winner-card > div' ? winnerName : null;
    },
  };

  const document = {
    readyState: 'loading',
    body: new FakeElement(),
    createElement: () => new FakeElement(),
    addEventListener(type, callback) {
      documentListeners.set(type, callback);
    },
    querySelectorAll(selector) {
      return selector === '.winner-overlay' ? [overlay] : [];
    },
  };

  const window = {
    BWE: {
      getIconCluster: () => new FakeElement(),
      addHistoryEntry(name) {
        recordedNames.push(name);
        return Promise.resolve();
      },
    },
  };

  vm.runInNewContext(
    HISTORY_SOURCE,
    { window, document, MutationObserver: FakeMutationObserver, console, confirm: () => true },
    { filename: 'history.js' }
  );

  documentListeners.get('DOMContentLoaded')();
  mutationCallback();
  mutationCallback();

  assert.deepEqual(recordedNames, ['Ada Lovelace']);
});
