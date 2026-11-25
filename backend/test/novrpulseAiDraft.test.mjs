import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import config from '../src/config/env.js';
import {
  rewriteEventToDraft,
  recommendEvents,
  assessOverlap,
  overlapTokens,
  RECOMMEND_PROMPT_VERSION,
  REWRITE_PROMPT_VERSION,
} from '../src/services/novrpulse/aiDraft.js';
import { getPulseEvent, SOURCE_BODY_MAX_CHARS } from '../src/controllers/pulseController.js';
import { pillarSlots, pillarPurpose, isRewritePillar } from '../src/services/novrpulse/pillarShapes.js';

// Tests for the NovrPulse AI editorial layer: rewrite + recommend.
//
// The LLM is STUBBED everywhere (no network). The service is driven against an
// in-memory fake shadowing the shared Prisma singleton's delegates (the pattern
// used by novrpulseDedup.test.mjs / novrpulseEditorialCanvas.test.mjs).

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stand-ins
// ─────────────────────────────────────────────────────────────────────────────

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
  const judgements = (seed.judgements ?? []).map((j) => ({ ...j }));
  let itemSeq = 0;
  let ajSeq = 0;

  function eq(row, where = {}) {
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('not' in v) return row[k] !== v.not;
        if ('in' in v) return v.in.includes(row[k]);
        if ('gte' in v) return row[k] instanceof Date && row[k].getTime() >= new Date(v.gte).getTime();
      }
      return row[k] === v;
    });
  }

  const npEvent = {
    async findUnique({ where }) {
      return events.find((e) => e.id === where.id) ?? null;
    },
    async findMany({ where = {}, orderBy, take } = {}) {
      let rows = events.filter((e) => eq(e, where));
      if (orderBy?.publishedAt === 'desc') {
        rows = [...rows].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
      }
      if (typeof take === 'number') rows = rows.slice(0, take);
      return rows.map((e) => ({
        id: e.id,
        title: e.title,
        summary: e.summary ?? '',
        publishedAt: e.publishedAt ?? null,
        publishItems: (e.publishItems ?? []).filter(
          (p) => (p.withdrawnAt === null || p.withdrawnAt === undefined)
            && (p.publishedAt === null || p.publishedAt === undefined)
            && (p.rejectedAt === null || p.rejectedAt === undefined),
        ),
        sources: e.sources ?? [],
      }));
    },
  };

  const publishItem = {
    async create({ data }) {
      itemSeq += 1;
      const row = { id: `pi-${itemSeq}`, createdAt: new Date(), approvedAt: null, rejectedAt: null, publishedAt: null, withdrawnAt: null, ...data };
      items.push(row);
      return { ...row };
    },
    async findFirst({ where } = {}) {
      return items.find((row) => eq(row, where)) ?? null;
    },
  };

  const publishItemEvent = {
    async create({ data }) {
      pivot.push({ ...data });
      return { ...data };
    },
  };

  const aiJudgement = {
    async create({ data }) {
      ajSeq += 1;
      const row = {
        id: `aj-${ajSeq}`,
        createdAt: new Date(),
        reviewedAt: null,
        reason: null,
        reviewerId: null,
        confidence: null,
        rationale: null,
        detail: null,
        outcome: 'pending',
        ...data,
      };
      judgements.push(row);
      return { ...row };
    },
  };

  const store = { events, items, pivot, judgements, npEvent, publishItem, publishItemEvent, aiJudgement };
  store.$transaction = async (arg) => (typeof arg === 'function' ? arg(store) : Promise.all(arg));
  return store;
}

const DELEGATES = ['npEvent', 'publishItem', 'publishItemEvent', 'aiJudgement', '$transaction'];

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

/** An LLM stub returning a fixed result; records the requests it received. */
function stubLlm(result, model = 'stub-frontier') {
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

const SOURCE_BODY =
  'The Nigerian Communications Commission issued a new advisory this week. ' +
  'The commission said telecom operators must warn subscribers about rising SIM-swap fraud. ' +
  'Operators have thirty days to publish the warning to their customers across the country.';

function event(over = {}) {
  return {
    id: 'evt-1',
    title: 'NCC issues SIM-swap advisory to telecom operators',
    summary: 'The NCC told operators to warn subscribers about SIM-swap fraud.',
    publishedAt: new Date(),
    sources: [
      {
        rawDocument: {
          body: SOURCE_BODY,
          url: 'https://ncc.example/a',
          source: { name: 'NCC' },
        },
      },
    ],
    publishItems: [],
    entities: [],
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// pillarShapes contracts
// ─────────────────────────────────────────────────────────────────────────────

describe('pillarShapes — contracts', () => {
  test('prose pillars expose ordered slot labels; field-form pillars do not', () => {
    assert.deepEqual(pillarSlots(7), ['What happened', 'Who is affected', 'Where', 'Source']);
    assert.deepEqual(pillarSlots(8), ['Summary', 'Impact', 'Affected', 'Mitigation', 'Why it matters', 'Source']);
    assert.equal(pillarSlots(5).length, 0, 'fn5 is a field form');
    assert.equal(pillarSlots(6).length, 0, 'fn6 is a field form');
  });

  test('isRewritePillar is false for the field-form pillars only', () => {
    assert.equal(isRewritePillar(5), false);
    assert.equal(isRewritePillar(6), false);
    for (const fn of [1, 2, 3, 4, 7, 8]) assert.equal(isRewritePillar(fn), true, `fn${fn}`);
  });

  test('every section has a purpose', () => {
    for (const fn of [1, 2, 3, 4, 5, 6, 7, 8]) {
      assert.equal(typeof pillarPurpose(fn), 'string');
      assert.ok(pillarPurpose(fn).length > 0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Overlap guard (pure)
// ─────────────────────────────────────────────────────────────────────────────

describe('aiDraft — overlap guard', () => {
  test('overlapTokens lowercases and strips punctuation', () => {
    assert.deepEqual(overlapTokens('The NCC, the NCC — advisories!'), ['the', 'ncc', 'the', 'ncc', 'advisories']);
  });

  test('an original draft with no 8-word run is not refused', () => {
    const res = assessOverlap('Operators were told to alert customers about fraud.', SOURCE_BODY);
    assert.equal(res.refused, false);
    assert.equal(res.maxRun < 8, true);
  });

  test('an 8-word verbatim run from the source is refused', () => {
    const stolen = 'The commission said telecom operators must warn subscribers about rising SIM-swap fraud and act now.';
    const res = assessOverlap(stolen, SOURCE_BODY);
    assert.equal(res.refused, true);
    assert.equal(res.maxRun >= 8, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rewrite — happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('aiDraft — rewrite', () => {
  test('creates a draft with a composed body, records a judgement, uses ai@1.0.0', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm({
      headline: 'Regulator orders operators to warn users on SIM-swap fraud',
      slots: {
        Summary: 'Operators must alert customers about rising SIM-swap fraud.',
        Impact: 'Subscribers face a growing identity-theft risk.',
        Affected: 'Telecom subscribers across Nigeria.',
        Mitigation: 'Enable SIM locks and verify unexpected requests.',
        'Why it matters': 'SIM-swap fraud is a fast-growing threat.',
        Source: 'According to NCC.',
      },
      summary: 'attributed to the regulator, original wording',
    });

    const out = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'editor-1', llm }),
    );

    assert.equal(out.existed, false);
    assert.equal(store.items.length, 1);
    const created = store.items[0];
    assert.equal(created.eventId, 'evt-1');
    assert.equal(created.functionId, 8);
    assert.equal(created.contentType, 'briefing');
    assert.equal(created.tier, 'public');
    assert.equal(created.templateVersion, 'ai@1.0.0');
    assert.equal(created.editorId, 'editor-1');
    assert.equal(created.approvedAt, null);

    // Composed body: headline then UPPER_LABEL blocks in pillar order.
    assert.ok(created.body.startsWith('Regulator orders operators to warn users on SIM-swap fraud\n\n'));
    assert.ok(created.body.includes('SUMMARY\nOperators must alert customers'));
    assert.ok(created.body.includes('WHY IT MATTERS\nSIM-swap fraud is a fast-growing threat.'));
    assert.ok(created.body.includes('SOURCE\nAccording to NCC.'));

    // Pivot link written.
    assert.equal(store.pivot.length, 1);
    assert.equal(store.pivot[0].publishItemId, created.id);
    assert.equal(store.pivot[0].eventId, 'evt-1');
    assert.equal(store.pivot[0].position, 0);

    // Judgement recorded.
    assert.equal(store.judgements.length, 1);
    const j = store.judgements[0];
    assert.equal(j.kind, 'rewrite');
    assert.equal(j.eventId, 'evt-1');
    assert.equal(j.publishItemId, created.id);
    assert.equal(j.subjectKey, 'rewrite:evt-1|8');
    assert.equal(j.decision, 'drafted');
    assert.equal(j.promptVersion, REWRITE_PROMPT_VERSION);
    assert.equal(j.outcome, 'pending');
    // The scenario carries only a bounded source EXCERPT, never the full body.
    assert.ok(j.scenario.sourceExcerpt.length <= 500);
    assert.equal(j.scenario.sourceExcerpt, SOURCE_BODY.slice(0, 500));

    // The frontier tier was requested (quality), with the pillar slots in-prompt.
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].tier, 'frontier');
    assert.ok(llm.calls[0].system.includes('Mitigation'));
    assert.ok(llm.calls[0].system.includes('UNTRUSTED'));
    assert.equal(out.judgementId, j.id);
  });

  test('the rewrite scenario carries only a bounded excerpt, never the full body (copyright)', async () => {
    const longBody = `${SOURCE_BODY} ${'Additional publisher text that is definitely not ours. '.repeat(30)}`;
    const store = makeStore({ events: [event({ sources: [{ rawDocument: { body: longBody, url: 'u', source: { name: 'NCC' } } }] })] });
    const llm = stubLlm({
      headline: 'Operators told to warn users about fraud',
      slots: { Summary: 'S', Impact: 'I', Affected: 'A', Mitigation: 'M', 'Why it matters': 'W', Source: 'NCC.' },
    });
    await withPrisma(store, () => rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm }));
    const scenario = store.judgements[0].scenario;
    assert.ok(scenario.sourceExcerpt.length <= 500);
    assert.equal(JSON.stringify(scenario).includes(longBody), false, 'the full body must never be stored');
  });

  test('a repeat rewrite for the same (event, function) reuses the live draft (idempotent)', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm({ headline: 'H', slots: { Summary: 'S', Impact: 'I', Affected: 'A', Mitigation: 'M', 'Why it matters': 'W', Source: 'Source' } });

    const first = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm }),
    );
    const second = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm }),
    );

    assert.equal(first.existed, false);
    assert.equal(second.existed, true);
    assert.equal(second.item.id, first.item.id);
    assert.equal(store.items.length, 1, 'no duplicate item');
    assert.equal(llm.calls.length, 1, 'the second call short-circuits before the LLM');
  });

  test('a field-form pillar is refused with AI_DRAFT_NOT_AVAILABLE and writes nothing', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm({ headline: 'x', slots: {} });
    for (const functionId of [5, 6]) {
      await assert.rejects(
        withPrisma(store, () => rewriteEventToDraft({ eventId: 'evt-1', functionId, editorId: 'e', llm })),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'AI_DRAFT_NOT_AVAILABLE');
          return true;
        },
      );
    }
    assert.equal(store.items.length, 0);
    assert.equal(llm.calls.length, 0);
  });

  test('an unknown event is a 404', async () => {
    const store = makeStore({ events: [] });
    const llm = stubLlm({ headline: 'x', slots: {} });
    await assert.rejects(
      withPrisma(store, () => rewriteEventToDraft({ eventId: 'ghost', functionId: 8, editorId: 'e', llm })),
      (err) => {
        assert.equal(err.statusCode, 404);
        return true;
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rewrite — guards
// ─────────────────────────────────────────────────────────────────────────────

describe('aiDraft — rewrite guards', () => {
  test('an output reproducing a source run is refused (422) with a refused judgement, no item', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm({
      headline: 'The commission said telecom operators must warn subscribers about rising SIM-swap fraud',
      slots: { Summary: 'S', Impact: 'I', Affected: 'A', Mitigation: 'M', 'Why it matters': 'W', Source: 'Src' },
    });

    await assert.rejects(
      withPrisma(store, () => rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm })),
      (err) => {
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, 'DRAFT_TOO_CLOSE_TO_SOURCE');
        return true;
      },
    );

    assert.equal(store.items.length, 0, 'no item may be created');
    assert.equal(store.pivot.length, 0);
    assert.equal(store.judgements.length, 1, 'a refused judgement is recorded');
    const j = store.judgements[0];
    assert.equal(j.kind, 'rewrite');
    assert.equal(j.decision, 'refused_overlap');
    assert.equal(j.publishItemId, null);
    assert.ok(j.detail.overlapMaxRun >= 8);
  });

  test('fn7 public output naming an individual is refused (422), no item', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm({
      headline: 'EFCC arrests Chinedu Okafor over fintech fraud',
      slots: { 'What happened': 'The EFCC arrested Chinedu Okafor.', 'Who is affected': 'Customers.', Where: 'Lagos.', Source: 'EFCC.' },
    });

    await assert.rejects(
      withPrisma(store, () => rewriteEventToDraft({ eventId: 'evt-1', functionId: 7, editorId: 'e', llm })),
      (err) => {
        assert.equal(err.statusCode, 422);
        assert.equal(err.code, 'named_individual_in_public_arrest');
        return true;
      },
    );

    assert.equal(store.items.length, 0, 'no item may be created when it names an individual');
    assert.equal(store.judgements.length, 0, 'the defamation refusal does not create a rewrite judgement');
  });

  test('fn7 output with no person-like token is allowed', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm({
      headline: 'Commission said telecom operators warn customers over fraud',
      slots: { 'What happened': 'The commission said operators warn customers.', 'Who is affected': 'Telecom users.', Where: 'Nigeria.', Source: 'NCC.' },
    });
    const out = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 7, editorId: 'e', llm }),
    );
    assert.equal(out.existed, false);
    assert.equal(store.items.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unconfigured — a clear 503 from both entry points
// ─────────────────────────────────────────────────────────────────────────────

describe('aiDraft — AI_NOT_CONFIGURED', () => {
  /** Run `fn` with the LLM api key temporarily blanked, restoring it after. */
  async function withoutKey(fn) {
    const saved = config.novrpulse.llm.apiKey;
    config.novrpulse.llm.apiKey = '';
    try {
      return await fn();
    } finally {
      config.novrpulse.llm.apiKey = saved;
    }
  }

  test('rewrite throws 503 AI_NOT_CONFIGURED when no provider is configured', async () => {
    const store = makeStore({ events: [event()] });
    await withoutKey(async () => {
      await assert.rejects(
        withPrisma(store, () => rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e' })),
        (err) => {
          assert.equal(err.statusCode, 503);
          assert.equal(err.code, 'AI_NOT_CONFIGURED');
          return true;
        },
      );
    });
    assert.equal(store.items.length, 0);
  });

  test('recommend throws 503 AI_NOT_CONFIGURED when no provider is configured', async () => {
    const store = makeStore({ events: [event()] });
    await withoutKey(async () => {
      await assert.rejects(
        withPrisma(store, () => recommendEvents({ functionIds: [7] })),
        (err) => {
          assert.equal(err.statusCode, 503);
          assert.equal(err.code, 'AI_NOT_CONFIGURED');
          return true;
        },
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recommend
// ─────────────────────────────────────────────────────────────────────────────
describe('aiDraft — recommend', () => {
  test('records a recommendation judgement per pick with the right kind/subjectKey', async () => {
    const store = makeStore({
      events: [
        event({ id: 'e1', title: 'NCC issues SIM-swap advisory' }),
        event({ id: 'e2', title: 'Bank suffers data breach' }),
      ],
    });
    const llm = stubLlm({ picks: [{ index: 1, reason: 'regulator notice fits', confidence: 0.8 }] });

    const out = await withPrisma(store, () => recommendEvents({ functionIds: [7], limit: 2, llm }));

    assert.equal(out.recommendations.length, 1);
    assert.equal(out.recommendations[0].functionId, 7);
    assert.equal(out.recommendations[0].judgements.length, 1);
    assert.equal(store.judgements.length, 1);
    const j = store.judgements[0];
    assert.equal(j.kind, 'recommend');
    assert.equal(j.eventId, 'e1');
    assert.equal(j.subjectKey, 'recommend:7:e1');
    assert.equal(j.decision, 'recommended');
    assert.equal(j.confidence, 0.8);
    assert.equal(j.rationale, 'regulator notice fits');
    assert.equal(j.promptVersion, RECOMMEND_PROMPT_VERSION);
    assert.equal(llm.calls[0].tier, 'bulk', 'recommend uses the bulk tier');
  });

  test('events that already have a live publish item are excluded from candidates', async () => {
    const store = makeStore({
      events: [
        event({ id: 'e1', title: 'Already drafted', publishItems: [{ id: 'pi-x', withdrawnAt: null, publishedAt: null, rejectedAt: null }] }),
        event({ id: 'e2', title: 'Fresh candidate', publishItems: [] }),
      ],
    });
    const llm = stubLlm({ picks: [{ index: 1, reason: 'fits', confidence: 0.5 }] });

    await withPrisma(store, () => recommendEvents({ functionIds: [7], limit: 2, llm }));

    // The candidate list handed to the model must contain only the fresh event.
    assert.ok(llm.calls[0].prompt.includes('Fresh candidate'));
    assert.equal(llm.calls[0].prompt.includes('Already drafted'), false);
  });

  test('empty candidates → empty recommendations, no LLM call', async () => {
    const store = makeStore({ events: [] });
    const llm = stubLlm({ picks: [] });
    const out = await withPrisma(store, () => recommendEvents({ functionIds: [1, 4, 7, 8], limit: 2, llm }));
    assert.equal(out.recommendations.length, 4);
    assert.ok(out.recommendations.every((r) => r.judgements.length === 0));
    assert.equal(llm.calls.length, 0);
  });

  test('an out-of-range pick index is ignored safely', async () => {
    const store = makeStore({ events: [event({ id: 'e1' })] });
    const llm = stubLlm({ picks: [{ index: 99, reason: 'bad', confidence: 0.1 }] });
    const out = await withPrisma(store, () => recommendEvents({ functionIds: [7], limit: 2, llm }));
    assert.equal(out.recommendations[0].judgements.length, 0);
    assert.equal(store.judgements.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Event detail — sourceBody + truncation flag; card DTO stays body-free
// ─────────────────────────────────────────────────────────────────────────────

describe('pulse detail — sourceBody', () => {
  test('the detail includes the full source body, the card does not', async () => {
    const store = makeStore({ events: [event()] });
    const res = { statusCode: 200, payload: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.payload = b; return this; } };
    await withPrisma(store, () => getPulseEvent({ params: { id: 'evt-1' } }, res));
    assert.equal(res.payload.event.sourceBody, SOURCE_BODY);
    assert.equal(res.payload.event.sourceTruncated, false);
  });

  test('a long source body is capped and flagged truncated', async () => {
    const long = 'x'.repeat(SOURCE_BODY_MAX_CHARS + 500);
    const store = makeStore({ events: [event({ sources: [{ rawDocument: { body: long, url: 'u', source: { name: 'NCC' } } }] })] });
    const res = { statusCode: 200, payload: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.payload = b; return this; } };
    await withPrisma(store, () => getPulseEvent({ params: { id: 'evt-1' } }, res));
    assert.equal(res.payload.event.sourceBody.length, SOURCE_BODY_MAX_CHARS);
    assert.equal(res.payload.event.sourceTruncated, true);
  });
});
