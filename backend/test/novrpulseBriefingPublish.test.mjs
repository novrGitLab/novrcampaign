import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import { publishBriefing, previewBriefing } from '../src/controllers/briefingController.js';

// Publish → Preview → Send controller tests (owner requirement 2026-11-25).
//
// No live database and no live Plunk: the shared Prisma singleton's delegates are
// shadowed with an in-memory fake (the pattern used by novrpulseBriefing.test.mjs)
// and the global `fetch` is stubbed so the REAL plunkService request builder runs
// against a fake transport. That exercises the controller end to end — the
// renderer reuse, the guards, the test vs production send paths, the publication
// snapshot, the published stamps, and the honest 502 on a provider failure.

// ─────────────────────────────────────────────────────────────────────────────
// In-memory briefing-desk store, extended with briefingPublication.
// ─────────────────────────────────────────────────────────────────────────────

function makeStore(seed = {}) {
  const briefings = (seed.briefings ?? []).map((b) => ({ ...b }));
  const sections = (seed.sections ?? []).map((s) => ({ ...s }));
  const sectionItems = (seed.sectionItems ?? []).map((s) => ({ ...s }));
  const publishItems = (seed.publishItems ?? []).map((p) => ({
    publishedAt: null,
    ...p,
  }));
  const publications = [];

  let seq = 0;

  function withItems(section) {
    const items = sectionItems
      .filter((i) => i.sectionId === section.id)
      .sort((a, b) => a.position - b.position)
      .map((link) => ({
        ...link,
        publishItem: publishItems.find((p) => p.id === link.publishItemId) ?? null,
      }));
    return { ...section, items };
  }

  const briefing = {
    async findUnique({ where }) {
      const row = briefings.find((b) => b.id === where.id);
      if (!row) return null;
      const secs = sections
        .filter((s) => s.briefingId === row.id)
        .sort((a, b) => a.position - b.position)
        .map(withItems);
      return { ...row, sections: secs };
    },
    async updateMany({ where, data }) {
      const row=briefings.find(b=>b.id===where.id && b.publishedAt===null && (where.sendingAt!==null || !b.sendingAt));
      if(!row)return {count:0};
      Object.assign(row,data);return {count:1};
    },
    async update({ where, data }) {
      const row = briefings.find((b) => b.id === where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, data);
      return { ...row };
    },
  };

  const publishItem = {
    async update({ where, data }) {
      const row = publishItems.find((p) => p.id === where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, data);
      return { ...row };
    },
  };

  const briefingPublication = {
    async findFirst({ where, orderBy } = {}) {
      let rows = publications.filter((p) => p.briefingId === where.briefingId);
      if (orderBy?.version === 'desc') rows = rows.sort((a, b) => b.version - a.version);
      return rows[0] ? { ...rows[0] } : null;
    },
    async create({ data }) {
      seq += 1;
      const row = { id: `pub-${seq}`, ...data };
      publications.push(row);
      return { ...row };
    },
  };

  const $transaction = async (arg) => (typeof arg === 'function' ? arg(store) : Promise.all(arg));

  const store = {
    briefings,
    sections,
    sectionItems,
    publishItems,
    publications,
    briefing,
    publishItem,
    briefingPublication,
    $transaction,
  };
  return store;
}

const DELEGATES = ['briefing', 'publishItem', 'briefingPublication', '$transaction'];

async function withPrisma(store, fn) {
  const saved = new Map();
  for (const key of DELEGATES) {
    saved.set(key, {
      had: Object.prototype.hasOwnProperty.call(prisma, key),
      value: prisma[key],
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// Global fetch stub for the Plunk client.
// ─────────────────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
const calls = [];

/**
 * Install a fetch stub. `respond` maps a path to a response body (or a thrower).
 * Every call is recorded so the test can assert which Plunk endpoints were hit
 * (e.g. a test send must NOT hit a segment send).
 */
function stubFetch(routes) {
  calls.length = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const handler = routes(path, opts);
    if (typeof handler === 'function') return handler();
    // A full Response-like object (e.g. jsonError) is returned as-is; a plain
    // object is treated as a successful JSON body.
    if (handler && typeof handler === 'object' && 'text' in handler) return handler;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(handler ?? {}),
    };
  };
}

function jsonError(status, message, code) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify({ success: false, error: { message, code, statusCode: status } }),
  };
}

after(() => {
  globalThis.fetch = realFetch;
  for (const key of DELEGATES) delete prisma[key];
});

function fakeRes() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
    send(body) { this.payload = body; return this; },
  };
}

async function call(fn, req) {
  const res = fakeRes();
  try {
    await fn(req, res);
    return { statusCode: res.statusCode, payload: res.payload };
  } catch (error) {
    return { error };
  }
}

/** A section row with one publish item at position 0. */
function sectionWithItem({ functionId, body }) {
  return {
    section: { id: `sec-${functionId}`, briefingId: 'br-1', functionId, position: functionId, state: 'ready', note: null },
    item: { id: `si-${functionId}`, sectionId: `sec-${functionId}`, publishItemId: `pi-${functionId}`, position: 0 },
    publish: { id: `pi-${functionId}`, functionId, contentType: 'briefing', body, tier: 'public', event: null },
  };
}

/** A seeded store with a ready briefing that has items. */
function seededStore(briefingOverrides = {}) {
  const s8 = sectionWithItem({ functionId: 8, body: 'A lead headline\n\nSUMMARY\nA summary.' });
  const s7 = sectionWithItem({ functionId: 7, body: 'A breaking item\n\nWHAT HAPPENED\nIt happened.' });
  return makeStore({
    briefings: [{ id: 'br-1', briefingDate: new Date('2026-11-25T00:00:00Z'), title: null, status: 'draft', publishedAt: null, ...briefingOverrides }],
    sections: [s8.section, s7.section, ...[1,2,3,4,5,6,9,10].map(functionId=>({id:'empty-'+functionId,briefingId:'br-1',functionId,position:functionId,state:'no_updates'}))],
    sectionItems: [s8.item, s7.item],
    publishItems: [s8.publish, s7.publish],
  });
}

beforeEach(() => { calls.length = 0; });

// ─────────────────────────────────────────────────────────────────────────────
// 1. Guards.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing publish: guards', () => {
  test('a briefing with no items is refused with 400 "Nothing to publish"', async () => {
    const store = makeStore({
      briefings: [{ id: 'br-1', briefingDate: new Date('2026-11-25T00:00:00Z'), title: null, status: 'draft' }],
      sections: [{ id: 'sec-1', briefingId: 'br-1', functionId: 1, position: 1, state: 'empty' }],
      sectionItems: [],
      publishItems: [],
    });
    stubFetch(() => ({}));
    const { error } = await withPrisma(store, () => call(publishBriefing, { user: { id: 'u', email: 'me@x.io' }, params: { id: 'br-1' }, body: { test: true } }));
    assert.ok(error);
    assert.equal(error.statusCode, 400);
    assert.equal(error.message, 'Nothing to publish');
    assert.equal(calls.length, 0, 'no Plunk call for an empty briefing');
  });

  test('an already-published briefing is refused with 409', async () => {
    const store = seededStore({ status: 'published' });
    stubFetch(() => ({}));
    const { error } = await withPrisma(store, () => call(publishBriefing, { user: { id: 'u', email: 'me@x.io' }, params: { id: 'br-1' }, body: { test: true } }));
    assert.ok(error);
    assert.equal(error.statusCode, 409);
    assert.equal(calls.length, 0);
  });

  test('an unknown briefing is a 404', async () => {
    const store = makeStore();
    stubFetch(() => ({}));
    const { error } = await withPrisma(store, () => call(publishBriefing, { user: { id: 'u' }, params: { id: 'ghost' }, body: { test: true } }));
    assert.equal(error.statusCode, 404);
  });

  test('production with no configured segment is 400 NO_SEGMENT_CONFIGURED', async () => {
    const store = seededStore();
    stubFetch(() => ({}));
    // config.novrpulse.pulseSegment is empty in the test env (no NP_PULSE_SEGMENT).
    const { error } = await withPrisma(store, () => call(publishBriefing, { user: { id: 'u' }, params: { id: 'br-1' }, body: {} }));
    assert.ok(error);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'NO_SEGMENT_CONFIGURED');
    assert.match(error.message, /NP_PULSE_SEGMENT/);
    assert.equal(calls.length, 0, 'no Plunk call when no segment is configured');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Test send.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing publish: test send', () => {
  test('sends ONE transactional test to the given address and records a test row', async () => {
    const store = seededStore();
    const created = { id: 'cmp-1' };
    stubFetch((path) => {
      if (path === '/campaigns' ) return created;
      if (path === '/campaigns/cmp-1/test') return { success: true, data: { ok: true } };
      if (path === '/campaigns/cmp-1') return {};
      throw new Error(`unexpected path ${path}`);
    });

    const { statusCode, payload } = await withPrisma(store, () =>
      call(publishBriefing, { user: { id: 'u', email: 'admin@novrcampaign.local' }, params: { id: 'br-1' }, body: { test: true, email: 'admin@novrcampaign.local' } }),
    );

    assert.equal(statusCode, 200);
    assert.deepEqual(payload, { sent: true, test: true, to: 'admin@novrcampaign.local' });

    // The real Plunk endpoints used: create draft → test → delete draft. NO send.
    const paths = calls.map((c) => c.path);
    assert.ok(paths.includes('/campaigns'), 'creates a transitive draft');
    assert.ok(paths.includes('/campaigns/cmp-1/test'), 'sends a single test copy');
    assert.ok(!paths.includes('/campaigns/cmp-1/send'), 'never sends to a segment');

    // Audit row written, kind 'test'; briefing NOT marked published.
    assert.equal(store.publications.length, 1);
    assert.equal(store.publications[0].kind, 'test');
    assert.equal(store.publications[0].html, null);
    assert.equal(store.briefings[0].status, 'draft');
    assert.equal(store.briefings[0].publishedAt, null);
    assert.equal(store.publishItems.every((p) => p.publishedAt === null), true);
  });

  test('defaults the test recipient to the caller when `email` is omitted', async () => {
    const store = seededStore();
    stubFetch((path) => {
      if (path === '/campaigns') return { id: 'cmp-9' };
      if (path === '/campaigns/cmp-9/test') return {};
      if (path === '/campaigns/cmp-9') return {};
      throw new Error(`unexpected ${path}`);
    });
    const { payload } = await withPrisma(store, () =>
      call(publishBriefing, { user: { id: 'u', email: 'me@x.io' }, params: { id: 'br-1' }, body: { test: true } }),
    );
    assert.equal(payload.to, 'me@x.io');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Production send.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing publish: production send', () => {
  test('sends a campaign to the passed segment, snapshots, and marks published', async () => {
    const store = seededStore();
    stubFetch((path) => {
      if (path === '/campaigns') return { id: 'cmp-2' };
      if (path === '/campaigns/cmp-2/send') return { success: true, data: {} };
      throw new Error(`unexpected ${path}`);
    });

    const { statusCode, payload } = await withPrisma(store, () =>
      call(publishBriefing, { user: { id: 'u' }, params: { id: 'br-1' }, body: { segments: ['seg-abc'] } }),
    );

    assert.equal(statusCode, 200);
    assert.equal(payload.sent, true);
    assert.deepEqual(payload.segments, ['seg-abc']);
    assert.ok(payload.publicationId, 'a publication id is returned');

    // The campaign's create body targets the segment and carries the rendered HTML.
    const createCall = calls.find((c) => c.path === '/campaigns');
    assert.equal(createCall.body.audienceType, 'SEGMENT');
    assert.equal(createCall.body.segmentId, 'seg-abc');
    assert.ok(createCall.body.body.includes('<!DOCTYPE html>'), 'the rendered email HTML is the campaign body');
    assert.equal(createCall.body.type, 'MARKETING');
    assert.ok(calls.some((c) => c.path === '/campaigns/cmp-2/send'), 'the campaign is sent');

    // Publication snapshot written with the html + segments.
    assert.equal(store.publications.length, 1);
    assert.equal(store.publications[0].kind, 'production');
    assert.equal(store.publications[0].version, 1);
    assert.ok(store.publications[0].html.includes('<!DOCTYPE html>'));
    assert.deepEqual(store.publications[0].segments, ['seg-abc']);

    // Briefing + items marked published.
    assert.equal(store.briefings[0].status, 'published');
    assert.ok(store.briefings[0].publishedAt instanceof Date);
    assert.equal(store.publishItems.every((p) => p.publishedAt instanceof Date), true, 'every attached item is stamped');
  });

  test('a provider error becomes a 502 and does NOT mark the briefing published', async () => {
    const store = seededStore();
    stubFetch((path) => {
      if (path === '/campaigns') return { id: 'cmp-3' };
      if (path === '/campaigns/cmp-3/send') return jsonError(422, 'Segment is empty', 'EMPTY_SEGMENT');
      throw new Error(`unexpected ${path}`);
    });

    const { error } = await withPrisma(store, () =>
      call(publishBriefing, { user: { id: 'u' }, params: { id: 'br-1' }, body: { segments: ['seg-empty'] } }),
    );

    assert.ok(error);
    assert.equal(error.statusCode, 502);
    assert.match(error.message, /Segment is empty/);
    assert.equal(store.publications.length, 0, 'no publication recorded on failure');
    assert.equal(store.briefings[0].status, 'draft', 'the briefing is not marked published');
    assert.equal(store.briefings[0].publishedAt, null);
    assert.equal(store.publishItems.every((p) => p.publishedAt === null), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Preview byte-identity — the send uses the SAME renderer as the preview.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing publish: renderer parity', () => {
  test('the campaign body is byte-identical to the preview endpoint output', async () => {
    const store = seededStore();
    stubFetch((path) => {
      if (path === '/campaigns') return { id: 'cmp-4' };
      if (path === '/campaigns/cmp-4/send') return {};
      throw new Error(`unexpected ${path}`);
    });

    // 1. What the preview endpoint returns for the same briefing.
    const previewRes = await withPrisma(store, () => call(previewBriefing, { params: { id: 'br-1' } }));
    const previewHtml = previewRes.payload.html;

    // 2. What the publish send puts in the campaign body.
    await withPrisma(store, () =>
      call(publishBriefing, { user: { id: 'u' }, params: { id: 'br-1' }, body: { segments: ['seg-abc'] } }),
    );
    const sendHtml = calls.find((c) => c.path === '/campaigns').body.body;

    assert.equal(sendHtml, previewHtml, 'the sent email is byte-identical to the preview');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Route guard.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing publish: route', () => {
  test('the publish POST route is registered', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/routes/briefingRoutes.js', import.meta.url));
    const text = await readFile(path, 'utf8');
    assert.match(
      text,
      /router\.post\('\/:id\/publish',\s*asyncHandler\(briefingController\.publishBriefing\)\);/,
      'the publish route must be registered',
    );
  });
});
