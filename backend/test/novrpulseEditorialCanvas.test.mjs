import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import { createItemFromEvent, listPublishItems, seedCanvasBody } from '../src/controllers/publishController.js';

// Controller-level tests for the Editorial Canvas: creating a writable editorial
// item FROM an accepted inbox event (POST /api/publish/from-event).
//
// No live database: the shared Prisma singleton's delegates are shadowed with an
// in-memory fake (the same pattern as novrpulseBriefing.test.mjs /
// novrpulsePublish.qa.test.mjs). This exercises the real controller path — the
// deterministic body seed, the pivot link, the create authorization, and — most
// importantly — the reuse of the defamation gate on the new from-event path.

function makeStore(seed = {}) {
  const events = (seed.events ?? []).map((e) => ({ ...e }));
  const items = (seed.items ?? []).map((i) => ({
    approvedAt: null,
    rejectedAt: null,
    publishedAt: null,
    withdrawnAt: null,
    ...i,
  }));
  const pivot = (seed.pivot ?? []).map((p) => ({ ...p }));
  let seq = 0;

  const npEvent = {
    async findUnique({ where }) {
      return events.find((e) => e.id === where.id) ?? null;
    },
  };

  const publishItem = {
    async create({ data }) {
      seq += 1;
      const row = {
        id: `pi-${seq}`,
        approvedAt: null,
        rejectedAt: null,
        publishedAt: null,
        withdrawnAt: null,
        ...data,
      };
      items.push(row);
      return { ...row };
    },
    async findMany({ where } = {}) {
      return items.filter((row) =>
        Object.entries(where ?? {}).every(([k, v]) => row[k] === v),
      );
    },
  };

  const publishItemEvent = {
    async create({ data }) {
      pivot.push({ ...data });
      return { ...data };
    },
  };

  const store = {
    events,
    items,
    pivot,
    npEvent,
    publishItem,
    publishItemEvent,
  };
  store.$transaction = async (arg) => (typeof arg === 'function' ? arg(store) : Promise.all(arg));
  return store;
}

const DELEGATES = ['npEvent', 'publishItem', 'publishItemEvent', '$transaction'];

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
  for (const key of DELEGATES) delete prisma[key];
});

/** A benign accepted event with an editor-written summary. */
function benignEvent(overrides = {}) {
  return {
    id: 'evt-ok',
    title: 'Regulator issues new consumer advisory',
    summary: 'The regulator issued a consumer advisory on digital lending.',
    whatItMeans: '',
    body: 'Full article text, never surfaced directly.',
    canonicalUrl: 'https://reg.example/a',
    region: 'Abuja',
    eventType: 'advisory',
    functions: [1],
    sources: [
      { rawDocument: { url: 'https://reg.example/a', source: { name: 'Regulator', licence: 'open', licenceStatus: 'verified' } } },
    ],
    entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
    ...overrides,
  };
}

/** A public-arrest event that NAMES an individual, with no person entity tagged. */
function arrestEvent(overrides = {}) {
  return {
    id: 'evt-arrest',
    title: 'EFCC arrests Chinedu Okafor over alleged fintech fraud',
    summary: 'The EFCC has arrested Chinedu Okafor over an alleged fintech fraud',
    whatItMeans: '',
    body: '',
    canonicalUrl: 'https://efcc.gov.ng/s/1',
    region: 'Lagos',
    eventType: 'arrest',
    functions: [7],
    sources: [
      { rawDocument: { url: 'https://efcc.gov.ng/s/1', source: { name: 'EFCC', licence: 'open', licenceStatus: 'verified' } } },
    ],
    // The name is NOT tagged as a person entity — the gate must still catch it.
    entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Happy path — creates a correctly-shaped draft + pivot link.
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas: create from event', () => {
  test('creates a briefing item with the right fields, a draft state, and the pivot link', async () => {
    const store = makeStore({ events: [benignEvent()] });
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(createItemFromEvent, {
        user: { id: 'editor-1', role: 'SENDER' },
        body: { eventId: 'evt-ok', functionId: 1 },
      }),
    );

    assert.equal(statusCode, 201);
    assert.equal(store.items.length, 1);
    const created = store.items[0];
    assert.equal(created.eventId, 'evt-ok');
    assert.equal(created.functionId, 1);
    assert.equal(created.contentType, 'briefing');
    assert.equal(created.tier, 'public');
    assert.equal(created.templateVersion, 'canvas@1.0.0');
    assert.equal(created.editorId, 'editor-1', 'editorId must come from the session');
    assert.equal(created.approvedAt, null, 'a from-event item is a draft, not a sign-off');

    // Pivot link written (schema key is `position`; the single primary event is 0).
    assert.equal(store.pivot.length, 1);
    assert.equal(store.pivot[0].publishItemId, created.id);
    assert.equal(store.pivot[0].eventId, 'evt-ok');
    assert.equal(store.pivot[0].position, 0);

    // Response shape.
    assert.equal(payload.item.id, created.id);
    assert.equal(payload.item.status, 'draft');
  });

  test('the body is seeded deterministically from the event (headline + summary)', async () => {
    const store = makeStore({ events: [benignEvent()] });
    const { payload } = await withPrisma(store, () =>
      callController(createItemFromEvent, {
        user: { id: 'editor-1' },
        body: { eventId: 'evt-ok', functionId: 1 },
      }),
    );

    const expected = 'Regulator issues new consumer advisory\n\nThe regulator issued a consumer advisory on digital lending.';
    assert.equal(payload.item.body, expected);

    // Pure helper matches (no clock, no I/O, no LLM).
    assert.equal(seedCanvasBody(benignEvent()), expected);
    assert.equal(seedCanvasBody(benignEvent()), seedCanvasBody(benignEvent()), 'seed is deterministic');
  });

  test('falls back to the first 200 chars of the raw body when there is no summary', async () => {
    const long = 'A'.repeat(400);
    const store = makeStore({ events: [benignEvent({ summary: '', body: long })] });
    const { payload } = await withPrisma(store, () =>
      callController(createItemFromEvent, { user: { id: 'e' }, body: { eventId: 'evt-ok', functionId: 1 } }),
    );
    assert.ok(payload.item.body.startsWith('Regulator issues new consumer advisory\n\n'));
    assert.equal(payload.item.body.split('\n\n')[1].length, 200);
  });

  test('only the clicked pillar is created (never all eight)', async () => {
    const store = makeStore({ events: [benignEvent()] });
    await withPrisma(store, () =>
      callController(createItemFromEvent, { user: { id: 'e' }, body: { eventId: 'evt-ok', functionId: 5 } }),
    );
    assert.equal(store.items.length, 1);
    assert.equal(store.items[0].functionId, 5);
  });

  test('the client cannot override the acting editor via the body', async () => {
    const store = makeStore({ events: [benignEvent()] });
    await withPrisma(store, () =>
      callController(createItemFromEvent, {
        user: { id: 'real-editor' },
        body: { eventId: 'evt-ok', functionId: 1, editorId: 'attacker', approvedAt: '2000-01-01T00:00:00Z' },
      }),
    );
    assert.equal(store.items[0].editorId, 'real-editor');
    assert.equal(store.items[0].approvedAt, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Denied paths — 404 unknown event, 400 invalid functionId.
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas: validation and not-found', () => {
  test('an unknown event is a 404 and writes nothing', async () => {
    const store = makeStore({ events: [] });
    const { error } = await withPrisma(store, () =>
      callController(createItemFromEvent, { user: { id: 'e' }, body: { eventId: 'ghost', functionId: 1 } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 404);
    assert.equal(store.items.length, 0);
  });

  test('an out-of-range functionId is a 400 and writes nothing', async () => {
    for (const functionId of [0, 9, 'seven']) {
      const store = makeStore({ events: [benignEvent()] });
      const { error } = await withPrisma(store, () =>
        callController(createItemFromEvent, { user: { id: 'e' }, body: { eventId: 'evt-ok', functionId } }),
      );
      assert.ok(error, `functionId ${functionId} must be rejected`);
      assert.equal(error.statusCode, 400);
      assert.equal(store.items.length, 0);
    }
  });

  test('a missing session is refused (identity must come from the session)', async () => {
    const store = makeStore({ events: [benignEvent()] });
    const { error } = await withPrisma(store, () =>
      callController(createItemFromEvent, { body: { eventId: 'evt-ok', functionId: 1 } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 403);
    assert.equal(store.items.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE GATE — the defamation control must hold on this new path.
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas: defamation gate is reused on the from-event path', () => {
  test('an arrest event + functionId 7 + public is REFUSED when the name is in the prose (no person entity)', async () => {
    const store = makeStore({ events: [arrestEvent()] });
    const { error } = await withPrisma(store, () =>
      callController(createItemFromEvent, { user: { id: 'e' }, body: { eventId: 'evt-arrest', functionId: 7 } }),
    );

    assert.ok(error, 'the create must be refused');
    assert.equal(error.statusCode, 400);
    assert.equal(error.details?.code, 'named_individual_in_public_arrest');
    assert.equal(store.items.length, 0, 'no item may be created when it names an arrestee');
    assert.equal(store.pivot.length, 0);
  });

  test('if an item WERE created for that arrest event, its body would not contain the name', async () => {
    // Documents the guarantee the gate protects: a refusal means nothing is
    // written, so there is no body to leak. Assert the seed itself carries the
    // name (proving the gate, not the seed, is the control) — and that no row exists.
    const event = arrestEvent();
    assert.ok(seedCanvasBody(event).includes('Chinedu Okafor'), 'the raw seed carries the name');

    const store = makeStore({ events: [event] });
    await withPrisma(store, () =>
      callController(createItemFromEvent, { user: { id: 'e' }, body: { eventId: 'evt-arrest', functionId: 7 } }),
    );
    for (const item of store.items) {
      assert.ok(!String(item.body).includes('Chinedu Okafor'), 'no created body may contain the name');
    }
  });

  test('the licence gate still blocks a denied-licence event on this path', async () => {
    const store = makeStore({
      events: [
        benignEvent({
          functions: [1],
          sources: [{ rawDocument: { url: 'https://reg.example/a', source: { name: 'Regulator', licenceStatus: 'denied' } } }],
        }),
      ],
    });
    const { error } = await withPrisma(store, () =>
      callController(createItemFromEvent, { user: { id: 'e' }, body: { eventId: 'evt-ok', functionId: 1 } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 400);
    assert.equal(error.details?.code, 'licence_denied');
    assert.equal(store.items.length, 0);
  });

  test('a non-arrest event for functionId 7 is allowed (the gate is specific, not blanket)', async () => {
    const store = makeStore({
      events: [benignEvent({ eventType: 'advisory', title: 'Regulator publishes new licence rules', summary: 'The regulator published new licence rules.' })],
    });
    const { statusCode } = await withPrisma(store, () =>
      callController(createItemFromEvent, { user: { id: 'e' }, body: { eventId: 'evt-ok', functionId: 7 } }),
    );
    assert.equal(statusCode, 201);
    assert.equal(store.items.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. LIST — the contentType filter (and eventId scoping) work.
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas: list filtering', () => {
  test('contentType=briefing returns only briefing items; eventId scopes to one event', async () => {
    const store = makeStore({
      items: [
        { id: 'b1', eventId: 'evt-ok', functionId: 1, tier: 'public', contentType: 'briefing', body: 'b', templateVersion: 'canvas@1.0.0' },
        { id: 'u1', eventId: 'evt-ok', functionId: 7, tier: 'public', contentType: 'urgent_alert', body: 'u', templateVersion: 'canvas@1.0.0' },
        { id: 'b2', eventId: 'evt-other', functionId: 3, tier: 'public', contentType: 'briefing', body: 'b', templateVersion: 'canvas@1.0.0' },
      ],
    });

    const briefings = await withPrisma(store, () =>
      callController(listPublishItems, { query: { contentType: 'briefing' }, user: { id: 'u' } }),
    );
    assert.deepEqual(briefings.payload.items.map((i) => i.id).sort(), ['b1', 'b2']);

    const briefingsForEvent = await withPrisma(store, () =>
      callController(listPublishItems, { query: { contentType: 'briefing', eventId: 'evt-ok' }, user: { id: 'u' } }),
    );
    assert.deepEqual(briefingsForEvent.payload.items.map((i) => i.id), ['b1']);

    const invalid = await withPrisma(store, () =>
      callController(listPublishItems, { query: { contentType: 'bogus' }, user: { id: 'u' } }),
    );
    assert.ok(invalid.error, 'an invalid contentType must be rejected');
    assert.equal(invalid.error.statusCode, 400);
  });
});
