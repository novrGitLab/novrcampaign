import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCollectionClient,
  signRequest,
  buildCanonicalString,
  canonicalQuery,
  contentHash,
  computeSignature,
  CollectionApiError,
} from '../src/services/novrpulse/collectionClient.js';
import { pullItemsAndCreateEvents } from '../src/services/novrpulse/collectionPull.js';

// The anti-desync guard: import a PINNED copy of the COLLECTOR's pure
// verification helper (no config, no network, no side effects) and verify our
// signer against it. If the two canonical strings ever differ, these tests fail
// loudly. The collector now lives in the standalone novr-collection repo; the
// fixture is a byte-for-byte copy of that repo's src/auth/hmac.js (see the
// fixture header) so the guard keeps running here without a cross-repo import.
import { verifyRequest, buildCanonicalString as collectorCanonical, canonicalQuery as collectorCanonicalQuery } from './fixtures/collector-hmac.fixture.js';

/**
 * Focused tests for the Pulse-side collector client + pull/store orchestration.
 *
 * No database, no network: the HTTP layer and the store adapter are stubbed,
 * mirroring the existing backend test style (see novrpulseProjection.test.mjs).
 */

const SECRET = 'test-secret-please-change-0123456789';
const CREDENTIALS = { consumerId: 'pulse', keyId: 'pulse-2026-01', secret: SECRET };
// Fixed signing clock (2026-01-15T12:00:00Z) so skew never trips in CI.
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

/** Lower-case the headers exactly as the collector's middleware reads them. */
function lower(headers) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

// ── 1. Signer agreement with the collector (the critical test) ─────────────────

describe('signer agrees byte-for-byte with the collector', () => {
  test('GET with an empty body verifies', () => {
    const headers = signRequest({ method: 'GET', path: '/v1/runs/abc', credentials: CREDENTIALS, nowMs: NOW });
    assert.deepEqual(
      computeSignature(SECRET, buildCanonicalString({ method: 'GET', path: '/v1/runs/abc', consumerId: 'pulse', keyId: 'pulse-2026-01', date: headers['X-Date'], nonce: headers['X-Nonce'], contentSha256: headers['X-Content-SHA256'] })),
      headers['X-Signature'],
    );
    assert.equal(headers['X-Content-SHA256'], contentHash(''));

    // The collector verifies the exact headers we produced.
    assert.doesNotThrow(() =>
      verifyRequest({
        method: 'GET',
        path: '/v1/runs/abc',
        query: '',
        rawBody: Buffer.alloc(0),
        headers: lower(headers),
        secret: SECRET,
        nowMs: NOW,
      }),
    );
  });

  test('POST with a JSON body verifies', () => {
    const body = JSON.stringify({ sourceIds: ['cbn'], maxAgeDays: 7 });
    const headers = signRequest({ method: 'POST', path: '/v1/collections', body, credentials: CREDENTIALS, nowMs: NOW });
    assert.equal(headers['X-Content-SHA256'], contentHash(body));
    assert.doesNotThrow(() =>
      verifyRequest({
        method: 'POST',
        path: '/v1/collections',
        query: '',
        rawBody: Buffer.from(body),
        headers: lower(headers),
        secret: SECRET,
        nowMs: NOW,
      }),
    );
  });

  test('a query with a space (%20) and a literal + verifies', () => {
    // cursor carries a space, limit is numeric; the raw wire query is exactly
    // `cursor=a%20b&limit=50`. The signer must percent-decode-then-re-encode (no
    // `+`-as-space), which the collector's canonicalQuery also does.
    const rawQuery = 'cursor=a%20b&limit=50';
    const headers = signRequest({
      method: 'GET',
      path: '/v1/runs/r1/items',
      query: rawQuery,
      credentials: CREDENTIALS,
      nowMs: NOW,
    });

    // Our canonical string equals the collector's for this raw query.
    assert.equal(
      buildCanonicalString({
        method: 'GET',
        path: '/v1/runs/r1/items',
        query: rawQuery,
        consumerId: CREDENTIALS.consumerId,
        keyId: CREDENTIALS.keyId,
        date: headers['X-Date'],
        nonce: headers['X-Nonce'],
        contentSha256: headers['X-Content-SHA256'],
      }),
      collectorCanonical({
        method: 'GET',
        path: '/v1/runs/r1/items',
        query: rawQuery,
        consumerId: CREDENTIALS.consumerId,
        keyId: CREDENTIALS.keyId,
        date: headers['X-Date'],
        nonce: headers['X-Nonce'],
        contentSha256: headers['X-Content-SHA256'],
      }),
    );

    assert.doesNotThrow(() =>
      verifyRequest({
        method: 'GET',
        path: '/v1/runs/r1/items',
        query: rawQuery,
        rawBody: Buffer.alloc(0),
        headers: lower(headers),
        secret: SECRET,
        nowMs: NOW,
      }),
    );
  });

  test('a literal + in a value is NOT treated as a space (matches the collector)', () => {
    // `q=a+b` must canonicalise to `q=a%2Bb` — a literal plus, not `q=a b`.
    assert.equal(canonicalQuery('q=a+b'), 'q=a%2Bb');
    assert.equal(canonicalQuery('q=a+b'), collectorCanonicalQuery('q=a+b'));
    // And a space must be %20 on both sides.
    assert.equal(canonicalQuery('q=a b'), 'q=a%20b');
    assert.equal(canonicalQuery('q=a b'), collectorCanonicalQuery('q=a b'));
  });
});

// ── 2. Client happy path: start + poll + paged items ──────────────────────────

/**
 * Build a stubbed HTTP layer for the collector client. `pages` is an array of
 * item arrays; each GET items call returns the next page with its cursor.
 */
function stubFetch({ pages, statuses = ['completed'] }) {
  let statusCall = 0;
  let pageCall = 0;
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    calls.push({ method: opts.method, path: u.pathname, query: u.search, headers: opts.headers, body: opts.body });
    const json = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return JSON.stringify(body);
      },
    });

    if (u.pathname === '/v1/collections' && opts.method === 'POST') {
      return json(202, { runId: 'run-1', status: 'running' });
    }
    if (u.pathname === '/v1/runs/run-1' && opts.method === 'GET') {
      const status = statuses[Math.min(statusCall, statuses.length - 1)];
      statusCall += 1;
      return json(200, { runId: 'run-1', status, itemCount: pages.flat().length, ok: status === 'completed' });
    }
    if (u.pathname === '/v1/runs/run-1/items' && opts.method === 'GET') {
      const page = pages[pageCall] ?? [];
      const last = pageCall >= pages.length - 1;
      pageCall += 1;
      return json(200, {
        runId: 'run-1',
        status: 'completed',
        items: page,
        nextCursor: last ? null : `cursor-${pageCall}`,
        complete: last,
      });
    }
    return json(404, { error: { code: 'RUN_NOT_FOUND', message: 'nope' } });
  };
  return { fetchImpl, calls, counts: () => ({ statusCall, pageCall }) };
}

function makeConfig() {
  return { baseUrl: 'http://localhost:4100', consumerId: CREDENTIALS.consumerId, keyId: CREDENTIALS.keyId, apiKey: 'NP_COLLECTION_TEST_SECRET', timeoutMs: 5000, pageSize: 2, maxPolls: 5, pollIntervalMs: 0 };
}

describe('collection client: happy path', () => {
  test('startRun + getRun + paged getRunItems concatenate with no drops/dupes', async () => {
    process.env.NP_COLLECTION_TEST_SECRET = SECRET;
    const pageA = [{ contentHash: 'h1', link: 'https://e.test/1' }, { contentHash: 'h2', link: 'https://e.test/2' }];
    const pageB = [{ contentHash: 'h3', link: 'https://e.test/3' }];
    const { fetchImpl, calls } = stubFetch({ pages: [pageA, pageB] });

    const client = createCollectionClient(makeConfig(), { fetchImpl, now: () => NOW });
    const started = await client.startRun({ sourceIds: ['cbn'], maxAgeDays: 7 });
    assert.deepEqual(started, { runId: 'run-1', status: 'running' });

    const run = await client.getRun('run-1');
    assert.equal(run.status, 'completed');

    const all = [];
    let cursor = null;
    for (;;) {
      const res = await client.getRunItems('run-1', cursor, 2);
      all.push(...res.items);
      if (res.complete) break;
      cursor = res.nextCursor;
    }
    assert.deepEqual(all.map((i) => i.contentHash), ['h1', 'h2', 'h3']);

    // Every request carried the six contract headers.
    for (const c of calls) {
      for (const h of ['X-Consumer-Id', 'X-Key-Id', 'X-Date', 'X-Nonce', 'X-Content-SHA256', 'X-Signature']) {
        assert.ok(c.headers[h], `missing header ${h} on ${c.method} ${c.path}`);
      }
    }
    // The second items call replayed the cursor from the first page.
    const itemsCalls = calls.filter((c) => c.path === '/v1/runs/run-1/items');
    assert.ok(itemsCalls[1].query.includes('cursor=cursor-1'), 'paging cursor must round-trip');
  });
});

// ── 3. Error envelope → typed error carrying the code ─────────────────────────

describe('collection client: error envelope', () => {
  test('a {error:{code}} response throws a typed error carrying the code', async () => {
    process.env.NP_COLLECTION_TEST_SECRET = SECRET;
    const fetchImpl = async () => ({
      ok: false,
      status: 403,
      async text() {
        return JSON.stringify({ error: { code: 'FORBIDDEN_SCOPE', message: 'missing scope' } });
      },
    });
    const client = createCollectionClient(makeConfig(), { fetchImpl, now: () => NOW });
    await assert.rejects(
      () => client.getRun('run-1'),
      (err) => err instanceof CollectionApiError && err.code === 'FORBIDDEN_SCOPE' && err.status === 403,
    );
  });
});

// ── 4. Store reuse: pulled items flow into storeRun with the adapter ───────────

describe('pull orchestration: paged items reach the store adapter', () => {
  test('pullItemsAndCreateEvents feeds paged items to the adapter storeBatch', async () => {
    const pages = [
      [{ contentHash: 'h1', link: 'https://e.test/1', sourceId: 'cbn' }],
      [{ contentHash: 'h2', link: 'https://e.test/2', sourceId: 'cbn' }],
    ];
    const items = pages.flat();
    // A client stub returning a terminal run and two pages.
    const client = {
      async startRun() {
        return { runId: 'run-9', status: 'running' };
      },
      async getRun() {
        return { runId: 'run-9', status: 'completed', ok: true };
      },
      async getRunItems(_runId, cursor) {
        if (!cursor) return { items: pages[0], nextCursor: 'c1', complete: false };
        return { items: pages[1], nextCursor: null, complete: true };
      },
    };
    // A spy adapter: storeRun requires upsertSource, and calls storeBatch when present.
    const upserted = [];
    let batchArg = null;
    const adapter = {
      async upsertSource(s) {
        upserted.push(s.id);
      },
      async storeBatch(batch) {
        batchArg = batch;
        return { stored: batch.length, skipped: 0, events: batch.length };
      },
    };

    const summary = await pullItemsAndCreateEvents({ client, adapter, pageSize: 1, maxPolls: 1, intervalMs: 0 });

    assert.equal(summary.runId, 'run-9');
    assert.equal(summary.status, 'completed');
    assert.equal(summary.items, 2);
    assert.deepEqual(summary.stored, 2);
    // The exact pulled items reached the adapter, and their sources were ensured.
    assert.deepEqual(batchArg, items);
    assert.ok(upserted.length > 0, 'storeRun must upsert the selected registry sources');
  });

  test('a PARTIAL run is stored (no throw) and reports status "partial"', async () => {
    const items = [
      { contentHash: 'h1', link: 'https://e.test/1', sourceId: 'cbn' },
      { contentHash: 'h2', link: 'https://e.test/2', sourceId: 'cbn' },
    ];
    // A terminal run reporting 'partial' (some sources ok, some stale) WITH items.
    const client = {
      async startRun() {
        return { runId: 'run-10', status: 'running' };
      },
      async getRun() {
        return {
          runId: 'run-10',
          status: 'partial',
          ok: false,
          itemCount: items.length,
          sources: [
            { sourceId: 'cbn', ok: true },
            { sourceId: 'other', ok: false, status: 'stale' },
          ],
        };
      },
      async getRunItems() {
        return { items, nextCursor: null, complete: true };
      },
    };
    const adapter = {
      async upsertSource() {},
      async storeBatch(batch) {
        return { stored: batch.length, skipped: 0, events: batch.length };
      },
    };

    const summary = await pullItemsAndCreateEvents({ client, adapter, pageSize: 10, maxPolls: 1, intervalMs: 0 });

    assert.equal(summary.status, 'partial');
    assert.equal(summary.items, 2);
    assert.equal(summary.stored, 2, 'partial items must be stored, not discarded');
  });
});
