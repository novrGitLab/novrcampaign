import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import config from '../src/config/env.js';
import {
  classifyEvents,
  findUnclassified,
  buildClassifySystem,
  buildClassifyPrompt,
  CLASSIFY_SCHEMA,
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
        // OR: ANY flag IS NULL.
        return ors.some((clause) => {
          const [key] = Object.keys(clause);
          return r[key] === null || r[key] === undefined;
        });
      });
      out = [...out].sort((a, b) => {
        const ap = a.publishedAt ? new Date(a.publishedAt).getTime() : -Infinity;
        const bp = b.publishedAt ? new Date(b.publishedAt).getTime() : -Infinity;
        return bp - ap;
      });
      if (typeof args.take === 'number') out = out.slice(0, args.take);
      // Shape the select: title/summary + first source chain.
      return out.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary ?? '',
        sources: (r.sources ?? []).slice(0, 1),
      }));
    },
    async update({ where, data }) {
      calls.update.push({ where, data });
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`npEvent.update: no row ${where.id}`);
      Object.assign(row, data);
      return { ...row };
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
  test('findUnclassified selects events with ANY flag NULL and skips fully-classified ones', async () => {
    const store = makeStore([
      event({ id: 'null', isCybersecurity: null }),
      event({ id: 'all-set', isCybersecurity: true, isThreatIntel: false, isNigeriaRelated: true }),
      event({ id: 'partial', isCybersecurity: true, isThreatIntel: null, isNigeriaRelated: false }),
    ]);

    const pending = await withPrisma(store, () => findUnclassified());
    assert.deepEqual(pending.map((e) => e.id).sort(), ['null', 'partial']);
    // The selector is the OR-of-IS-NULL on the three flags.
    const where = store.calls.findMany.at(-1).where;
    assert.equal(where.OR.length, 3);
  });

  test('the capability ceiling is applied via `take`', async () => {
    const store = makeStore([event({ id: 'a' }), event({ id: 'b' }), event({ id: 'c' })]);
    await withPrisma(store, () => findUnclassified({ limit: 2 }));
    assert.equal(store.calls.findMany.at(-1).take, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyEvents
// ─────────────────────────────────────────────────────────────────────────────

describe('classify: classifyEvents', () => {
  test('a stubbed batch writes all three flags per the model judgment', async () => {
    const store = makeStore([
      event({ id: 'e1' }),
      event({ id: 'e2' }),
    ]);
    const llm = stubLlm({
      classifications: [
        { index: 1, isCybersecurity: true, isThreatIntel: false, isNigeriaRelated: true, confidence: 0.9 },
        { index: 2, isCybersecurity: false, isThreatIntel: true, isNigeriaRelated: false, confidence: 0.8 },
      ],
    });

    const result = await withApiKey(() =>
      withPrisma(store, () => classifyEvents({ llm })),
    );

    assert.equal(result.candidates, 2);
    assert.equal(result.classified, 2);
    assert.equal(result.batches, 1);
    assert.equal(llm.calls.length, 1, 'one bulk call per batch');
    assert.equal(llm.calls[0].tier, 'bulk');
    assert.deepEqual(llm.calls[0].schema, CLASSIFY_SCHEMA);

    const byId = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    assert.deepEqual(
      [byId.e1.isCybersecurity, byId.e1.isThreatIntel, byId.e1.isNigeriaRelated],
      [true, false, true],
    );
    assert.deepEqual(
      [byId.e2.isCybersecurity, byId.e2.isThreatIntel, byId.e2.isNigeriaRelated],
      [false, true, false],
    );
  });

  test('the AI pass OVERWRITES a keyword pre-tag true (documented rule)', async () => {
    const store = makeStore([event({ id: 'e1', isCybersecurity: true, isThreatIntel: false, isNigeriaRelated: null })]);
    const llm = stubLlm({
      classifications: [{ index: 1, isCybersecurity: false, isThreatIntel: false, isNigeriaRelated: false }],
    });
    await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(store.rows[0].isCybersecurity, false, 'AI verdict is authoritative');
  });

  test('malformed entries (missing index / non-boolean flags) are skipped', async () => {
    const store = makeStore([event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' })]);
    const llm = stubLlm({
      classifications: [
        { index: 1, isCybersecurity: true, isThreatIntel: false, isNigeriaRelated: true },
        { index: 99, isCybersecurity: true, isThreatIntel: false, isNigeriaRelated: true }, // out of range
        { index: 3, isCybersecurity: 'yes', isThreatIntel: false, isNigeriaRelated: true }, // bad type
        { isCybersecurity: true, isThreatIntel: false, isNigeriaRelated: true }, // no index
      ],
    });

    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));
    assert.equal(result.classified, 1, 'only the valid entry is written');
    assert.equal(result.skipped, 3);
    // e2 and e3 stay unclassified (NULL) — never written with junk.
    const byId = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    assert.equal(byId.e2.isCybersecurity, null);
    assert.equal(byId.e3.isCybersecurity, null);
    assert.equal(store.calls.update.length, 1);
  });

  test('a mixed valid/invalid batch applies the valid entries and skips the invalid ones', async () => {
    const store = makeStore([event({ id: 'e1' }), event({ id: 'e2' }), event({ id: 'e3' })]);
    // The live failure shape: some entries are NOT objects (bare strings/numbers/
    // null) — the permissive schema lets them through, and the service must apply
    // the good entries and skip the rest instead of losing the whole batch.
    const llm = stubLlm({
      classifications: [
        { index: 1, isCybersecurity: true, isThreatIntel: false, isNigeriaRelated: true },
        'not-an-object',
        { index: 3, isCybersecurity: false, isThreatIntel: true, isNigeriaRelated: false },
      ],
    });

    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));

    assert.equal(result.classified, 2, 'the two valid entries are written');
    assert.equal(result.skipped, 1, 'the one invalid entry is skipped');
    const byId = Object.fromEntries(store.rows.map((r) => [r.id, r]));
    assert.deepEqual(
      [byId.e1.isCybersecurity, byId.e1.isThreatIntel, byId.e1.isNigeriaRelated],
      [true, false, true],
    );
    assert.equal(byId.e2.isCybersecurity, null, 'the invalid entry leaves its event unclassified');
    assert.deepEqual(
      [byId.e3.isCybersecurity, byId.e3.isThreatIntel, byId.e3.isNigeriaRelated],
      [false, true, false],
    );
  });

  test('an all-invalid batch does not crash: zero applied, run continues', async () => {
    const store = makeStore([event({ id: 'e1' }), event({ id: 'e2' })]);
    // Every entry is malformed (the exact live schema-rejection shape).
    const llm = stubLlm({ classifications: ['x', 42, null, { index: 'nope' }] });

    const result = await withApiKey(() => withPrisma(store, () => classifyEvents({ llm })));

    assert.equal(result.classified, 0);
    assert.equal(result.skipped, 4);
    assert.equal(result.candidates, 2);
    assert.equal(store.calls.update.length, 0, 'no writes when nothing is valid');
    assert.equal(store.rows[0].isCybersecurity, null, 'events stay unclassified');
    assert.equal(store.rows[1].isCybersecurity, null);
  });

  test('the call schema is the permissive envelope (raw array accepted)', async () => {
    const store = makeStore([event({ id: 'e1' })]);
    const llm = stubLlm({ classifications: [{ index: 1, isCybersecurity: true, isThreatIntel: true, isNigeriaRelated: true }] });
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
          index: i + 1, isCybersecurity: false, isThreatIntel: false, isNigeriaRelated: false,
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

  test('no candidates → no LLM call, zero counts', async () => {
    const store = makeStore([event({ id: 'done', isCybersecurity: true, isThreatIntel: true, isNigeriaRelated: true })]);
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

describe('classify: prompt contract', () => {
  test('the system prompt defines the three flags and the untrusted-data rule', () => {
    const system = buildClassifySystem();
    assert.ok(system.includes('isCybersecurity'));
    assert.ok(system.includes('isThreatIntel'));
    assert.ok(system.includes('isNigeriaRelated'));
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
});
