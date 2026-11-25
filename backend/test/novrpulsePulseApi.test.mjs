import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import {
  listPulseEvents,
  getPulseEvent,
  reviewPulseEvent,
  listSchema,
  reviewSchema,
} from '../src/controllers/pulseController.js';

// Controller-level tests for the NovrPulse feed read API.
//
// No live database is used: the shared Prisma singleton's `npEvent` delegate is
// shadowed with an in-memory fake for the duration of each test (the same
// pattern used by novrpulsePublish.qa.test.mjs). This exercises the real
// controller code path — including the query shape and ordering it passes to
// Prisma — without a Postgres instance.

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stand-in for the `np_event` delegate. It records the args it was
// called with so the tests can assert the controller's ordering/where clauses.
// ─────────────────────────────────────────────────────────────────────────────

function makeStore(seed) {
  const rows = seed.map((r) => ({ ...r }));
  const calls = { findMany: [], count: [] };

  // Mirror the query's publish-item ordering: non-withdrawn first (nulls
  // first on withdrawnAt), then publishedAt/approvedAt/rejectedAt desc, id desc.
  function publishInOrder(a, b) {
    const aw = a.withdrawnAt ?? null;
    const bw = b.withdrawnAt ?? null;
    if ((aw === null) !== (bw === null)) return aw === null ? -1 : 1;
    for (const key of ['publishedAt', 'approvedAt', 'rejectedAt']) {
      const at = a[key] ? a[key].getTime() : null;
      const bt = b[key] ? b[key].getTime() : null;
      if (at !== bt) {
        if (at === null) return 1;
        if (bt === null) return -1;
        return bt - at;
      }
    }
    return String(b.id).localeCompare(String(a.id));
  }

  function shapePublishItems(items) {
    return [...(items ?? [])].sort(publishInOrder).map((p) => ({
      id: p.id,
      approvedAt: p.approvedAt ?? null,
      publishedAt: p.publishedAt ?? null,
      withdrawnAt: p.withdrawnAt ?? null,
      rejectedAt: p.rejectedAt ?? null,
    }));
  }

  function inOrder(a, b) {
    const ap = a.publishedAt ? a.publishedAt.getTime() : null;
    const bp = b.publishedAt ? b.publishedAt.getTime() : null;
    // publishedAt desc, nulls last.
    if (ap !== bp) {
      if (ap === null) return 1;
      if (bp === null) return -1;
      return bp - ap;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  }

  function matches(row, where) {
    if (!where) return true;
    if (where.functions?.has !== undefined && !row.functions.includes(where.functions.has)) return false;
    if (where.reviewStatus !== undefined && row.reviewStatus !== where.reviewStatus) return false;
    if (where.language !== undefined) {
      // Either an exact code ("en", "ja") or `{ not: 'en' }` for non-en.
      if (where.language.not !== undefined) {
        if (row.language === where.language.not) return false;
      } else if (row.language !== where.language) {
        return false;
      }
    }
    if (where.publishedAt?.gte && !(row.publishedAt && row.publishedAt >= where.publishedAt.gte)) return false;
    if (where.title?.contains) {
      const needle = String(where.title.contains).toLowerCase();
      if (!String(row.title).toLowerCase().includes(needle)) return false;
    }
    // Nested relation filter: event → sources → rawDocument → source → region.
    const region = where.sources?.some?.rawDocument?.source?.region;
    if (region !== undefined) {
      const anyMatch = (row.sources ?? []).some(
        (s) => s.rawDocument?.source?.region === region,
      );
      if (!anyMatch) return false;
    }
    // AND clauses: every clause must match.
    if (Array.isArray(where.AND)) {
      for (const clause of where.AND) {
        // The layered cyber filter rides in the AND list as { OR: [...] }.
        if (Array.isArray(clause.OR)) {
          const anyOh = clause.OR.some((sub) => matchesLayered(sub, row));
          if (!anyOh) return false;
          continue;
        }
        const ids = clause.sources?.some?.rawDocument?.source?.id?.in;
        if (Array.isArray(ids)) {
          const anyMatch = (row.sources ?? []).some(
            (s) => ids.includes(s.rawDocument?.source?.id),
          );
          if (!anyMatch) return false;
        }
      }
    }
    // AI classification flags (only narrow when true).
    for (const key of ['isCybersecurity', 'isThreatIntel', 'isNigeriaRelated']) {
      if (where[key] === true && row[key] !== true) return false;
    }
    return true;
  }

  // Matches a single layered-cyber OR branch:
  //   { isCybersecurity: true }                          → the AI flag wins; OR
  //   { AND: [{ isCybersecurity: null }, { sources: … }] } → unclassified AND a
  //     dedicated cyber source. The controller emits the fallback as a nested
  //     AND clause (so it composes with the region filter), so the fake must
  //     evaluate that nested AND rather than a flat branch.
  function matchesLayered(clause, row) {
    if (clause.isCybersecurity === true) return row.isCybersecurity === true;
    if (Array.isArray(clause.AND)) {
      return clause.AND.every((sub) => matchesLayeredPart(sub, row));
    }
    return false;
  }

  // Evaluate one leg of the nested AND fallback: the NULL flag guard, or the
  // dedicated-cyber-source membership check.
  function matchesLayeredPart(sub, row) {
    if (sub.isCybersecurity === null) {
      return row.isCybersecurity === null || row.isCybersecurity === undefined;
    }
    const ids = sub.sources?.some?.rawDocument?.source?.id?.in;
    if (Array.isArray(ids)) {
      return (row.sources ?? []).some((s) => ids.includes(s.rawDocument?.source?.id));
    }
    return true;
  }

  const npEvent = {
    async findMany(args = {}) {
      calls.findMany.push(args);
      let out = rows.filter((r) => matches(r, args.where)).sort(inOrder);
      if (args.skip) out = out.slice(args.skip);
      if (args.take !== undefined) out = out.slice(0, args.take);
      // Shape the rows to the `select` (sources chain) the controller requests.
      return out.map((r) => ({
        ...r,
        sources: (r.sources ?? []).map((s) => ({
          rawDocument: {
            source: { name: s.rawDocument?.source?.name ?? null },
            body: s.rawDocument?.body ?? null,
          },
        })),
        publishItems: shapePublishItems(r.publishItems),
      }));
    },
    async count(args = {}) {
      calls.count.push(args);
      return rows.filter((r) => matches(r, args.where)).length;
    },
    async findUnique({ where }) {
      const row = rows.find((r) => r.id === where.id);
      if (!row) return null;
      return {
        ...row,
        sources: (row.sources ?? []).map((s) => ({
          pageRef: s.pageRef ?? null,
          rawDocument: {
            url: s.rawDocument?.url ?? null,
            body: s.rawDocument?.body ?? null,
            source: {
              name: s.rawDocument?.source?.name ?? null,
              licence: s.rawDocument?.source?.licence ?? null,
            },
          },
        })),
        entities: (row.entities ?? []).map((e) => ({
          role: e.role,
          entity: { type: e.entity?.type ?? null, canonicalName: e.entity?.canonicalName ?? null },
        })),
        publishItems: shapePublishItems(row.publishItems),
      };
    },
    async update({ where, data }) {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, data);
      // Mirror the review endpoint's select: card fields + sources chain + drafts.
      return {
        ...row,
        sources: (row.sources ?? []).map((s) => ({
          rawDocument: {
            source: { name: s.rawDocument?.source?.name ?? null },
            body: s.rawDocument?.body ?? null,
          },
        })),
        publishItems: shapePublishItems(row.publishItems),
      };
    },
  };

  return { rows, calls, npEvent };
}

async function withPrisma(store, fn) {
  const had = Object.prototype.hasOwnProperty.call(prisma, 'npEvent');
  Object.defineProperty(prisma, 'npEvent', { value: store.npEvent, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (!had) delete prisma.npEvent;
  }
}

function fakeRes() {
  const res = {
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

function event(overrides = {}) {
  return {
    id: 'evt-1',
    title: 'A regulator issued a notice',
    summary: 'Summary',
    whatItMeans: 'What it means',
    body: 'RAW BODY MUST NEVER BE RETURNED',
    publishedAt: new Date('2026-11-10T00:00:00Z'),
    canonicalUrl: 'https://reg.example/a',
    language: 'en',
    functions: [1, 7],
    eventType: 'advisory',
    reviewStatus: 'new',
    createdAt: new Date('2026-11-10T01:00:00Z'),
    sources: [],
    entities: [],
    publishItems: [],
    ...overrides,
  };
}

after(() => {
  delete prisma.npEvent;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. List — paginated shape and ordering.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse API: list events', () => {
  test('returns the paginated envelope with publishedAt desc (nulls last), createdAt desc', async () => {
    const store = makeStore([
      event({ id: 'a', publishedAt: new Date('2026-11-01T00:00:00Z'), createdAt: new Date('2026-11-01T01:00:00Z') }),
      event({ id: 'b', publishedAt: new Date('2026-11-05T00:00:00Z'), createdAt: new Date('2026-11-05T01:00:00Z') }),
      event({ id: 'c', publishedAt: null, createdAt: new Date('2026-11-09T01:00:00Z') }),
      event({ id: 'd', publishedAt: new Date('2026-11-05T00:00:00Z'), createdAt: new Date('2026-11-06T01:00:00Z') }),
    ]);

    const { payload } = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));

    assert.deepEqual(payload.items.map((i) => i.id), ['d', 'b', 'a', 'c']);
    assert.equal(payload.page, 1);
    assert.equal(payload.pageSize, 20);
    assert.equal(payload.total, 4);
    assert.equal(payload.totalPages, 1);

    // Shape: card fields present, body never returned, sourceName derived.
    const first = payload.items[0];
    assert.deepEqual(Object.keys(first).sort(), [
      'canonicalUrl',
      'eventType',
      'excerpt',
      'functions',
      'hasSummary',
      'id',
      'language',
      'publishItemId',
      'publishStatus',
      'publishedAt',
      'reviewStatus',
      'sourceName',
      'summary',
      'title',
      'whatItMeans',
    ].sort());
    assert.ok(!('body' in first), 'body must never be returned');
    // No publish items seeded → both fields null.
    assert.equal(first.publishItemId, null);
    assert.equal(first.publishStatus, null);

    // Ordering was pushed to Prisma (no in-memory sort).
    assert.deepEqual(store.calls.findMany[0].orderBy, [
      { publishedAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
    ]);

    // Pagination is applied to the query.
    assert.equal(store.calls.findMany[0].take, 20);
    assert.equal(store.calls.findMany[0].skip, 0);
  });

  test('sourceName comes from the first source chain', async () => {
    const store = makeStore([
      event({ id: 'a', sources: [{ rawDocument: { source: { name: 'Regulator Watch' } } }] }),
      event({ id: 'b', sources: [] }),
    ]);
    const { payload } = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    const byId = Object.fromEntries(payload.items.map((i) => [i.id, i]));
    assert.equal(byId.a.sourceName, 'Regulator Watch');
    assert.equal(byId.b.sourceName, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Filters — function + q narrow; bad pageSize is rejected.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse API: filters', () => {
  test('function and q filter the result set', async () => {
    const store = makeStore([
      event({ id: 'a', title: 'Central bank raises rate', functions: [1] }),
      event({ id: 'b', title: 'Central bank guidance', functions: [2] }),
      event({ id: 'c', title: 'Telecom tariff review', functions: [1] }),
    ]);

    const byFn = await withPrisma(store, () => callController(listPulseEvents, { query: { function: 1 } }));
    assert.deepEqual(byFn.payload.items.map((i) => i.id).sort(), ['a', 'c']);
    assert.deepEqual(store.calls.findMany.at(-1).where.functions, { has: 1 });

    const byQ = await withPrisma(store, () => callController(listPulseEvents, { query: { q: 'central' } }));
    assert.deepEqual(byQ.payload.items.map((i) => i.id).sort(), ['a', 'b']);
    assert.deepEqual(store.calls.findMany.at(-1).where.title, { contains: 'central', mode: 'insensitive' });

    const both = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { function: 1, q: 'central' } }),
    );
    assert.deepEqual(both.payload.items.map((i) => i.id), ['a']);
  });

  test('a bad pageSize is rejected with a 400 before any query runs', async () => {
    const store = makeStore([]);
    // The controller maps a Joi failure to the repo's BadRequest (400) so a
    // malformed query surfaces as a 400, not a 500.
    const { error } = await withPrisma(store, () => callController(listPulseEvents, { query: { pageSize: 0 } }));
    assert.ok(error, 'pageSize 0 must be rejected');
    assert.equal(error.statusCode, 400);
    assert.ok(!store.calls.findMany.length, 'no query must run when validation fails');

    const { error: tooBig } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { pageSize: 101 } }),
    );
    assert.ok(tooBig, 'pageSize 101 must be rejected');
    assert.equal(tooBig.statusCode, 400);
    assert.ok(!store.calls.findMany.length, 'no query must run when validation fails');

    // At the schema level the bounds are 1–100 as required.
    assert.notEqual(listSchema.validate({ pageSize: 0 }).error, undefined);
    assert.notEqual(listSchema.validate({ pageSize: 101 }).error, undefined);
    assert.equal(listSchema.validate({ pageSize: 100 }).error, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Region filter — event → sources → rawDocument → source → region.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse API: region filter', () => {
  // Events carry no own region; region comes from the source chain.
  const ngEvent = (id, region = 'NG', extra = {}) =>
    event({ id, sources: [{ rawDocument: { source: { name: `${region} Source`, region } } }], ...extra });

  test('region=NG keeps only events whose source region is NG', async () => {
    const store = makeStore([
      ngEvent('ng', 'NG'),
      ngEvent('af', 'AF'),
      ngEvent('global', 'GLOBAL'),
    ]);

    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { region: 'NG' } }),
    );

    assert.deepEqual(payload.items.map((i) => i.id), ['ng']);
    assert.equal(payload.total, 1);
    // The nested Prisma filter was pushed through the relation path.
    assert.deepEqual(store.calls.findMany.at(-1).where.sources, {
      some: { rawDocument: { source: { region: 'NG' } } },
    });
    assert.deepEqual(store.calls.count.at(-1).where.sources, {
      some: { rawDocument: { source: { region: 'NG' } } },
    });
  });

  test('region=GLOBAL keeps only events whose source region is GLOBAL', async () => {
    const store = makeStore([
      ngEvent('ng', 'NG'),
      ngEvent('af', 'AF'),
      ngEvent('global', 'GLOBAL'),
    ]);

    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { region: 'GLOBAL' } }),
    );

    assert.deepEqual(payload.items.map((i) => i.id), ['global']);
  });

  test('friendly aliases map to the canonical region code', async () => {
    const store = makeStore([
      ngEvent('ng', 'NG'),
      ngEvent('af', 'AF'),
      ngEvent('global', 'GLOBAL'),
    ]);

    const nigeria = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { region: 'nigeria' } }),
    );
    assert.deepEqual(nigeria.payload.items.map((i) => i.id), ['ng']);
    assert.deepEqual(store.calls.findMany.at(-1).where.sources, {
      some: { rawDocument: { source: { region: 'NG' } } },
    });

    const africa = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { region: 'africa' } }),
    );
    assert.deepEqual(africa.payload.items.map((i) => i.id), ['af']);

    const global = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { region: 'global' } }),
    );
    assert.deepEqual(global.payload.items.map((i) => i.id), ['global']);
    assert.deepEqual(store.calls.findMany.at(-1).where.sources, {
      some: { rawDocument: { source: { region: 'GLOBAL' } } },
    });
  });

  test('region composes with an existing filter (q)', async () => {
    const store = makeStore([
      ngEvent('ng-a', 'NG', { title: 'Telecom tariff review' }),
      ngEvent('ng-b', 'NG', { title: 'Central bank notice' }),
      ngEvent('af-a', 'AF', { title: 'Telecom tariff review' }),
    ]);

    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { region: 'NG', q: 'telecom' } }),
    );

    assert.deepEqual(payload.items.map((i) => i.id), ['ng-a']);
  });

  test('an invalid region is rejected with a 400 before any query runs', async () => {
    const store = makeStore([ngEvent('ng', 'NG')]);
    const { error } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { region: 'west-africa' } }),
    );
    assert.ok(error, 'an invalid region must be rejected');
    assert.equal(error.statusCode, 400);
    assert.ok(!store.calls.findMany.length, 'no query must run when validation fails');
    // At the schema level the accepted values are the aliases only.
    assert.notEqual(listSchema.validate({ region: 'mars' }).error, undefined);
    assert.equal(listSchema.validate({ region: 'NG' }).error, undefined);
    assert.equal(listSchema.validate({ region: 'nigeria' }).error, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Cyber filter — `cyber=true` narrows to dedicated cybersecurity sources.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse API: cyber filter', () => {
  // An event whose provenance source carries an `id` (the filter key) and a region.
  const cyberEvent = (id, sourceIds, region = 'GLOBAL', extra = {}) =>
    event({
      id,
      sources: sourceIds.map((sid) => ({ rawDocument: { source: { id: sid, name: sid, region } } })),
      ...extra,
    });

  test('cyber=true keeps only events whose source is in CYBER_SOURCE_IDS', async () => {
    const store = makeStore([
      cyberEvent('bleeping', ['bleepingcomputer']),
      cyberEvent('scoop', ['cyberscoop']),
      cyberEvent('general', ['techcabal']),
    ]);

    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { cyber: 'true' } }),
    );

    assert.deepEqual(payload.items.map((i) => i.id).sort(), ['bleeping', 'scoop']);
    assert.equal(payload.total, 2);
    // The layered filter rides in AND as an OR: (isCybersecurity=true) OR
    // (isCybersecurity IS NULL AND source ∈ CYBER_SOURCE_IDS).
    const andClause = store.calls.findMany.at(-1).where.AND[0];
    assert.equal(andClause.OR[0].isCybersecurity, true);
    assert.equal(andClause.OR[1].AND[0].isCybersecurity, null);
    assert.deepEqual(
      andClause.OR[1].AND[1].sources.some.rawDocument.source.id.in,
      ['bleepingcomputer', 'hackernews', 'therecord', 'securityweek', 'darkreading', 'cyberscoop'],
    );
  });

  test('cyber=true matches an AI-classified event even when its source is not a cyber source', async () => {
    const store = makeStore([
      cyberEvent('classified-general', ['techcabal'], 'GLOBAL', { isCybersecurity: true }),
      cyberEvent('unclassified-general', ['techcabal'], 'GLOBAL', { isCybersecurity: null }),
      cyberEvent('unclassified-cyber', ['cyberscoop'], 'GLOBAL', { isCybersecurity: null }),
      cyberEvent('classified-false', ['cyberscoop'], 'GLOBAL', { isCybersecurity: false }),
    ]);

    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { cyber: 'true' } }),
    );

    // The flag match wins; the unclassified cyber-source event still matches via
    // the fallback; the unclassified general event and the flagged-false event do
    // not.
    assert.deepEqual(payload.items.map((i) => i.id).sort(), ['classified-general', 'unclassified-cyber']);
  });

  test('cyber omitted (or false) does not narrow — the param is off by default', async () => {
    const store = makeStore([
      cyberEvent('bleeping', ['bleepingcomputer']),
      cyberEvent('general', ['techcabal']),
    ]);
    const off = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    assert.deepEqual(off.payload.items.map((i) => i.id).sort(), ['bleeping', 'general']);
    assert.equal(store.calls.findMany.at(-1).where.AND, undefined, 'no AND clause when cyber is off');

    const explicitlyFalse = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { cyber: 'false' } }),
    );
    assert.deepEqual(explicitlyFalse.payload.items.map((i) => i.id).sort(), ['bleeping', 'general']);
  });

  test('cyber composes with region (AND)', async () => {
    const store = makeStore([
      cyberEvent('cyber-ng', ['cyberscoop'], 'NG'),
      cyberEvent('cyber-global', ['cyberscoop'], 'GLOBAL'),
      cyberEvent('general-ng', ['techcabal'], 'NG'),
    ]);

    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { cyber: 'true', region: 'NG' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['cyber-ng']);
    // Region stays on `sources`; cyber rides in the AND list — both apply.
    assert.deepEqual(store.calls.findMany.at(-1).where.sources, {
      some: { rawDocument: { source: { region: 'NG' } } },
    });
    assert.ok(Array.isArray(store.calls.findMany.at(-1).where.AND));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3c. AI classification flag filters — isCybersecurity / isThreatIntel /
//     isNigeriaRelated.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse API: AI classification flag filters', () => {
  test('isThreatIntel=true keeps only events flagged threat-intel', async () => {
    const store = makeStore([
      event({ id: 'tint', isThreatIntel: true }),
      event({ id: 'not-tint', isThreatIntel: false }),
      event({ id: 'unclassified', isThreatIntel: null }),
    ]);
    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { isThreatIntel: 'true' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['tint']);
    assert.equal(store.calls.findMany.at(-1).where.isThreatIntel, true);
  });

  test('isCybersecurity=true and isNigeriaRelated=true narrow independently', async () => {
    const store = makeStore([
      event({ id: 'cyber', isCybersecurity: true, isNigeriaRelated: false }),
      event({ id: 'ng', isCybersecurity: false, isNigeriaRelated: true }),
      event({ id: 'both', isCybersecurity: true, isNigeriaRelated: true }),
    ]);

    const cyber = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { isCybersecurity: 'true' } }),
    );
    assert.deepEqual(cyber.payload.items.map((i) => i.id).sort(), ['both', 'cyber']);

    const ng = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { isNigeriaRelated: 'true' } }),
    );
    assert.deepEqual(ng.payload.items.map((i) => i.id).sort(), ['both', 'ng']);
  });

  test('flag filters compose with region (AND)', async () => {
    const src = (region) => [{ rawDocument: { source: { name: `${region} Src`, region } } }];
    const store = makeStore([
      event({ id: 'tint-ng', isThreatIntel: true, sources: src('NG') }),
      event({ id: 'tint-global', isThreatIntel: true, sources: src('GLOBAL') }),
      event({ id: 'other-ng', isThreatIntel: false, sources: src('NG') }),
    ]);
    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { isThreatIntel: 'true', region: 'NG' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['tint-ng']);
  });

  test('flag omitted (or false) does not narrow — the param is off by default', async () => {
    const store = makeStore([
      event({ id: 'tint', isThreatIntel: true }),
      event({ id: 'not-tint', isThreatIntel: false }),
    ]);
    const off = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    assert.deepEqual(off.payload.items.map((i) => i.id).sort(), ['not-tint', 'tint']);
    assert.equal(store.calls.findMany.at(-1).where.isThreatIntel, undefined);

    const explicitlyFalse = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { isThreatIntel: 'false' } }),
    );
    assert.deepEqual(explicitlyFalse.payload.items.map((i) => i.id).sort(), ['not-tint', 'tint']);
  });

  test('the schema accepts the three flags as truthy/falsy strings', async () => {
    for (const key of ['isCybersecurity', 'isThreatIntel', 'isNigeriaRelated']) {
      assert.equal(listSchema.validate({ [key]: 'true' }).value[key], true, key);
      assert.equal(listSchema.validate({ [key]: 'false' }).value[key], false, key);
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 4. Language filter — `en` | `non-en` | a specific code.
// ─────────────────────────────────────────────────────────────────────────────
describe('pulse API: language filter', () => {
  test('language=non-en keeps only events whose language is not "en"', async () => {
    const store = makeStore([
      event({ id: 'en', language: 'en' }),
      event({ id: 'ja', language: 'ja' }),
      event({ id: 'ru', language: 'ru' }),
    ]);

    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { language: 'non-en' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id).sort(), ['ja', 'ru']);
    assert.deepEqual(store.calls.findMany.at(-1).where.language, { not: 'en' });
    assert.equal(store.calls.count.at(-1).where.language.not, 'en');
  });

  test('language=en keeps only English events', async () => {
    const store = makeStore([
      event({ id: 'en', language: 'en' }),
      event({ id: 'ja', language: 'ja' }),
    ]);
    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { language: 'en' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['en']);
    assert.equal(store.calls.findMany.at(-1).where.language, 'en');
  });

  test('a specific code narrows to that language', async () => {
    const store = makeStore([
      event({ id: 'ja', language: 'ja' }),
      event({ id: 'ru', language: 'ru' }),
    ]);
    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { language: 'ja' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['ja']);
    assert.equal(store.calls.findMany.at(-1).where.language, 'ja');
  });

  test('the card carries `language` (default "en")', async () => {
    const store = makeStore([event({ id: 'a' }), event({ id: 'ja', language: 'ja' })]);
    const { payload } = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    const byId = Object.fromEntries(payload.items.map((i) => [i.id, i]));
    assert.equal(byId.a.language, 'en');
    assert.equal(byId.ja.language, 'ja');
  });

  test('an invalid language value is rejected with a 400 before any query runs', async () => {
    const store = makeStore([event({ id: 'a' })]);
    const { error } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { language: '!!' } }),
    );
    assert.ok(error, 'a malformed language must be rejected');
    assert.equal(error.statusCode, 400);
    assert.ok(!store.calls.findMany.length, 'no query must run when validation fails');
    assert.equal(listSchema.validate({ language: 'en' }).error, undefined);
    assert.equal(listSchema.validate({ language: 'non-en' }).error, undefined);
    assert.equal(listSchema.validate({ language: 'ja' }).error, undefined);
    assert.notEqual(listSchema.validate({ language: 'nonsense!' }).error, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Detail — sources + entities; unknown id → 404.
// ─────────────────────────────────────────────────────────────────────────────
describe('pulse API: event detail', () => {
  test('returns the card plus sources and entities (and never body)', async () => {
    const store = makeStore([
      event({
        id: 'evt-9',
        sources: [
          {
            pageRef: 'p2',
            rawDocument: { url: 'https://reg.example/a', source: { name: 'Regulator', licence: 'verified' } },
          },
        ],
        entities: [{ role: 'subject', entity: { type: 'agency', canonicalName: 'CBN' } }],
      }),
    ]);

    const { payload } = await withPrisma(store, () => callController(getPulseEvent, { params: { id: 'evt-9' } }));

    assert.equal(payload.event.id, 'evt-9');
    assert.equal(payload.event.sourceName, undefined, 'detail does not carry a flat sourceName');
    assert.deepEqual(payload.event.sources, [
      { sourceName: 'Regulator', url: 'https://reg.example/a', licence: 'verified' },
    ]);
    assert.deepEqual(payload.event.entities, [{ name: 'CBN', type: 'agency', role: 'subject' }]);
    assert.ok(!('body' in payload.event), 'body must never be returned');
  });

  test('an unknown id returns 404', async () => {
    const store = makeStore([]);
    const { error } = await withPrisma(store, () => callController(getPulseEvent, { params: { id: 'nope' } }));
    assert.ok(error);
    assert.equal(error.statusCode, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Publish-draft linkage — the reviewer screen's approve/reject/edit id.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse API: publish-draft linkage', () => {
  test('an event with publish items returns the non-withdrawn draft id + status', async () => {
    const store = makeStore([
      event({
        id: 'evt-pub',
        publishItems: [
          // Most recent by activity but withdrawn → must not win.
          {
            id: 'pub-withdrawn',
            withdrawnAt: new Date('2026-11-15T00:00:00Z'),
            publishedAt: new Date('2026-11-15T00:00:00Z'),
          },
          // The live draft → the pick.
          { id: 'pub-draft', approvedAt: null, publishedAt: null, withdrawnAt: null, rejectedAt: null },
        ],
      }),
    ]);

    const { payload } = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));

    assert.equal(payload.items[0].publishItemId, 'pub-draft');
    assert.equal(payload.items[0].publishStatus, 'draft');
    // The publish item was selected in the same query (no separate call) and
    // the ordering is pushed to Prisma.
    assert.deepEqual(store.calls.findMany[0].select.publishItems.select, {
      id: true,
      approvedAt: true,
      publishedAt: true,
      withdrawnAt: true,
      rejectedAt: true,
    });
    assert.ok(Array.isArray(store.calls.findMany[0].select.publishItems.orderBy));
  });

  test('the status precedence (withdrawn > published > rejected > approved > draft) is derived', async () => {
    const store = makeStore([
      event({
        id: 'evt-published',
        publishItems: [{ id: 'p1', publishedAt: new Date('2026-11-12T00:00:00Z') }],
      }),
      event({
        id: 'evt-approved',
        publishItems: [{ id: 'p2', approvedAt: new Date('2026-11-12T00:00:00Z') }],
      }),
    ]);

    const { payload } = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    const byId = Object.fromEntries(payload.items.map((i) => [i.id, i]));
    assert.equal(byId['evt-published'].publishItemId, 'p1');
    assert.equal(byId['evt-published'].publishStatus, 'published');
    assert.equal(byId['evt-approved'].publishItemId, 'p2');
    assert.equal(byId['evt-approved'].publishStatus, 'approved');
  });

  test('an event with no publish items returns both fields null (list and detail)', async () => {
    const store = makeStore([event({ id: 'evt-empty', publishItems: [] })]);

    const list = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    assert.equal(list.payload.items[0].publishItemId, null);
    assert.equal(list.payload.items[0].publishStatus, null);

    const detail = await withPrisma(store, () => callController(getPulseEvent, { params: { id: 'evt-empty' } }));
    assert.equal(detail.payload.event.publishItemId, null);
    assert.equal(detail.payload.event.publishStatus, null);
    assert.ok(!('body' in detail.payload.event), 'body must never be returned');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Review status — persisted Accept/Dismiss + multi-filter composition.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse API: review status', () => {
  test('list exposes reviewStatus and filters by it', async () => {
    const store = makeStore([
      event({ id: 'new-1', reviewStatus: 'new' }),
      event({ id: 'acc-1', reviewStatus: 'accepted' }),
      event({ id: 'dis-1', reviewStatus: 'dismissed' }),
    ]);

    const all = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    assert.equal(all.payload.items[0].reviewStatus !== undefined, true);

    const accepted = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { reviewStatus: 'accepted' } }),
    );
    assert.deepEqual(accepted.payload.items.map((i) => i.id), ['acc-1']);
    assert.equal(accepted.payload.items[0].reviewStatus, 'accepted');
    assert.equal(store.calls.findMany.at(-1).where.reviewStatus, 'accepted');

    const dismissed = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { reviewStatus: 'dismissed' } }),
    );
    assert.deepEqual(dismissed.payload.items.map((i) => i.id), ['dis-1']);
  });

  test('an invalid reviewStatus is rejected with a 400', async () => {
    const store = makeStore([event({ id: 'a' })]);
    const { error } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { reviewStatus: 'archived' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 400);
    assert.notEqual(listSchema.validate({ reviewStatus: 'archived' }).error, undefined);
    assert.equal(listSchema.validate({ reviewStatus: 'new' }).error, undefined);
  });

  test('PATCH review persists the status and returns the updated card', async () => {
    const store = makeStore([event({ id: 'evt-1', reviewStatus: 'new' })]);

    const { payload } = await withPrisma(store, () =>
      callController(reviewPulseEvent, { params: { id: 'evt-1' }, body: { status: 'accepted' } }),
    );

    assert.equal(payload.event.id, 'evt-1');
    assert.equal(payload.event.reviewStatus, 'accepted');
    // Persisted on the underlying row (non-destructive in-place update).
    assert.equal(store.rows.find((r) => r.id === 'evt-1').reviewStatus, 'accepted');
    // Card shape mirrors the list DTO; body is never returned.
    assert.ok(!('body' in payload.event));
  });

  test('PATCH review rejects an invalid status with a 400 before any write', async () => {
    const store = makeStore([event({ id: 'evt-1', reviewStatus: 'new' })]);
    const { error } = await withPrisma(store, () =>
      callController(reviewPulseEvent, { params: { id: 'evt-1' }, body: { status: 'archive' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 400);
    assert.equal(store.rows.find((r) => r.id === 'evt-1').reviewStatus, 'new', 'no write on invalid input');
    assert.notEqual(reviewSchema.validate({ status: 'archive' }).error, undefined);
    assert.notEqual(reviewSchema.validate({}).error, undefined, 'status is required');
    assert.equal(reviewSchema.validate({ status: 'dismissed' }).error, undefined);
  });

  test('PATCH review on an unknown id returns 404', async () => {
    const store = makeStore([]);
    const { error } = await withPrisma(store, () =>
      callController(reviewPulseEvent, { params: { id: 'nope' }, body: { status: 'accepted' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 404);
  });

  test('function + region + reviewStatus compose (AND)', async () => {
    const src = (region) => [{ rawDocument: { source: { name: `${region} Src`, region } } }];
    const store = makeStore([
      event({ id: 'ng-f1-dismissed', functions: [1], reviewStatus: 'dismissed', sources: src('NG') }),
      event({ id: 'ng-f1-new', functions: [1], reviewStatus: 'new', sources: src('NG') }),
      event({ id: 'af-f1-dismissed', functions: [1], reviewStatus: 'dismissed', sources: src('AF') }),
      event({ id: 'ng-f2-dismissed', functions: [2], reviewStatus: 'dismissed', sources: src('NG') }),
    ]);

    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, {
        query: { function: 1, region: 'NG', reviewStatus: 'dismissed' },
      }),
    );

    assert.deepEqual(payload.items.map((i) => i.id), ['ng-f1-dismissed']);
    const where = store.calls.findMany.at(-1).where;
    assert.deepEqual(where.functions, { has: 1 });
    assert.deepEqual(where.sources, { some: { rawDocument: { source: { region: 'NG' } } } });
    assert.equal(where.reviewStatus, 'dismissed');
  });

  test('region + reviewStatus compose (AND)', async () => {
    const src = (region) => [{ rawDocument: { source: { name: `${region} Src`, region } } }];
    const store = makeStore([
      event({ id: 'ng-acc', reviewStatus: 'accepted', sources: src('NG') }),
      event({ id: 'ng-new', reviewStatus: 'new', sources: src('NG') }),
      event({ id: 'af-acc', reviewStatus: 'accepted', sources: src('AF') }),
    ]);

    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { region: 'NG', reviewStatus: 'accepted' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['ng-acc']);
  });

  test('function + reviewStatus compose (AND)', async () => {
    const store = makeStore([
      event({ id: 'f1-acc', functions: [1], reviewStatus: 'accepted' }),
      event({ id: 'f1-new', functions: [1], reviewStatus: 'new' }),
      event({ id: 'f7-acc', functions: [7], reviewStatus: 'accepted' }),
    ]);

    const { payload } = await withPrisma(store, () =>
      callController(listPulseEvents, { query: { function: 1, reviewStatus: 'accepted' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['f1-acc']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Excerpt — description fallback from the raw article body.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse API: excerpt fallback', () => {
  const srcWithBody = (body) => [{ rawDocument: { source: { name: 'Src' }, body } }];

  test('excerpt is populated from the raw body when summary is empty', async () => {
    const store = makeStore([
      event({ id: 'a', summary: '', sources: srcWithBody('The regulator issued a consumer advisory today.') }),
    ]);
    const { payload } = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    assert.equal(payload.items[0].excerpt, 'The regulator issued a consumer advisory today.');
    assert.equal(payload.items[0].hasSummary, false);
  });

  test('excerpt prefers the summary when it is populated', async () => {
    const store = makeStore([
      event({ id: 'a', summary: 'NovrPulse own words', sources: srcWithBody('RAW ARTICLE BODY') }),
    ]);
    const { payload } = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    assert.equal(payload.items[0].excerpt, 'NovrPulse own words');
    assert.equal(payload.items[0].hasSummary, true);
  });

  test('excerpt is null when there is no summary and no body', async () => {
    const store = makeStore([event({ id: 'a', summary: '', sources: [] })]);
    const { payload } = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    assert.equal(payload.items[0].excerpt, null);
    assert.equal(payload.items[0].hasSummary, false);
  });

  test('a long body is whitespace-collapsed, trimmed to the limit, and ellipsised', async () => {
    const store = makeStore([
      event({ id: 'a', summary: '', sources: srcWithBody(`  Line one\n\n   Line   two ${'x'.repeat(500)}`) }),
    ]);
    const { payload } = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    const ex = payload.items[0].excerpt;
    assert.ok(ex.startsWith('Line one Line two '), `collapsed+trimmed: ${JSON.stringify(ex.slice(0, 40))}`);
    assert.equal(ex.length, 221, 'excerpt is 220 chars plus the ellipsis');
    assert.ok(ex.endsWith('…'));
  });

  test('the full body is NOT in the list DTO (only the bounded excerpt)', async () => {
    const long = 'y'.repeat(1000);
    const store = makeStore([event({ id: 'a', summary: '', sources: srcWithBody(long) })]);
    const { payload } = await withPrisma(store, () => callController(listPulseEvents, { query: {} }));
    const first = payload.items[0];
    assert.ok(!('body' in first), 'body key must never be on the card');
    assert.ok(!JSON.stringify(first).includes(long), 'the full body must not be serialized');
    assert.ok(first.excerpt.length < long.length);
    // The query only ever selects the raw document body (never the whole row).
    assert.deepEqual(store.calls.findMany[0].select.sources.select.rawDocument.select, {
      body: true,
      source: { select: { name: true } },
    });
  });

  test('excerptOf is consistent across summary/body/neither (unit)', async () => {
    const { excerptOf } = await import('../src/controllers/pulseController.js');
    assert.equal(excerptOf({ summary: 'Sum', sources: [] }), 'Sum');
    assert.equal(excerptOf({ summary: '', sources: srcWithBody('Body text') }), 'Body text');
    assert.equal(excerptOf({ summary: '   ', sources: [] }), null);
    assert.equal(excerptOf({ summary: '', sources: [] }), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The route is mounted behind requireAuth and requireAuth rejects unauth.
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse API: route guard', () => {
  test('the router mounts /pulse behind requireAuth', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/routes/index.js', import.meta.url));
    const text = await readFile(path, 'utf8');
    assert.match(
      text,
      /router\.use\('\/pulse',\s*requireAuth,\s*pulseRoutes\);/,
      'pulse must be mounted with requireAuth',
    );
  });

  test('the pulse router registers the review PATCH route', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/routes/pulseRoutes.js', import.meta.url));
    const text = await readFile(path, 'utf8');
    assert.match(
      text,
      /router\.patch\('\/events\/:id\/review',\s*asyncHandler\(pulseController\.reviewPulseEvent\)\);/,
      'review route must be registered',
    );
  });

  test('requireAuth with a missing bearer token rejects with 401', async () => {
    const { requireAuth } = await import('../src/middleware/auth.js');
    let captured;
    await requireAuth({ headers: {} }, {}, (err) => {
      captured = err;
    });
    assert.ok(captured, 'unauthenticated request must be rejected');
    assert.equal(captured.statusCode, 401);
  });
});
