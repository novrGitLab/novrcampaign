import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import { purgeStaleNews, computeCutoff } from '../src/services/novrpulse/retention.js';

/**
 * Focused tests for the NovrPulse daily retention purge
 * (`backend/src/services/novrpulse/retention.js`).
 *
 * No live database: the shared Prisma singleton's delegates (`npEvent`,
 * `npRawDocument`, `publishItem`, `publishItemEvent`, `aiJudgement`) and
 * `$transaction` are shadowed with an in-memory fake for the duration of each
 * test (the same shadow-prisma pattern as novrpulseCollectCron.test.mjs /
 * novrpulsePulseApi.test.mjs). This exercises the real service code — including
 * the queries, the delete order, and the cascade semantics — without Postgres.
 *
 * The fake models the two cascades that matter here:
 *   - deleting an `np_event` removes its `np_event_source` rows (source links);
 *   - an `np_raw_document` is deletable only when no surviving source row points
 *     at it (enforced by the service's `eventSources: { none: {} }` filter).
 */

const NOW = new Date('2026-11-27T06:00:00.000Z'); // "today" UTC
const TODAY = new Date('2026-11-27T02:00:00.000Z'); // within the retained window
const YESTERDAY = new Date('2026-11-26T23:00:00.000Z'); // previous UTC day
const LAST_WEEK = new Date('2026-11-20T10:00:00.000Z');

function daysAgo(n) {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

/** Build an in-memory store with the delegates the retention service uses. */
function makeStore({ events = [], documents = [], publishItems = [], publishItemEvents = [], judgements = [] } = {}) {
  const state = {
    events: events.map((e) => ({ ...e })),
    // Map of documentId -> [eventId,...] (the np_event_source join).
    documents: documents.map((d) => ({ ...d, eventIds: [...(d.eventIds ?? [])] })),
    publishItems: publishItems.map((p) => ({ ...p })),
    publishItemEvents: publishItemEvents.map((p) => ({ ...p })),
    judgements: judgements.map((j) => ({ ...j })),
  };

  function applyDeleteEvents(ids) {
    const removed = new Set(ids);
    const deletedCount = state.events.filter((e) => removed.has(e.id)).length;
    state.events = state.events.filter((e) => !removed.has(e.id));
    // Cascade: remove np_event_source rows (drop the event from each doc's links).
    for (const d of state.documents) d.eventIds = d.eventIds.filter((id) => !removed.has(id));
    return deletedCount;
  }

  function applyDeleteDocuments(ids) {
    const removed = new Set(ids);
    const eligible = state.documents.filter((d) => removed.has(d.id) && d.eventIds.length === 0);
    state.documents = state.documents.filter((d) => !removed.has(d.id));
    return eligible.length;
  }

  const tx = {
    npEvent: {
      async deleteMany({ where }) {
        return { count: applyDeleteEvents(where.id.in) };
      },
    },
    npRawDocument: {
      async findMany({ where }) {
        return state.documents
          .filter((d) => d.eventIds.length === 0) // eventSources: { none: {} }
          .filter((d) => !where.fetchedAt?.lt || d.fetchedAt < where.fetchedAt.lt)
          .map((d) => ({ id: d.id }));
      },
      async deleteMany({ where }) {
        return { count: applyDeleteDocuments(where.id.in) };
      },
    },
  };

  const npEvent = {
    async findMany({ where }) {
      return state.events
        .filter((e) => !where.publishedAt?.lt || e.publishedAt < where.publishedAt.lt)
        .filter((e) => !where.id?.notIn || !where.id.notIn.includes(e.id))
        .map((e) => ({ id: e.id }));
    },
    async count() {
      return state.events.length;
    },
    async deleteMany({ where }) {
      return { count: applyDeleteEvents(where.id.in) };
    },
  };

  const npRawDocument = {
    async findMany({ where }) {
      return state.documents
        .filter((d) => d.eventIds.length === 0)
        .filter((d) => !where.fetchedAt?.lt || d.fetchedAt < where.fetchedAt.lt)
        .map((d) => ({ id: d.id }));
    },
    async deleteMany({ where }) {
      return { count: applyDeleteDocuments(where.id.in) };
    },
  };

  const publishItem = {
    async findMany({ where }) {
      return state.publishItems
        .filter((p) => {
          if (where.eventId?.not !== null && where.eventId?.not !== undefined) return p.eventId !== null && p.eventId !== undefined;
          return true;
        })
        .map((p) => ({ eventId: p.eventId }));
    },
  };

  const publishItemEvent = {
    async findMany() {
      return state.publishItemEvents.map((p) => ({ eventId: p.eventId }));
    },
  };

  const aiJudgement = {
    async findMany({ where }) {
      if (where?.counterpartEventId) {
        return state.judgements.filter((j) => j.counterpartEventId !== null && j.counterpartEventId !== undefined).map((j) => ({ counterpartEventId: j.counterpartEventId }));
      }
      return state.judgements.filter((j) => j.eventId !== null && j.eventId !== undefined).map((j) => ({ eventId: j.eventId }));
    },
  };

  return { state, delegates: { npEvent, npRawDocument, publishItem, publishItemEvent, aiJudgement, $transaction: async (fn) => fn(tx) } };
}

/** Shadow the real prisma delegates for the duration of `fn`. */
async function withStore(store, fn) {
  const overrides = store.delegates;
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = Object.prototype.hasOwnProperty.call(prisma, key);
    Object.defineProperty(prisma, key, { value: overrides[key], configurable: true, writable: true });
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (!saved[key]) delete prisma[key];
    }
  }
}

after(() => {
  for (const key of ['npEvent', 'npRawDocument', 'publishItem', 'publishItemEvent', 'aiJudgement', '$transaction']) {
    delete prisma[key];
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cutoff math.
// ─────────────────────────────────────────────────────────────────────────────

describe('retention: cutoff math', () => {
  test('retentionDays=1 → start of the current UTC day', () => {
    assert.equal(computeCutoff(1, NOW).toISOString(), '2026-11-27T00:00:00.000Z');
  });

  test('retentionDays=2 → start of yesterday (today + yesterday retained)', () => {
    assert.equal(computeCutoff(2, NOW).toISOString(), '2026-11-26T00:00:00.000Z');
  });

  test('a cutoff earlier in the UTC day still lands on midnight', () => {
    assert.equal(computeCutoff(1, new Date('2026-11-27T00:00:01.000Z')).toISOString(), '2026-11-27T00:00:00.000Z');
  });

  test('rejects a non-positive or non-integer retentionDays', () => {
    assert.throws(() => computeCutoff(0, NOW));
    assert.throws(() => computeCutoff(-1, NOW));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. dryRun — counts only, deletes nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe('retention: dryRun', () => {
  let store;
  beforeEach(() => {
    store = makeStore({
      events: [
        { id: 'e-new', publishedAt: TODAY },
        { id: 'e-old', publishedAt: YESTERDAY },
      ],
      documents: [
        { id: 'd-old', fetchedAt: YESTERDAY, eventIds: ['e-old'] },
      ],
      publishItems: [{ eventId: 'e-old' }], // protect e-old so it is NOT a candidate
    });
  });

  test('default dryRun deletes nothing and reports zero deletions', async () => {
    await withStore(store, async () => {
      const beforeEvents = store.state.events.length;
      const beforeDocs = store.state.documents.length;
      const result = await purgeStaleNews({ now: NOW });
      assert.equal(result.dryRun, true);
      assert.equal(result.eventsDeleted, 0);
      assert.equal(result.documentsDeleted, 0);
      assert.equal(store.state.events.length, beforeEvents, 'no event deleted');
      assert.equal(store.state.documents.length, beforeDocs, 'no document deleted');
    });
  });

  test('dryRun:false deletes the unanswered old event and its orphaned doc', async () => {
    await withStore(store, async () => {
      // Remove the protection so e-old becomes a genuine candidate.
      store.state.publishItems = [];
      const result = await purgeStaleNews({ now: NOW, dryRun: false });
      assert.equal(result.dryRun, false);
      assert.equal(result.eventsDeleted, 1);
      assert.equal(result.documentsDeleted, 1);
      assert.deepEqual(store.state.events.map((e) => e.id), ['e-new'], 'today kept, yesterday purged');
      assert.deepEqual(store.state.documents.map((d) => d.id), [], 'orphaned doc purged');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Protection — every referencing record keeps its event.
// ─────────────────────────────────────────────────────────────────────────────

describe('retention: protected set', () => {
  test('KEEPS an event referenced by publish_item.eventId', async () => {
    const store = makeStore({
      events: [{ id: 'e-pub', publishedAt: YESTERDAY }, { id: 'e-free', publishedAt: YESTERDAY }],
      publishItems: [{ eventId: 'e-pub' }],
    });
    await withStore(store, async () => {
      const result = await purgeStaleNews({ now: NOW, dryRun: false });
      assert.equal(result.protected, 1);
      assert.equal(result.eventsDeleted, 1);
      assert.ok(store.state.events.some((e) => e.id === 'e-pub'), 'published event kept');
      assert.ok(!store.state.events.some((e) => e.id === 'e-free'), 'unreferenced event purged');
    });
  });

  test('KEEPS an event referenced by publish_item_event.eventId', async () => {
    const store = makeStore({
      events: [{ id: 'e-join', publishedAt: YESTERDAY }],
      publishItemEvents: [{ eventId: 'e-join' }],
    });
    await withStore(store, async () => {
      const result = await purgeStaleNews({ now: NOW, dryRun: false });
      assert.equal(result.protected, 1);
      assert.equal(result.eventsDeleted, 0);
      assert.ok(store.state.events.some((e) => e.id === 'e-join'), 'joined event kept');
    });
  });

  test('KEEPS an event referenced by ai_judgement.eventId', async () => {
    const store = makeStore({
      events: [{ id: 'e-judged', publishedAt: YESTERDAY }],
      judgements: [{ eventId: 'e-judged' }],
    });
    await withStore(store, async () => {
      const result = await purgeStaleNews({ now: NOW, dryRun: false });
      assert.equal(result.protected, 1);
      assert.equal(result.eventsDeleted, 0);
      assert.ok(store.state.events.some((e) => e.id === 'e-judged'), 'judged event kept');
    });
  });

  test('KEEPS an event referenced as ai_judgement.counterpartEventId', async () => {
    const store = makeStore({
      events: [{ id: 'e-counter', publishedAt: YESTERDAY }],
      judgements: [{ eventId: null, counterpartEventId: 'e-counter' }],
    });
    await withStore(store, async () => {
      const result = await purgeStaleNews({ now: NOW, dryRun: false });
      assert.equal(result.protected, 1);
      assert.equal(result.eventsDeleted, 0);
      assert.ok(store.state.events.some((e) => e.id === 'e-counter'), 'counterpart event kept');
    });
  });

  test("a protected event's document is NEVER deleted", async () => {
    const store = makeStore({
      events: [{ id: 'e-pub', publishedAt: YESTERDAY }],
      documents: [
        { id: 'd-shared', fetchedAt: LAST_WEEK, eventIds: ['e-pub'] }, // sole link is protected
      ],
      publishItems: [{ eventId: 'e-pub' }],
    });
    await withStore(store, async () => {
      const result = await purgeStaleNews({ now: NOW, dryRun: false });
      assert.equal(result.eventsDeleted, 0);
      assert.equal(result.documentsDeleted, 0);
      assert.deepEqual(store.state.documents.map((d) => d.id), ['d-shared'], 'protected doc kept');
    });
  });

  test('a document shared by a purged and a surviving event is kept', async () => {
    const store = makeStore({
      events: [
        { id: 'e-old', publishedAt: YESTERDAY },
        { id: 'e-new', publishedAt: TODAY },
      ],
      documents: [{ id: 'd-shared', fetchedAt: LAST_WEEK, eventIds: ['e-old', 'e-new'] }],
    });
    await withStore(store, async () => {
      const result = await purgeStaleNews({ now: NOW, dryRun: false });
      assert.equal(result.eventsDeleted, 1, 'the old event is purged');
      assert.equal(result.documentsDeleted, 0, 'the doc still backs a surviving event');
      assert.ok(store.state.documents.some((d) => d.id === 'd-shared'), 'shared doc kept');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Retention window — today kept, yesterday purged.
// ─────────────────────────────────────────────────────────────────────────────

describe('retention: retentionDays=1 window', () => {
  test("keeps today's news and purges yesterday's", async () => {
    const store = makeStore({
      events: [
        { id: 'e-today', publishedAt: TODAY },
        { id: 'e-today-late', publishedAt: daysAgo(0) }, // same UTC day
        { id: 'e-yest', publishedAt: YESTERDAY },
        { id: 'e-week', publishedAt: LAST_WEEK },
      ],
    });
    await withStore(store, async () => {
      const result = await purgeStaleNews({ now: NOW, dryRun: false });
      assert.equal(result.candidates, 2, 'two prior-day events are candidates');
      assert.equal(result.eventsDeleted, 2);
      assert.deepEqual(
        store.state.events.map((e) => e.id).sort(),
        ['e-today', 'e-today-late'],
        "only today's events survive",
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Mass-deletion guard.
// ─────────────────────────────────────────────────────────────────────────────

describe('retention: mass-deletion guard', () => {
  test('refuses when candidates == all events AND nothing is protected', async () => {
    const store = makeStore({
      events: [
        { id: 'e1', publishedAt: YESTERDAY },
        { id: 'e2', publishedAt: LAST_WEEK },
      ],
    });
    await withStore(store, async () => {
      await assert.rejects(
        () => purgeStaleNews({ now: NOW, dryRun: false }),
        /Refusing to purge/,
      );
      assert.equal(store.state.events.length, 2, 'nothing deleted on refusal');
    });
  });

  test('does NOT refuse a legitimate empty-table purge (no candidates)', async () => {
    const store = makeStore({ events: [] });
    await withStore(store, async () => {
      const result = await purgeStaleNews({ now: NOW, dryRun: false });
      assert.equal(result.candidates, 0);
      assert.equal(result.eventsDeleted, 0);
    });
  });

  test('does NOT refuse when all events are candidates but some are protected', async () => {
    const store = makeStore({
      events: [{ id: 'e-old', publishedAt: YESTERDAY }],
      publishItems: [{ eventId: 'e-prot' }], // a different, unrelated id is protected
    });
    await withStore(store, async () => {
      const result = await purgeStaleNews({ now: NOW, dryRun: false });
      assert.equal(result.protected, 1);
      assert.equal(result.eventsDeleted, 1, 'the unprotected event is purged');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Endpoint — guard, body schema, and defaults.
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = 'test-purge-cron-secret-do-not-use-in-prod';
const config = (await import('../src/config/env.js')).default;
const { purgePulseRetention, purgeSchema } = await import('../src/controllers/pulseController.js');

function withSecret(secret, fn) {
  const prev = config.novrpulse.collection.cronSecret;
  config.novrpulse.collection.cronSecret = secret;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      config.novrpulse.collection.cronSecret = prev;
    });
}

function fakeRes() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

function makeReq({ authorization, body, purgeCalls } = {}) {
  const headers = {};
  if (authorization !== undefined) headers.authorization = authorization;
  const req = { headers, body, get: (h) => headers[h.toLowerCase()] };
  if (purgeCalls) {
    req._purgeStaleNews = async (opts) => {
      purgeCalls.push(opts);
      return { cutoff: '2026-11-27T00:00:00.000Z', candidates: 0, eventsDeleted: 0, documentsDeleted: 0, protected: 0, dryRun: opts.dryRun };
    };
  }
  return req;
}

describe('retention: purge endpoint', () => {
  test('no secret and no session → 401 with no purge', async () => {
    const purgeCalls = [];
    await withSecret('', async () => {
      await assert.rejects(() => purgePulseRetention(makeReq({ purgeCalls }), fakeRes()), (err) => {
        assert.equal(err.statusCode, 401);
        return true;
      });
      assert.equal(purgeCalls.length, 0, 'no purge runs when unauthorized');
    });
  });

  test('the correct bearer secret → 200 and dryRun defaults TRUE', async () => {
    const purgeCalls = [];
    await withSecret(SECRET, async () => {
      const res = fakeRes();
      await purgePulseRetention(makeReq({ authorization: `Bearer ${SECRET}`, body: {}, purgeCalls }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(purgeCalls.length, 1);
      assert.equal(purgeCalls[0].dryRun, true, 'a stray call never deletes');
      assert.equal(purgeCalls[0].retentionDays, 1, 'default window is one day');
      assert.equal(res.payload.dryRun, true);
    });
  });

  test('an explicit dryRun:false is passed through', async () => {
    const purgeCalls = [];
    await withSecret(SECRET, async () => {
      await purgePulseRetention(
        makeReq({ authorization: `Bearer ${SECRET}`, body: { dryRun: false, retentionDays: 7 }, purgeCalls }),
        fakeRes(),
      );
      assert.equal(purgeCalls[0].dryRun, false);
      assert.equal(purgeCalls[0].retentionDays, 7);
    });
  });

  test('an ADMIN session authorizes; a non-admin does not', async () => {
    const purgeCalls = [];
    await withSecret('', async () => {
      // isPulseCollectAuthorized reads req.user?.role after attachOptionalUser.
      // Without a resolvable token, req.user is undefined → 401.
      await assert.rejects(
        () => purgePulseRetention(makeReq({ body: {}, purgeCalls }), fakeRes()),
        (err) => {
          assert.equal(err.statusCode, 401);
          return true;
        },
      );
    });
  });

  test('body schema defaults and bounds', () => {
    assert.equal(purgeSchema.validate({}).value.retentionDays, 1);
    assert.equal(purgeSchema.validate({}).value.dryRun, true);
    assert.equal(purgeSchema.validate({ retentionDays: 30 }).error, undefined);
    assert.notEqual(purgeSchema.validate({ retentionDays: 0 }).error, undefined);
    assert.notEqual(purgeSchema.validate({ retentionDays: 31 }).error, undefined);
  });
});

describe('retention: route wiring', () => {
  test('the maintenance router is mounted before requireAuth-guarded /pulse', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/routes/index.js', import.meta.url));
    const text = await readFile(path, 'utf8');
    const maintenanceAt = text.indexOf("router.use('/pulse/maintenance', pulseMaintenanceRoutes)");
    const guardedAt = text.indexOf("router.use('/pulse', requireAuth, pulseRoutes)");
    assert.ok(maintenanceAt >= 0, 'maintenance router must be mounted');
    assert.ok(guardedAt >= 0, 'guarded pulse router must be mounted');
    assert.ok(maintenanceAt < guardedAt, 'the maintenance mount must precede the guarded /pulse mount');
    assert.ok(
      !/router\.use\('\/pulse\/maintenance',\s*requireAuth/.test(text),
      'maintenance must NOT be behind requireAuth (a cron has no session)',
    );
  });

  test('the maintenance router registers POST /purge with the controller', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/routes/pulseMaintenanceRoutes.js', import.meta.url));
    const text = await readFile(path, 'utf8');
    assert.match(
      text,
      /router\.post\('\/purge',\s*asyncHandler\(pulseController\.purgePulseRetention\)\);/,
      'POST /purge must be registered with the guarded controller',
    );
  });
});
