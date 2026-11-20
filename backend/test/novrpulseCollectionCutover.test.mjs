import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runCollection } from '../src/services/novrpulse/ingest.js';
import config from '../src/config/env.js';

/**
 * Focused tests for the Phase 4 cutover selector. The point is the ONE-WRITER
 * invariant: `runCollection` dispatches to exactly one path per invocation, the
 * default (flag OFF) is the in-app path, and a collector error never silently
 * falls back to in-app (which would risk a double write).
 *
 * No database, no network: both paths are injected via the `_paths` seam,
 * mirroring the existing backend test style.
 */

/** A path stub that records its invocation and returns a tagged summary. */
function spyPath(label) {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    return { ran: label, stored: 1, skipped: 0, events: 1 };
  };
  return { fn, calls };
}

describe('runCollection: flag OFF uses the in-app path only', () => {
  test('default (no override) selects in-app and never touches the collector', async () => {
    const inApp = spyPath('in-app');
    const collector = spyPath('collector');

    const summary = await runCollection({ enabled: false, _paths: { inApp: inApp.fn, collector: collector.fn } });

    assert.equal(summary.path, 'in-app');
    assert.equal(summary.ran, 'in-app');
    assert.equal(inApp.calls.length, 1, 'in-app path must run exactly once');
    assert.equal(collector.calls.length, 0, 'collector must NOT run when the flag is OFF');
  });

  test('the configured default is OFF (no config change = today\'s behaviour)', () => {
    assert.equal(config.novrpulse.collection.enabled, false);
  });
});

describe('runCollection: flag ON uses the collector path only', () => {
  test('selects collector and never touches the in-app path', async () => {
    const inApp = spyPath('in-app');
    const collector = spyPath('collector');

    const summary = await runCollection({ enabled: true, _paths: { inApp: inApp.fn, collector: collector.fn } });

    assert.equal(summary.path, 'collector');
    assert.equal(summary.ran, 'collector');
    assert.equal(collector.calls.length, 1, 'collector path must run exactly once');
    assert.equal(inApp.calls.length, 0, 'in-app must NOT run when the flag is ON');
  });
});

describe('runCollection: exactly one writer per invocation', () => {
  test('the two paths are never both invoked (OFF and ON)', async () => {
    for (const enabled of [false, true]) {
      const inApp = spyPath('in-app');
      const collector = spyPath('collector');
      await runCollection({ enabled, _paths: { inApp: inApp.fn, collector: collector.fn } });
      const total = inApp.calls.length + collector.calls.length;
      assert.equal(total, 1, `enabled=${enabled}: exactly one path must run, got ${total}`);
    }
  });
});

describe('runCollection: a collector failure fails loudly (no silent fallback)', () => {
  test('a thrown collector error rejects and the in-app path is never called', async () => {
    const inApp = spyPath('in-app');
    let inAppRan = false;
    const boom = async () => {
      const err = new Error('collector unreachable');
      err.code = 'COLLECTOR_UNREACHABLE';
      throw err;
    };

    await assert.rejects(
      () =>
        runCollection({
          enabled: true,
          _paths: {
            inApp: async (opts) => {
              inAppRan = true;
              return inApp.fn(opts);
            },
            collector: boom,
          },
        }),
      (err) => err.code === 'COLLECTOR_UNREACHABLE',
    );

    assert.equal(inAppRan, false, 'a collector failure must NOT fall back to the in-app path');
    assert.equal(inApp.calls.length, 0);
  });
});
