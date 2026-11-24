import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import { listPublishItems } from '../src/controllers/publishController.js';

// Focused tests for the Briefing Desk "Attach existing" picker filter
// (`GET /api/publish?usableForDesk=true`).
//
// Rule under test: an item is usable when it is manually authored (no linked
// event) OR its linked inbox event has `reviewStatus='accepted'`. An item whose
// event is 'new' (un-triaged) or 'dismissed' is NOT offered.
//
// No live database: the shared Prisma `publishItem` delegate is shadowed with an
// in-memory fake whose filter understands the controller's `AND` + nested
// relation shape.

function makeStore(seed) {
  const items = seed.map((i) => ({
    approvedAt: null,
    rejectedAt: null,
    publishedAt: null,
    withdrawnAt: null,
    ...i,
  }));

  // Minimal evaluator for the `where` the controller builds. Handles the flat
  // null-equality bucket, `AND` arrays, and a nested `event.reviewStatus` filter.
  function matchesRow(row, where = {}) {
    return Object.entries(where).every(([k, v]) => {
      if (k === 'AND') return v.every((sub) => matchesRow(row, sub));
      if (k === 'OR') return v.some((sub) => matchesRow(row, sub));
      if (k === 'event') {
        // Nested relation filter: only allow when the row has an event.
        return row.event ? matchesRow(row.event, v) : false;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('not' in v) return row[k] !== v.not;
      }
      return row[k] === v;
    });
  }

  const publishItem = {
    async findMany({ where, take } = {}) {
      const out = items.filter((i) => matchesRow(i, where));
      return take !== undefined ? out.slice(0, take) : out;
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

async function callList(req) {
  const res = fakeRes();
  await listPublishItems(req, res);
  return res.payload;
}

after(() => {
  delete prisma.publishItem;
});

describe('desk picker: usableForDesk eligibility', () => {
  const draft = (overrides) => ({
    contentType: 'briefing',
    body: 'b',
    templateVersion: 'f7@1.0.0',
    ...overrides,
  });

  test('excludes items whose linked event is not accepted; includes manually authored ones', async () => {
    const store = makeStore([
      // Manually authored (no linked event) → included.
      draft({ id: 'manual', eventId: null, event: null }),
      // Linked event accepted → included.
      draft({ id: 'accepted', eventId: 'e-acc', event: { reviewStatus: 'accepted' } }),
      // Linked event un-triaged → excluded.
      draft({ id: 'new', eventId: 'e-new', event: { reviewStatus: 'new' } }),
      // Linked event dismissed → excluded.
      draft({ id: 'dismissed', eventId: 'e-dis', event: { reviewStatus: 'dismissed' } }),
    ]);

    const payload = await withPrisma(store, () =>
      callList({ query: { usableForDesk: 'true' }, user: { id: 'u', role: 'VIEWER' } }),
    );

    assert.deepEqual(payload.items.map((i) => i.id).sort(), ['accepted', 'manual']);
  });

  test('without usableForDesk the filter is NOT applied (default listing unchanged)', async () => {
    const store = makeStore([
      draft({ id: 'manual', eventId: null, event: null }),
      draft({ id: 'new', eventId: 'e-new', event: { reviewStatus: 'new' } }),
    ]);

    const payload = await withPrisma(store, () =>
      callList({ query: {}, user: { id: 'u', role: 'VIEWER' } }),
    );

    assert.deepEqual(payload.items.map((i) => i.id).sort(), ['manual', 'new']);
  });

  test('a non-boolean usableForDesk value is rejected by validation', async () => {
    const store = makeStore([]);
    await assert.rejects(
      () => withPrisma(store, () => callList({ query: { usableForDesk: 'maybe' } })),
      'usableForDesk=maybe must fail validation',
    );
  });
});
