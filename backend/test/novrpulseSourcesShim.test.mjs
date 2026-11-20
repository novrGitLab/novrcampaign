import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCES as shimSources,
  allSources as shimAllSources,
  getSource as shimGetSource,
  sourcesByTier as shimSourcesByTier,
  enabledCollectorSources as shimEnabled,
  registryStats as shimStats,
  default as shimDefault,
} from '../src/services/novrpulse/sources.js';
import {
  SOURCES as engineSources,
  enabledCollectorSources as engineEnabled,
  registryStats as engineStats,
} from '@novr/ingest';

// PROOF OF ONE AUTHORITY: the backend module is a pass-through shim over the
// engine registry. Object identity (strictEqual) proves there is no second copy
// of the 42-source data in `backend/`.

describe('novrpulse sources shim: pass-through', () => {
  test('SOURCES is the same object as the engine registry (no copy)', () => {
    assert.strictEqual(shimSources, engineSources);
  });

  test('the shim carries no literal source objects of its own', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/services/novrpulse/sources.js', import.meta.url));
    const text = await readFile(path, 'utf8');
    assert.ok(!/id:\s*'/.test(text), 'shim must not contain source object literals');
    assert.ok(text.includes('@novr/ingest'), 'shim must re-export from @novr/ingest');
  });

  test('enabledCollectorSources is the same function as the engine', () => {
    assert.strictEqual(shimEnabled, engineEnabled);
  });

  test('selectors return the same identity/values as the engine', () => {
    assert.strictEqual(shimAllSources(), engineSources);
    assert.strictEqual(shimGetSource('ncc'), engineSources.find((s) => s.id === 'ncc'));
    assert.deepEqual(shimSourcesByTier(1), engineSources.filter((s) => s.tier === 1));
    assert.deepEqual(shimEnabled(), engineEnabled());
    // Derive the expected stats from the engine itself rather than freezing a
    // data snapshot: the point is that the shim passes the engine value THROUGH,
    // not that the registry happens to hold a particular set of sources today.
    assert.deepEqual(shimStats(), engineStats());
  });

  test('the default export forwards the engine registry', () => {
    assert.strictEqual(shimDefault.SOURCES, engineSources);
  });
});
