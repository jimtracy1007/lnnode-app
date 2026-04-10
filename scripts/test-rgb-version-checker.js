#!/usr/bin/env node
/**
 * Unit tests for the pure functions in src/services/rgb-version-checker.js.
 *
 * The project has no test framework, so this is a standalone Node script
 * using node:assert. Run with:
 *
 *   node scripts/test-rgb-version-checker.js
 *   # or
 *   yarn test:rgb-version
 *
 * The checker module transitively requires electron (for `app`/`dialog`),
 * which throws `Cannot read properties of undefined` when loaded from a
 * plain Node process. We inject a minimal electron stub into the module
 * cache before requiring the checker, so only the pure classification
 * logic is exercised — the interactive dialog path is not tested here.
 */

'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

// Stub electron: app.isPackaged is touched by path-manager at require time,
// and app / dialog would be touched by the checker's dialog path (which
// these tests never invoke). Provide just enough surface to load cleanly.
const electronStub = {
  app: {
    isPackaged: false,
    getAppPath: () => path.resolve(__dirname, '..'),
    getPath: (key) => {
      if (key === 'userData') return path.resolve(__dirname, '..', '.test-userdata');
      return path.resolve(__dirname, '..');
    },
    exit: (code) => {
      throw new Error(`unexpected app.exit(${code}) during unit test`);
    },
  },
  dialog: {
    showMessageBox: async () => {
      throw new Error('unexpected dialog.showMessageBox during unit test');
    },
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, parent, ...rest) {
  if (request === 'electron') return 'electron';
  return origResolve.call(this, request, parent, ...rest);
};
require.cache.electron = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: electronStub,
};

const {
  parseVersion,
  compareVersions,
  classifyUpgrade,
} = require('../src/services/rgb-version-checker');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message}`);
  }
}

console.log('parseVersion');
test('parses plain release', () => {
  assert.deepEqual(parseVersion('v0.2.1'), {
    major: 0, minor: 2, patch: 1, pre: null, preNum: null, raw: 'v0.2.1',
  });
});
test('parses release-candidate', () => {
  assert.deepEqual(parseVersion('v0.2.1-rc.6'), {
    major: 0, minor: 2, patch: 1, pre: 'rc', preNum: 6, raw: 'v0.2.1-rc.6',
  });
});
test('parses without leading v', () => {
  assert.equal(parseVersion('0.2.1').major, 0);
});
test('returns null for garbage', () => {
  assert.equal(parseVersion('garbage'), null);
});
test('returns null for non-string', () => {
  assert.equal(parseVersion(null), null);
  assert.equal(parseVersion(undefined), null);
  assert.equal(parseVersion(42), null);
});

console.log('compareVersions');
function cmp(a, b) { return compareVersions(parseVersion(a), parseVersion(b)); }
test('equal versions compare 0', () => {
  assert.equal(cmp('v0.2.1-rc.6', 'v0.2.1-rc.6'), 0);
});
test('rc.5 < rc.6', () => {
  assert.equal(cmp('v0.2.1-rc.5', 'v0.2.1-rc.6'), -1);
});
test('rc.6 < final 0.2.1 (semver pre-release rule)', () => {
  assert.equal(cmp('v0.2.1-rc.6', 'v0.2.1'), -1);
});
test('final 0.2.1 > rc.6', () => {
  assert.equal(cmp('v0.2.1', 'v0.2.1-rc.6'), 1);
});
test('0.2.1 > 0.2.0', () => {
  assert.equal(cmp('v0.2.1', 'v0.2.0'), 1);
});
test('0.3.0 > 0.2.99', () => {
  assert.equal(cmp('v0.3.0', 'v0.2.99'), 1);
});
test('1.0.0 > 0.9.9', () => {
  assert.equal(cmp('v1.0.0', 'v0.9.9'), 1);
});

console.log('classifyUpgrade');
const BVS = ['v0.2.1-rc.6'];

test('non-breaking: rc.6 -> rc.7 (past boundary)', () => {
  const r = classifyUpgrade('v0.2.1-rc.6', 'v0.2.1-rc.7', BVS);
  assert.equal(r.breaking, false);
});
test('non-breaking: rc.6 -> final 0.2.1', () => {
  const r = classifyUpgrade('v0.2.1-rc.6', 'v0.2.1', BVS);
  assert.equal(r.breaking, false);
});
test('non-breaking: 0.2.1 -> 0.2.2 (entirely past boundary)', () => {
  const r = classifyUpgrade('v0.2.1', 'v0.2.2', BVS);
  assert.equal(r.breaking, false);
});

test('breaking: rc.5 -> rc.6 (hits boundary exactly)', () => {
  const r = classifyUpgrade('v0.2.1-rc.5', 'v0.2.1-rc.6', BVS);
  assert.equal(r.breaking, true);
  assert.equal(r.crossed, 'v0.2.1-rc.6');
});
test('breaking: 0.2.0 -> rc.6 (crosses boundary)', () => {
  const r = classifyUpgrade('v0.2.0', 'v0.2.1-rc.6', BVS);
  assert.equal(r.breaking, true);
});
test('breaking: 0.2.0 -> rc.7 (crosses rc.6 on the way)', () => {
  const r = classifyUpgrade('v0.2.0', 'v0.2.1-rc.7', BVS);
  assert.equal(r.breaking, true);
  assert.equal(r.crossed, 'v0.2.1-rc.6');
});
test('breaking: 0.1.9 -> 0.2.1 final (crosses rc.6)', () => {
  const r = classifyUpgrade('v0.1.9', 'v0.2.1', BVS);
  assert.equal(r.breaking, true);
});

test('unknown: downgrade rc.7 -> rc.6 (forces user prompt)', () => {
  const r = classifyUpgrade('v0.2.1-rc.7', 'v0.2.1-rc.6', BVS);
  assert.equal(r.breaking, null);
  assert.match(r.reason, /downgrade/);
});
test('unknown: downgrade final 0.2.1 -> rc.6', () => {
  const r = classifyUpgrade('v0.2.1', 'v0.2.1-rc.6', BVS);
  assert.equal(r.breaking, null);
  assert.match(r.reason, /downgrade/);
});

test('unknown: missing compat list', () => {
  const r = classifyUpgrade('v0.2.1-rc.5', 'v0.2.1-rc.6', null);
  assert.equal(r.breaking, null);
  assert.match(r.reason, /compat/);
});
test('unknown: unparseable stored tag', () => {
  const r = classifyUpgrade('garbage', 'v0.2.1-rc.6', BVS);
  assert.equal(r.breaking, null);
  assert.match(r.reason, /stored/);
});
test('unknown: unparseable expected tag', () => {
  const r = classifyUpgrade('v0.2.1-rc.5', 'garbage', BVS);
  assert.equal(r.breaking, null);
  assert.match(r.reason, /expected/);
});
test('unparseable entry inside breakingVersions is skipped, not thrown', () => {
  const r = classifyUpgrade('v0.2.1-rc.5', 'v0.2.1-rc.6', ['garbage', 'v0.2.1-rc.6']);
  assert.equal(r.breaking, true);
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
