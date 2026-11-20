import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCES,
  allSources,
  getSource,
  sourcesByTier,
  enabledCollectorSources,
  registryStats,
} from '../src/sources.js';
import { parsers } from '../src/parse/index.js';

// The registry is the ONE authority for NovrPulse sources, shared by the in-app
// collector and the standalone collector. These tests pin the data (42 total,
// 19 enabled) and the selector contract. If a count changes, that is a data
// change and must be made deliberately in `sources.js` — not by editing tests.

describe('sources registry: shape', () => {
  test('SOURCES holds 42 entries', () => {
    assert.equal(SOURCES.length, 42);
  });

  test('allSources() returns the same registry object (no copy)', () => {
    assert.strictEqual(allSources(), SOURCES);
  });

  test('every source has a unique id', () => {
    const ids = SOURCES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('sources registry: enabled set', () => {
  test('enabledCollectorSources() is exactly 19', () => {
    assert.equal(enabledCollectorSources().length, 19);
  });

  test('every enabled source has a feedUrl and a dispatchable parser', () => {
    const enabled = enabledCollectorSources();
    assert.ok(enabled.length > 0, 'expected at least one enabled source');
    for (const s of enabled) {
      assert.ok(s.feedUrl, `${s.id} must have feedUrl`);
      const key = s.parser ?? s.type;
      assert.ok(key in parsers, `${s.id} dispatch key "${key}" must be a registered parser`);
    }
  });

  test('no disabled source leaks into the enabled set', () => {
    const enabledIds = new Set(enabledCollectorSources().map((s) => s.id));
    for (const s of SOURCES) {
      if (!s.enabled) assert.ok(!enabledIds.has(s.id), `${s.id} is disabled but was collected`);
    }
  });

  test('the enabled set is exactly enabled + feed-backed + dispatchable', () => {
    const expected = SOURCES.filter(
      (s) => s.enabled && s.feedUrl && (s.parser ?? s.type) in parsers,
    )
      .map((s) => s.id)
      .sort();
    assert.deepEqual(
      enabledCollectorSources()
        .map((s) => s.id)
        .sort(),
      expected,
    );
  });
});

describe('sources registry: selectors', () => {
  test('getSource finds by id and returns undefined otherwise', () => {
    assert.equal(getSource('ncc').name, 'Nigerian Communications Commission');
    assert.equal(getSource('does-not-exist'), undefined);
  });

  test('sourcesByTier filters by tier', () => {
    for (const s of sourcesByTier(1)) assert.equal(s.tier, 1);
    assert.ok(sourcesByTier(1).length > 0);
  });

  test('registryStats reports total and enabled consistently', () => {
    const stats = registryStats();
    assert.equal(stats.total, SOURCES.length);
    assert.equal(stats.enabled, enabledCollectorSources().length);
    const summed = Object.values(stats.byStatus).reduce((a, b) => a + b, 0);
    assert.equal(summed, SOURCES.length);
  });
});
