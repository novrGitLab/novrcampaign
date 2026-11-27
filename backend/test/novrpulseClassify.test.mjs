import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import config from '../src/config/env.js';
import {
  classifyEvents,
  findUnclassified,
  clearClassifications,
  buildClassifySystem,
  buildClassifyPrompt,
  parseClassificationEntry,
  resolveCyberVerdict,
  normalizeClassifications,
  CLASSIFY_SCHEMA,
  CLASSIFY_MIN_CONFIDENCE,
} from '../src/services/novrpulse/classify.js';

// Tests for the batched AI filtering classification (the accurate layer).
//
// The LLM is STUBBED (no network) and the shared Prisma singleton's `npEvent`
// delegate is shadowed with an in-memory fake (the pattern used by
// novrpulseAiDraft.test.mjs / novrpulsePulseApi.test.mjs).

// ─────────────────────────────────────────────────────────────────────────────
// In-memory np_event stand-in: supports the classification selector
// (OR of the three flags IS NULL) and the per-event update.
// ─────────────────────────────────────────────────────────────────────────────

function makeStore(seed = []) {
  const rows = seed.map((r) => ({ createdAt: new Date('2026-11-01T00:00:00Z'), ...r }));
  const calls = { findMany: [], update: [] };

  const npEvent = {
    async findMany(args = {}) {
      calls.findMany.push(args);
      let out = rows.filter((r) => {
        const ors = args.where?.OR;
        if (!Array.isArray(ors)) return true;
        // OR: ANY clause matches.
        return ors.some((clause) => {
          if (Array.isArray(clause.AND)) {
            // e.g. { AND: [{ isCybersecurity: true }, { cyberRegion: null }] }.
            return clause.AND.every((sub) => {
              const [k] = Object.keys(sub);
              return sub[k] === null ? (r[k] === null || r[k] === undefined) : r[k] === sub[k];
            });
          }
          const [key] = Object.keys(clause);
          const cond = clause[key];
          // `{ not: null }` (used by clearClassifications) matches any non-null.
          if (cond && typeof cond === 'object' && 'not' in cond) {
            return cond.not === null ? (r[key] !== null && r[key] !== undefined) : r[key] !== cond.not;
          }
          return r[key] === null || r[key] === undefined;
        });
      });
      out = [...out].sort((a, b) => {
        const ap = a.publishedAt ? new Date(a.publishedAt).getTime() : -Infinity;
        const bp = b.publishedAt ? new Date(b.publishedAt).getTime() : -Infinity;
        return bp - ap;
      });
      if (typeof args.take === 'number') out = out.slice(0, args.take);
      // Shape the select: title/summary + first source chain, or just id.
      if (args.select && args.select.id === true && Object.keys(args.select).length === 1) {
        return out.map((r) => ({ id: r.id }));
      }
      return out.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary ?? '',
        cyberRegion: r.cyberRegion ?? null,
        sources: (r.sources ?? []).slice(0, 1),
      }));
    },
    async updateMany({ where, data }) {
      calls.update.push({ where, data });
      const row = rows.find((r) => r.id === where.id);
      if (!row || row.restoredAt) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
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

/** An LLM stub returning a fixed result or a function of the request. */
function stubLlm(result, model = 'stub-bulk') {
  const calls = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      return typeof result === 'function' ? result(request) : result;
    },
    model: () => model,
  };
}

/** With an API key configured for the duration of `fn`. */
function withApiKey(fn) {
  const prev = config.novrpulse.llm.apiKey;
  config.novrpulse.llm.apiKey = 'test-key';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      config.novrpulse.llm.apiKey = prev;
    });
}

function event(over = {}) {
  return {
    id: 'evt-1',
    title: 'Some story',
    summary: '',
    publishedAt: new Date('2026-11-10T00:00:00Z'),
    isCybersecurity: null,
    isThreatIntel: null,
    isNigeriaRelated: null,
    cyberRegion: null,
    sources: [{ rawDocument: { body: 'body text', source: { name: 'Src' } } }],
    ...over,
  };
}

after(() => {
  delete prisma.npEvent;
});

// ─────────────────────────────────────────────────────────────────────────────
// Selector
// ─────────────────────────────────────────────────────────────────────────────

describe('classify: selector', () => {
  test('findUnclassified selects events with a flag NULL and skips fully-classified ones', async () => {
    const store = makeStore([
      event({ id: 'null', isCybersecurity: null }),
      event({ id: 'all-set', isCybersecurity: true, isThreatIntel: false, isNigeriaRelated: true, cyberRegion: 'NG' }),
      event({ id: 'partial', isCybersecurity: true, isThreatIntel: null, isNigeriaRelated: false }),
    ]);

    const pending = await withPrisma(store, () => findUnclassified());
    assert.deepEqual(pending.map((e) => e.id).sort(), ['null', 'partial']);
    // The selector is the OR-of-IS-NULL on isCybersecurity / isThreatIntel.
    const where = store.calls.findMany.at(-1).where;
    assert.equal(where.OR.length, 2);
  });

  test('the capability ceiling is applied via `take`', async () => {
    const store = makeStore([event({ id: 'a' }), event({ id: 'b' }), event({ id: 'c' })]);
    await withPrisma(store, () => findUnclassified({ limit: 2 }));
    assert.equal(store.calls.findMany.at(-1).take, 2);
  });

  test('regionBackfill also selects classified-cyber events whose region is NULL', async () => {
    const store = makeStore([
      event({ id: 'classified-no-region', isCybersecurity: true, isThreatIntel: false, cyberRegion: null }),
      event({ id: 'classified-with-region', isCybersecurity: true, isThreatIntel: false, cyberRegion: 'NG' }),
      event({ id: 'not-cyber', isCybersecurity: false, isThreatIntel: false, cyberRegion: null }),
      event({ id: 'never-classified', isCybersecurity: null }),
    ]);
    const pending = await withPrisma(store, () => findUnclassified({ regionBackfill: true }));
    assert.deepEqual(pending.map((e) => e.id).sort(), ['classified-no-region', 'never-classified']);
    // Default (no backfill) keeps the unchanged selector.
    const plain = await withPrisma(store, () => findUnclassified());
    assert.deepEqual(plain.map((e) => e.id), ['never-classified']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyEvents
// ─────────────────────────────────────────────────────────────────────────────

describe('classify: classifyEvents', () => {
  test('a stubbed batch writes all three fields per the model judgment', async () => {
    const store = makeStore([
      event({ id: 'e1' }),
      event({ id: 'e2' }),
    ]);
    const llm = stubLlm({
      classifications: [
        { index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false, cybersecurityReason: 'SIM-swap fraud advisory for Nigerian telcos', confidence: 0.9 },
        { index: 2, isCybersecurity: false, cyberRegion: null, isThreatIntel: true, cybersecurityReason: 'no security substance', confidence: 0.8 },
      ],
    });

    const result = await withApiKey(() =>
      withPrisma(store, () => classifyEvents({ llm })),
    );

    assert.equal(result.candidates, 2);
    assert.equal(result.classified, 2);
    assert.equal(result.batches, 1);
    assert.equal(llm.calls.length, 1, 'one classify call per batch');
    assert.equal(llm.calls[0].tier, 'bulk', 'classification uses the bulk tier (frontier maps to the same model)');
    assert.deepEqual(llm.calls[0].schema, CLASSIFY_SCHEMA);

    const byId = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    assert.deepEqual(
      [byId.e1.isCybersecurity, byId.e1.cyberRegion, byId.e1.isThreatIntel],
      [true, 'NG', false],
    );
    assert.deepEqual(
      [byId.e2.isCybersecurity, byId.e2.cyberRegion, byId.e2.isThreatIntel],
      [false, null, true],
    );
  });

  test('a non-cyber verdict stores a null cyberRegion even if the model sends a region', async () => {
    const store = makeStore([event({ id: 'e1' })]);
    const llm = stubLlm({
      classifications: [{ index: 1, isCybersecurity: false, cyberRegion: 'NG', isThreatIntel: false }],
    });
    await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(store.rows[0].isCybersecurity, false);
    assert.equal(store.rows[0].cyberRegion, null, 'region nulled out for a non-cyber story');
  });

  test('the AI pass OVERWRITES a keyword pre-tag true (documented rule)', async () => {
    const store = makeStore([event({ id: 'e1', isCybersecurity: true, isThreatIntel: null, cyberRegion: 'NG' })]);
    const llm = stubLlm({
      classifications: [{ index: 1, isCybersecurity: false, cyberRegion: null, isThreatIntel: false }],
    });
    await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(store.rows[0].isCybersecurity, false, 'AI verdict is authoritative');
    assert.equal(store.rows[0].cyberRegion, null, 'and its region is cleared');
  });

  test('malformed entries (missing index / non-boolean flags / bad region) are skipped', async () => {
    const store = makeStore([event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' }), event({ id: 'e4' })]);
    // A single batch call: ONE response covers story #1 (valid); the other three
    // entries are malformed. The per-story recovery then re-asks for #2..#4 and
    // the stub answers each with exactly one valid entry, so those are applied.
    const llm = stubLlm((req) => {
      const n = (req.prompt.match(/^#\d+/gm) ?? []).length;
      if (n > 1) {
        return {
          classifications: [
            { index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false, cybersecurityReason: 'phishing campaign targeting banks', confidence: 0.9 },
            { index: 99, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false }, // out of range
            { index: 3, isCybersecurity: 'yes', cyberRegion: 'NG', isThreatIntel: false }, // bad type
            { index: 4, isCybersecurity: true, cyberRegion: 'EUROPE', isThreatIntel: false }, // bad region
            { isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false }, // no index
          ],
        };
      }
      return { classifications: [{ index: 1, isCybersecurity: false, cyberRegion: null, isThreatIntel: false }] };
    });

    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(result.classified, 4, 'story #1 from the batch + #2..#4 from per-story recovery');
    // Four malformed entries are counted when the batch response is scanned.
    assert.equal(result.skipped, 4);
    // ...but no event is left unclassified, and none is written with junk: the
    // out-of-range / bad-type / bad-region / index-less entries never map to a story.
    const byId = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    assert.equal(byId.e1.isCybersecurity, true);
    assert.equal(byId.e2.isCybersecurity, false, 'recovered per story (valid single entry)');
    assert.equal(byId.e3.isCybersecurity, false);
    assert.equal(byId.e4.isCybersecurity, false);
    assert.equal(store.calls.update.length, 4);
  });

  test('a mixed valid/invalid batch applies the valid entries and skips the invalid ones', async () => {
    const store = makeStore([event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' })]);
    // The batch response mixes a valid entry (#1), a non-object, and a valid #3.
    // Story #2 is uncovered by the batch and is recovered one story per call.
    const llm = stubLlm((req) => {
      const n = (req.prompt.match(/^#\d+/gm) ?? []).length;
      if (n > 1) {
        return {
          classifications: [
            { index: 1, isCybersecurity: true, cyberRegion: 'AF', isThreatIntel: false, cybersecurityReason: 'bank breach in Kenya', confidence: 0.85 },
            'not-an-object',
            { index: 3, isCybersecurity: false, cyberRegion: null, isThreatIntel: true },
          ],
        };
      }
      return { classifications: [{ index: 1, isCybersecurity: false, cyberRegion: null, isThreatIntel: false }] };
    });

    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));

    assert.equal(result.classified, 3, 'valid batch entries + the recovered story');
    assert.equal(result.skipped, 1, 'the one invalid entry is skipped');
    const byId = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    assert.deepEqual(
      [byId.e1.isCybersecurity, byId.e1.cyberRegion, byId.e1.isThreatIntel],
      [true, 'AF', false],
    );
    assert.equal(byId.e2.isCybersecurity, false, 'the uncovered story is recovered per story');
    assert.deepEqual(
      [byId.e3.isCybersecurity, byId.e3.cyberRegion, byId.e3.isThreatIntel],
      [false, null, true],
    );
  });

  test('an all-invalid batch does not crash: zero applied, run continues', async () => {
    const store = makeStore([event({ id: 'e1' }), event({ id: 'e2' })]);
    // Every entry is malformed on the batch AND the per-story recovery calls.
    const llm = stubLlm({ classifications: ['x', 42, null, { index: 'nope' }] });

    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));

    assert.equal(result.classified, 0);
    // 4 malformed entries in the batch + 1 malformed recovery entry per story.
    assert.equal(result.skipped, 6);
    assert.equal(result.candidates, 2);
    assert.equal(store.calls.update.length, 0, 'no writes when nothing is valid');
    assert.equal(store.rows[0].isCybersecurity, null, 'events stay unclassified');
    assert.equal(store.rows[1].isCybersecurity, null);
  });

  test('the call schema is the permissive envelope (raw array accepted)', async () => {
    const store = makeStore([event({ id: 'e1' })]);
    const llm = stubLlm({ classifications: [{ index: 1, isCybersecurity: true, cyberRegion: 'GLOBAL', isThreatIntel: true, cybersecurityReason: 'named ransomware actor profiled', confidence: 0.95 }] });
    await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    const schema = llm.calls[0].schema;
    assert.equal(schema.properties.classifications.type, 'array');
    assert.equal(schema.properties.classifications.items, undefined, 'no per-item schema at the client');
  });

  test('batches respect batchSize (multiple bulk calls)', async () => {
    const store = makeStore([event({ id: 'a' }), event({ id: 'b' }), event({ id: 'c' })]);
    const llm = stubLlm((req) => {
      // One entry per story in the prompt, all false.
      const count = (req.prompt.match(/^#\d+/gm) ?? []).length;
      return {
        classifications: Array.from({ length: count }, (_, i) => ({
          index: i + 1, isCybersecurity: false, cyberRegion: null, isThreatIntel: false,
        })),
      };
    });

    const result = await withApiKey(() =>
      withPrisma(store, () => classifyEvents({ llm, batchSize: 2 })),
    );
    assert.equal(result.batches, 2, '3 events at batchSize 2 → 2 calls');
    assert.equal(llm.calls.length, 2);
    assert.equal(result.classified, 3);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REGRESSION: "Classified 1 of N" — a multi-entry batch must apply EVERY entry.
  // ───────────────────────────────────────────────────────────────────────────

  test('REGRESSION: a 3-entry batch applies ALL 3 entries (not just the first)', async () => {
    const store = makeStore([event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' })]);
    const llm = stubLlm({
      classifications: [
        { index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false, cybersecurityReason: 'ransomware on a Nigerian hospital', confidence: 0.9 },
        { index: 2, isCybersecurity: false, cyberRegion: null, isThreatIntel: false, cybersecurityReason: 'general tech news', confidence: 0.9 },
        { index: 3, isCybersecurity: true, cyberRegion: 'GLOBAL', isThreatIntel: true, cybersecurityReason: 'named ransomware actor profiled', confidence: 0.95 },
      ],
    });

    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));

    assert.equal(result.candidates, 3);
    assert.equal(result.classified, 3, 'all three entries are applied, not 1 of 3');
    assert.equal(result.skipped, 0);
    assert.equal(store.calls.update.length, 3, 'one write per applied entry');
    const byId = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    assert.deepEqual([byId.e1.isCybersecurity, byId.e1.cyberRegion, byId.e1.isThreatIntel], [true, 'NG', false]);
    assert.deepEqual([byId.e2.isCybersecurity, byId.e2.cyberRegion, byId.e2.isThreatIntel], [false, null, false]);
    assert.deepEqual([byId.e3.isCybersecurity, byId.e3.cyberRegion, byId.e3.isThreatIntel], [true, 'GLOBAL', true]);
  });

  test('REGRESSION: the model collapsing a 3-story batch to ONE entry (#1) is recovered per story', async () => {
    // The exact live shape: a 20-story prompt the model answers with a single
    // `index:1` entry every time. Only the first story is covered by the batch
    // response; the rest MUST be recovered one story per call.
    const store = makeStore([event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' })]);
    let batchCalls = 0;
    const llm = stubLlm((req) => {
      const n = (req.prompt.match(/^#\d+/gm) ?? []).length;
      if (n > 1) batchCalls += 1;
      // Always answer with exactly ONE entry numbered #1 (the model's behaviour).
      return {
        classifications: [
          { index: 1, isCybersecurity: false, cyberRegion: null, isThreatIntel: false, cybersecurityReason: 'judged from this story', confidence: 0.9 },
        ],
      };
    });

    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));

    assert.equal(batchCalls, 1, 'one batch call, then per-story recovery calls');
    assert.equal(result.classified, 3, 'all three stories are classified despite the 1-entry batches');
    assert.equal(store.calls.update.length, 3);
    const byId = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    assert.equal(byId.e1.isCybersecurity, false);
    assert.equal(byId.e2.isCybersecurity, false);
    assert.equal(byId.e3.isCybersecurity, false);
  });

  test('accepts the WRAPPED envelope shape { classifications: [...] }', async () => {
    const store = makeStore([event({ id: 'e1' })]);
    const llm = stubLlm({ classifications: [{ index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false, cybersecurityReason: 'SIM-swap fraud', confidence: 0.9 }] });
    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(result.classified, 1);
    assert.equal(store.rows[0].isCybersecurity, true);
  });

  test('accepts the BARE-ARRAY shape [ ... ] (the model returning the array directly)', async () => {
    const store = makeStore([event({ id: 'e1' }), event({ id: 'e2' })]);
    // The client returns the parsed value verbatim; a bare array (no envelope)
    // must be normalized, not dropped.
    const llm = stubLlm([
      { index: 1, isCybersecurity: true, cyberRegion: 'AF', isThreatIntel: false, cybersecurityReason: 'bank breach in Kenya', confidence: 0.85 },
      { index: 2, isCybersecurity: false, cyberRegion: null, isThreatIntel: false, cybersecurityReason: 'fintech funding', confidence: 0.9 },
    ]);

    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));

    assert.equal(result.classified, 2, 'a bare array of two entries applies both');
    const byId = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    assert.deepEqual([byId.e1.isCybersecurity, byId.e1.cyberRegion], [true, 'AF']);
    assert.deepEqual([byId.e2.isCybersecurity, byId.e2.cyberRegion], [false, null]);
  });

  test('a single OBJECT (not an array) is handled without crashing', async () => {
    const store = makeStore([event({ id: 'e1' })]);
    // A model that returns one bare classification object instead of an array or
    // an envelope. It must not crash; the one story is recovered per story.
    const llm = stubLlm({ index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false, cybersecurityReason: 'phishing advisory', confidence: 0.9 });
    // The recovery call also returns the single object, which the per-story path
    // cannot parse as an array — so the story is cleanly skipped, not crashed.
    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(result.candidates, 1);
    assert.equal(result.classified, 0, 'a non-array object carries no array to normalize');
    assert.equal(store.rows[0].isCybersecurity, null, 'the story stays unclassified, no crash');
  });

  test('normalizeClassifications accepts both shapes and rejects the rest', () => {
    const entry = { index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false };
    assert.deepEqual(normalizeClassifications({ classifications: [entry] }), [entry]);
    assert.deepEqual(normalizeClassifications([entry]), [entry]);
    assert.deepEqual(normalizeClassifications({}), []);
    assert.deepEqual(normalizeClassifications(null), []);
    assert.deepEqual(normalizeClassifications(entry), [], 'a bare object is not an array of entries');
  });

  test('no candidates → no LLM call, zero counts', async () => {
    const store = makeStore([event({ id: 'done', isCybersecurity: true, isThreatIntel: true, cyberRegion: 'NG' })]);
    const llm = stubLlm({ classifications: [] });
    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(result.candidates, 0);
    assert.equal(result.classified, 0);
    assert.equal(llm.calls.length, 0);
  });

  test('a failed batch is caught and leaves those events unclassified', async () => {
    const store = makeStore([event({ id: 'e1' })]);
    const llm = {
      calls: [],
      async complete() {
        throw new Error('LLM exploded');
      },
      model: () => 'stub',
    };
    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(result.classified, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.results[0].error, 'LLM exploded');
    assert.equal(store.rows[0].isCybersecurity, null);
  });

  test('unconfigured (no API key) → 503 AI_NOT_CONFIGURED', async () => {
    const prev = config.novrpulse.llm.apiKey;
    config.novrpulse.llm.apiKey = '';
    try {
      const store = makeStore([event({ id: 'e1' })]);
      await assert.rejects(
        () => withPrisma(store, () => classifyEvents({ llm: stubLlm({ classifications: [] }) })),
        (err) => {
          assert.equal(err.statusCode, 503);
          assert.equal(err.code, 'AI_NOT_CONFIGURED');
          return true;
        },
      );
    } finally {
      config.novrpulse.llm.apiKey = prev;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt contract — untrusted data is delimited + ignore-instructions present.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Per-item validation — cyberRegion domain.
// ─────────────────────────────────────────────────────────────────────────────

describe('classify: parseClassificationEntry (cyberRegion)', () => {
  test('accepts the three canonical tiers', () => {
    for (const region of ['NG', 'AF', 'GLOBAL']) {
      const parsed = parseClassificationEntry({ index: 1, isCybersecurity: true, cyberRegion: region, isThreatIntel: false });
      assert.equal(parsed?.cyberRegion, region);
    }
  });

  test('accepts a null region (non-cyber)', () => {
    const parsed = parseClassificationEntry({ index: 1, isCybersecurity: false, cyberRegion: null, isThreatIntel: false });
    assert.equal(parsed?.cyberRegion, null);
  });

  test('an unknown region string rejects the entry', () => {
    assert.equal(parseClassificationEntry({ index: 1, isCybersecurity: true, cyberRegion: 'EUROPE', isThreatIntel: false }), null);
    assert.equal(parseClassificationEntry({ index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false })?.cyberRegion, 'NG');
  });
});

describe('classify: prompt contract', () => {  test('the system prompt defines the three fields and the untrusted-data rule', () => {
    const system = buildClassifySystem();
    assert.ok(system.includes('isCybersecurity'));
    assert.ok(system.includes('isThreatIntel'));
    assert.ok(system.includes('cyberRegion'));
    assert.ok(system.includes('NG'));
    assert.ok(system.includes('AF'));
    assert.ok(system.includes('GLOBAL'));
    assert.ok(system.includes('UNTRUSTED'));
    assert.ok(/IGNORE any instructions/i.test(system));
  });

  test('the user prompt delimits the story block and numbers the stories', () => {
    const prompt = buildClassifyPrompt([
      { title: 'T1', summary: 'S1', bodyExcerpt: 'B1', sourceName: 'Src1' },
      { title: 'T2', summary: 'S2', bodyExcerpt: '', sourceName: 'Src2' },
    ]);
    assert.ok(prompt.includes('--- BEGIN UNTRUSTED STORY DATA ---'));
    assert.ok(prompt.includes('--- END UNTRUSTED STORY DATA ---'));
    assert.ok(prompt.includes('#1'));
    assert.ok(prompt.includes('#2'));
  });

  test('the prompt carries the STRICT definition, the exclusions and the reason field', () => {
    const system = buildClassifySystem();
    // Strict definition + exclusions (owner feedback 2026-11-26).
    assert.ok(/SUBSTANCE/i.test(system), 'the substance test is stated');
    assert.ok(/isCybersecurity=false for/i.test(system), 'the exclusion list is present');
    assert.ok(/AI product or funding/i.test(system), 'AI-feature stories are excluded (unless a security threat)');
    assert.ok(/fintech\/finance\/markets/i.test(system), 'fintech/markets are excluded');
    assert.ok(/When in doubt/i.test(system), 'the when-in-doubt tie-break is stated');
    // Reason + confidence contract.
    assert.ok(system.includes('cybersecurityReason'), 'the per-entry reason field is required');
    assert.ok(/confidence/i.test(system), 'confidence is requested');
    assert.ok(/JSON only/i.test(system), 'the JSON-only contract is stated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Strictness: confidence floor + reason-presence rule (owner feedback 2026-11-26)
// ─────────────────────────────────────────────────────────────────────────────

describe('classify: strict verdict (threshold + reason)', () => {
  test('resolveCyberVerdict drops a low-confidence true to not-cyber', () => {
    const parsed = parseClassificationEntry({
      index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false,
      cybersecurityReason: 'ransomware on a hospital', confidence: 0.5,
    });
    const verdict = resolveCyberVerdict(parsed);
    assert.equal(verdict.isCybersecurity, false, 'below the 0.7 floor → not cyber');
    assert.equal(verdict.cyberRegion, null, 'and the region is cleared');
    assert.equal(verdict.isThreatIntel, false);
  });

  test('resolveCyberVerdict keeps a confident true with a reason and its region', () => {
    const parsed = parseClassificationEntry({
      index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: true,
      cybersecurityReason: 'NCC advisory on SIM-swap fraud', confidence: 0.9,
    });
    const verdict = resolveCyberVerdict(parsed);
    assert.equal(verdict.isCybersecurity, true);
    assert.equal(verdict.cyberRegion, 'NG');
    assert.equal(verdict.isThreatIntel, true);
  });

  test('resolveCyberVerdict treats a reason-less true as not-cyber', () => {
    const parsed = parseClassificationEntry({
      index: 1, isCybersecurity: true, cyberRegion: 'GLOBAL', isThreatIntel: true, confidence: 0.99,
    });
    assert.equal(parsed.cybersecurityReason, null, 'no reason parsed');
    const verdict = resolveCyberVerdict(parsed);
    assert.equal(verdict.isCybersecurity, false, 'a true without a grounded reason is dropped');
    assert.equal(verdict.cyberRegion, null);
  });

  test('the confidence floor constant is 0.7', () => {
    assert.equal(CLASSIFY_MIN_CONFIDENCE, 0.7);
    // Exactly at the floor is kept.
    const at = resolveCyberVerdict(parseClassificationEntry({
      index: 1, isCybersecurity: true, cyberRegion: 'AF', isThreatIntel: false,
      cybersecurityReason: 'breach in a Kenyan bank', confidence: 0.7,
    }));
    assert.equal(at.isCybersecurity, true, 'a true at exactly 0.7 is kept');
  });

  test('a general-tech story returning false is stored false/null', async () => {
    const store = makeStore([event({ id: 'e1', title: 'Startup raises Series B to scale its app' })]);
    const llm = stubLlm({
      classifications: [{
        index: 1, isCybersecurity: false, cyberRegion: null, isThreatIntel: false,
        cybersecurityReason: 'funding round, no security substance', confidence: 0.9,
      }],
    });
    await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(store.rows[0].isCybersecurity, false);
    assert.equal(store.rows[0].cyberRegion, null);
    assert.equal(store.rows[0].isThreatIntel, false);
  });

  test('a true + confidence 0.5 is stored FALSE (threshold)', async () => {
    const store = makeStore([event({ id: 'e1' })]);
    const llm = stubLlm({
      classifications: [{
        index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: false,
        cybersecurityReason: 'maybe about security', confidence: 0.5,
      }],
    });
    await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(store.rows[0].isCybersecurity, false);
    assert.equal(store.rows[0].cyberRegion, null);
  });

  test('a true + confidence 0.9 is stored true with its region', async () => {
    const store = makeStore([event({ id: 'e1' })]);
    const llm = stubLlm({
      classifications: [{
        index: 1, isCybersecurity: true, cyberRegion: 'GLOBAL', isThreatIntel: true,
        cybersecurityReason: 'profiles a named ransomware group', confidence: 0.9,
      }],
    });
    await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(store.rows[0].isCybersecurity, true);
    assert.equal(store.rows[0].cyberRegion, 'GLOBAL');
    assert.equal(store.rows[0].isThreatIntel, true);
  });

  test('a true with no reason is stored FALSE (reason-presence rule)', async () => {
    const store = makeStore([event({ id: 'e1' })]);
    const llm = stubLlm({
      classifications: [{
        index: 1, isCybersecurity: true, cyberRegion: 'NG', isThreatIntel: true, confidence: 0.95,
      }],
    });
    await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(store.rows[0].isCybersecurity, false);
    assert.equal(store.rows[0].cyberRegion, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearClassifications (--reclassify)
// ─────────────────────────────────────────────────────────────────────────────

describe('classify: clearClassifications', () => {
  test('clears the three flags on every classified row and reports the count', async () => {
    const store = makeStore([
      event({ id: 'cyber', isCybersecurity: true, isThreatIntel: true, cyberRegion: 'NG' }),
      event({ id: 'not-cyber', isCybersecurity: false, isThreatIntel: false, cyberRegion: null }),
      event({ id: 'never', isCybersecurity: null, isThreatIntel: null, cyberRegion: null }),
    ]);
    const cleared = await withPrisma(store, () => clearClassifications());
    // 'cyber' and 'not-cyber' carry a non-null flag; 'never' already has all null.
    assert.equal(cleared, 2);
    const byId = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    assert.equal(byId.cyber.isCybersecurity, null);
    assert.equal(byId.cyber.cyberRegion, null);
    assert.equal(byId.cyber.isThreatIntel, null);
    assert.equal(byId['not-cyber'].isCybersecurity, null, 'a previously-false row is reset too');
  });

  test('respects a limit', async () => {
    const store = makeStore([
      event({ id: 'a', isCybersecurity: true, isThreatIntel: false, cyberRegion: 'NG' }),
      event({ id: 'b', isCybersecurity: true, isThreatIntel: false, cyberRegion: 'AF' }),
      event({ id: 'c', isCybersecurity: true, isThreatIntel: false, cyberRegion: 'GLOBAL' }),
    ]);
    const cleared = await withPrisma(store, () => clearClassifications({ limit: 2 }));
    assert.equal(cleared, 2);
  });

  test('after clearing, the rows become unclassified and re-selectable', async () => {
    const store = makeStore([
      event({ id: 'e1', isCybersecurity: true, isThreatIntel: false, cyberRegion: 'NG' }),
    ]);
    // Before clearing the row is fully classified → not selected.
    const before = await withPrisma(store, () => findUnclassified());
    assert.equal(before.length, 0);
    await withPrisma(store, () => clearClassifications());
    // After clearing it is unclassified again.
    const after = await withPrisma(store, () => findUnclassified());
    assert.deepEqual(after.map((e) => e.id), ['e1']);
  });
});
