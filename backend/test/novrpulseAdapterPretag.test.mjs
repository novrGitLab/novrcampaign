import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';

const { novrPulseAdapter } = await import('../src/services/novrpulse/adapter.js');

// Tests for the store-time deterministic pre-tag wiring in the adapter.
//
// The adapter's `storeBatch` is driven against an in-memory fake shadowing the
// shared Prisma singleton's delegates. No DB, no network (the L1 registry is
// in-process via `getSource`).

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stand-ins for the adapter's write path.
// ─────────────────────────────────────────────────────────────────────────────

function makeStore() {
  const events = [];
  const raws = [];
  const pivot = [];
  let seq = 0;

  const npRawDocument = {
    async findMany() {
      return [];
    },
    async create({ data }) {
      const row = { id: `rd-${seq += 1}`, ...data };
      raws.push(row);
      return row;
    },
  };

  const npEvent = {
    async findMany() {
      return [];
    },
    async create({ data }) {
      const row = { id: `ev-${seq += 1}`, ...data };
      // `sources.create` is a nested write; flatten it into the pivot list.
      if (data.sources?.create) pivot.push({ eventId: row.id, ...data.sources.create });
      delete row.sources;
      events.push(row);
      return row;
    },
  };

  const npEventSource = {
    async create({ data }) {
      pivot.push({ ...data });
      return { ...data };
    },
    async upsert({ create }) {
      pivot.push({ ...create });
      return { ...create };
    },
  };

  const store = { events, raws, pivot, npRawDocument, npEvent, npEventSource };
  store.$transaction = async (arg, opts) => {
    void opts;
    return typeof arg === 'function' ? arg(store) : Promise.all(arg);
  };
  return store;
}

const DELEGATES = ['npRawDocument', 'npEvent', 'npEventSource', '$transaction'];

async function withPrisma(store, fn) {
  const saved = new Map();
  for (const key of DELEGATES) {
    saved.set(key, { had: Object.prototype.hasOwnProperty.call(prisma, key), value: prisma[key] });
    Object.defineProperty(prisma, key, { value: store[key], configurable: true, writable: true });
  }
  try {
    return await fn();
  } finally {
    for (const key of DELEGATES) {
      const { had, value } = saved.get(key);
      if (had) Object.defineProperty(prisma, key, { value, configurable: true, writable: true });
      else delete prisma[key];
    }
  }
}

after(() => {
  for (const key of DELEGATES) delete prisma[key];
});

/** A neutral engine item, with overrides. */
function item(over = {}) {
  return {
    contentHash: `h-${Math.random()}`,
    link: `https://e.test/${Math.random()}`,
    sourceId: 'techcabal',
    title: 'A generic headline',
    publishedAt: new Date().toISOString(),
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('adapter storeBatch: deterministic pre-tag', () => {
  test('a cyber keyword sets ONLY isCybersecurity (other flags stay unset)', async () => {
    const store = makeStore();
    await withPrisma(store, () =>
      novrPulseAdapter.storeBatch([item({ title: 'Ransomware hits a Lagos hospital' })]),
    );
    const ev = store.events[0];
    assert.equal(ev.isCybersecurity, true, 'cyber keyword set');
    assert.equal(ev.isThreatIntel, undefined, 'no threat keyword → column left unset (NULL)');
    // 'Lagos' is a Nigeria keyword → the regional cyber tier is NG.
    assert.equal(ev.cyberRegion, 'NG');
    // isNigeriaRelated is deprecated and is no longer written.
    assert.equal(ev.isNigeriaRelated, undefined, 'deprecated column not written');
  });

  test('a clean non-cyber story sets no flags and a null cyberRegion', async () => {
    const store = makeStore();
    await withPrisma(store, () =>
      novrPulseAdapter.storeBatch([
        item({ sourceId: 'bleepingcomputer', title: 'A quiet weekend in the city' }),
      ]),
    );
    const ev = store.events[0];
    assert.equal(ev.isCybersecurity, undefined);
    assert.equal(ev.isThreatIntel, undefined);
    assert.equal(ev.isNigeriaRelated, undefined);
    // cyberRegion is ALWAYS written: null when the item is not cyber.
    assert.equal(ev.cyberRegion, null);
  });

  test('region NG from the source registry sets the NG cyber tier with no keyword', async () => {
    const store = makeStore();
    await withPrisma(store, () =>
      novrPulseAdapter.storeBatch([item({ sourceId: 'ncc', title: 'A generic headline' })]),
    );
    assert.equal(store.events[0].cyberRegion, 'NG');
    assert.equal(store.events[0].isNigeriaRelated, undefined);
  });

  test('a GLOBAL source with no keyword leaves the tier GLOBAL (threat intel set, not cyber)', async () => {
    const store = makeStore();
    await withPrisma(store, () =>
      novrPulseAdapter.storeBatch([
        item({ sourceId: 'bleepingcomputer', title: 'Backdoor found in a library' }),
      ]),
    );
    const ev = store.events[0];
    // 'backdoor' is a threat keyword → isThreatIntel set; the story is not cyber
    // by keyword, so isCybersecurity stays NULL and cyberRegion is null.
    assert.equal(ev.isThreatIntel, true);
    assert.equal(ev.isCybersecurity, undefined);
    assert.equal(ev.isNigeriaRelated, undefined);
    assert.equal(ev.cyberRegion, null);
  });

  test('the motivating example: no obvious cyber keyword still yields the NG tier from the source', async () => {
    const store = makeStore();
    await withPrisma(store, () =>
      novrPulseAdapter.storeBatch([
        item({
          sourceId: 'techcabal',
          title: 'FG moves to regulate scrap metal trade as cable theft threatens infrastructure',
        }),
      ]),
    );
    const ev = store.events[0];
    // Zero obvious cyber keyword → isCybersecurity NULL (the accurate AI pass fills it).
    assert.equal(ev.isCybersecurity, undefined);
    assert.equal(ev.isThreatIntel, undefined);
    // The NG source suggests the Nigeria cyber tier.
    assert.equal(ev.cyberRegion, 'NG');
    assert.equal(ev.isNigeriaRelated, undefined, 'deprecated column not written');
  });
});
