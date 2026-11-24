import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import {
  approvePublishItem,
  editPublishItem,
  assertSectionRequirements,
} from '../src/controllers/publishController.js';

// Per-item pillar fields + approval gates (owner spec 2026-11-24):
//   * 01 Regulatory Impact — `regulatoryImpact` must be non-empty to approve.
//   * 05 Events — `eventDate` must exist and be ≥ now + 7 days to approve.
//   * PATCH persists `regulatoryImpact` / `eventDate` alongside `body`.
//
// No live database: the shared Prisma singleton's `publishItem` delegate is
// shadowed with an in-memory fake (the same pattern as the QA suite), so the
// REAL controller path is exercised (which field it reads, when it writes).

function makeStore(seedItems = []) {
  const items = seedItems.map((i) => ({
    approvedAt: null, rejectedAt: null, publishedAt: null, withdrawnAt: null,
    regulatoryImpact: null, eventDate: null, ...i,
  }));
  let idSeq = 0;
  const publishItem = {
    async findUnique({ where }) {
      return items.find((i) => i.id === where.id) ?? null;
    },
    async update({ where, data }) {
      const item = items.find((i) => i.id === where.id);
      if (!item) throw new Error('record not found');
      Object.assign(item, data);
      return { ...item };
    },
    async create({ data }) {
      idSeq += 1;
      const row = { id: `pi-${idSeq}`, approvedAt: null, rejectedAt: null, publishedAt: null, withdrawnAt: null, ...data };
      items.push(row);
      return { ...row };
    },
  };
  return { items, publishItem };
}

async function withPrisma(store, fn) {
  const had = Object.prototype.hasOwnProperty.call(prisma, 'publishItem');
  Object.defineProperty(prisma, 'publishItem', { value: store.publishItem, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (!had) delete prisma.publishItem;
  }
}

function fakeRes() {
  const res = {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
  };
  return res;
}

async function callController(fn, req) {
  const res = fakeRes();
  try {
    await fn(req, res);
    return { statusCode: res.statusCode, payload: res.payload };
  } catch (error) {
    return { error };
  }
}

after(() => {
  delete prisma.publishItem;
});

const DAY_MS = 24 * 60 * 60 * 1000;
const future = (days) => new Date(Date.now() + days * DAY_MS);

function item01(overrides = {}) {
  return {
    id: 'pi-01',
    eventId: 'evt-01',
    functionId: 1,
    tier: 'public',
    body: 'Body',
    templateVersion: 'canvas@1.0.0',
    editorId: null,
    ...overrides,
  };
}

function item05(overrides = {}) {
  return { ...item01(), id: 'pi-05', functionId: 5, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// assertSectionRequirements — the pure gate.
// ─────────────────────────────────────────────────────────────────────────────

describe('section requirements: pure gate', () => {
  test('01 with empty/whitespace regulatoryImpact is refused with the code', () => {
    for (const regulatoryImpact of [null, undefined, '', '   ']) {
      assert.throws(
        () => assertSectionRequirements(item01({ regulatoryImpact })),
        (err) => err.statusCode === 422 && err.code === 'REGULATORY_IMPACT_REQUIRED',
      );
    }
  });

  test('01 with a non-empty regulatoryImpact passes', () => {
    assert.doesNotThrow(() => assertSectionRequirements(item01({ regulatoryImpact: 'Affects NDPA 2023.' })));
  });

  test('05 without an eventDate is refused with EVENT_DATE_REQUIRED', () => {
    assert.throws(
      () => assertSectionRequirements(item05({ eventDate: null })),
      (err) => err.statusCode === 422 && err.code === 'EVENT_DATE_REQUIRED',
    );
  });

  test('05 with an eventDate < now + 7 days is refused with EVENT_NOTICE_TOO_SHORT', () => {
    for (const d of [future(0), future(3), future(6.9)]) {
      assert.throws(
        () => assertSectionRequirements(item05({ eventDate: d })),
        (err) => err.statusCode === 422 && err.code === 'EVENT_NOTICE_TOO_SHORT',
      );
    }
  });

  test('05 with an eventDate exactly at/after now + 7 days passes', () => {
    assert.doesNotThrow(() => assertSectionRequirements(item05({ eventDate: future(7.1) })));
    assert.doesNotThrow(() => assertSectionRequirements(item05({ eventDate: future(30) })));
  });

  test('other functionIds are pass-through (no new requirement)', () => {
    for (const functionId of [2, 3, 4, 6, 7, 8, null]) {
      assert.doesNotThrow(() => assertSectionRequirements(item01({ functionId, regulatoryImpact: null, eventDate: null })));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// approvePublishItem — the gate runs BEFORE the write.
// ─────────────────────────────────────────────────────────────────────────────

describe('approve gate: 01 regulatory impact', () => {
  test('refuses approval without regulatoryImpact (422) and does NOT set approvedAt', async () => {
    const store = makeStore([item01({ regulatoryImpact: null })]);
    const { error } = await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'pi-01' }, user: { id: 'u-1' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, 'REGULATORY_IMPACT_REQUIRED');
    assert.equal(store.items[0].approvedAt, null, 'a refused approve must not sign off');
  });

  test('approves 01 once regulatoryImpact is present', async () => {
    const store = makeStore([item01({ regulatoryImpact: 'Rules for lenders.' })]);
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'pi-01' }, user: { id: 'u-1' } }),
    );
    assert.equal(statusCode, 200);
    assert.ok(store.items[0].approvedAt instanceof Date);
    assert.equal(payload.item.regulatoryImpact, 'Rules for lenders.');
  });
});

describe('approve gate: 05 event notice', () => {
  test('refuses an event date < 7 days out (422 EVENT_NOTICE_TOO_SHORT), no write', async () => {
    const store = makeStore([item05({ eventDate: future(2) })]);
    const { error } = await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'pi-05' }, user: { id: 'u-1' } }),
    );
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, 'EVENT_NOTICE_TOO_SHORT');
    assert.equal(store.items[0].approvedAt, null);
  });

  test('refuses a missing event date (422 EVENT_DATE_REQUIRED)', async () => {
    const store = makeStore([item05({ eventDate: null })]);
    const { error } = await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'pi-05' }, user: { id: 'u-1' } }),
    );
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, 'EVENT_DATE_REQUIRED');
    assert.equal(store.items[0].approvedAt, null);
  });

  test('approves 05 once the event date is ≥ 7 days ahead', async () => {
    const store = makeStore([item05({ eventDate: future(10) })]);
    const { statusCode } = await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'pi-05' }, user: { id: 'u-1' } }),
    );
    assert.equal(statusCode, 200);
    assert.ok(store.items[0].approvedAt instanceof Date);
  });

  test('a non-01/05 item approves with no new field (regression: existing flows unaffected)', async () => {
    const store = makeStore([item01({ id: 'pi-07', functionId: 7 })]);
    const { statusCode } = await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'pi-07' }, user: { id: 'u-1' } }),
    );
    assert.equal(statusCode, 200);
    assert.ok(store.items[0].approvedAt instanceof Date);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// editPublishItem — PATCH persists the two new fields.
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH: per-item fields', () => {
  test('persists regulatoryImpact and eventDate alongside body (only provided fields)', async () => {
    const store = makeStore([item01({ id: 'pi-ed', functionId: 1 })]);
    const when = future(14).toISOString();
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(editPublishItem, {
        params: { id: 'pi-ed' },
        user: { id: 'e' },
        body: { body: 'new body', regulatoryImpact: 'Affects NDPA.', eventDate: when },
      }),
    );
    assert.equal(statusCode, 200);
    assert.equal(store.items[0].body, 'new body');
    assert.equal(store.items[0].regulatoryImpact, 'Affects NDPA.');
    assert.ok(store.items[0].eventDate instanceof Date, 'eventDate persisted as a Date');
    assert.equal(payload.item.regulatoryImpact, 'Affects NDPA.');
    assert.equal(payload.item.eventDate, new Date(when).toISOString());
  });

  test('an omitted field is left untouched; an empty regulatoryImpact clears it', async () => {
    const store = makeStore([item01({ regulatoryImpact: 'keep body', body: 'orig' })]);
    await withPrisma(store, () =>
      callController(editPublishItem, { params: { id: 'pi-01' }, user: { id: 'e' }, body: { regulatoryImpact: 'x' } }),
    );
    assert.equal(store.items[0].body, 'orig', 'body must be untouched when omitted');
    assert.equal(store.items[0].regulatoryImpact, 'x');

    await withPrisma(store, () =>
      callController(editPublishItem, { params: { id: 'pi-01' }, user: { id: 'e' }, body: { regulatoryImpact: '' } }),
    );
    assert.equal(store.items[0].regulatoryImpact, null, 'an empty string clears the field');
  });

  test('a PATCH with no updatable field is refused (400)', async () => {
    const store = makeStore([item01({ id: 'pi-ed' })]);
    const { error } = await withPrisma(store, () =>
      callController(editPublishItem, { params: { id: 'pi-ed' }, user: { id: 'e' }, body: {} }),
    );
    assert.equal(error.statusCode, 400);
  });

  test('a published item still cannot be edited (409)', async () => {
    const store = makeStore([item01({ id: 'pi-ed', publishedAt: new Date() })]);
    const { error } = await withPrisma(store, () =>
      callController(editPublishItem, { params: { id: 'pi-ed' }, user: { id: 'e' }, body: { regulatoryImpact: 'x' } }),
    );
    assert.equal(error.statusCode, 409);
  });
});
