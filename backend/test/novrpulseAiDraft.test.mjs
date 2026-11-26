import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import config from '../src/config/env.js';
import {
  rewriteEventToDraft,
  recommendEvents,
  assessOverlap,
  overlapTokens,
  buildRewriteSystem,
  regionFramingLine,
  buildRecommendPrompt,
  buildRecommendSystem,
  orderPicksNigeriaFirst,
  RECOMMEND_PROMPT_VERSION,
  REWRITE_PROMPT_VERSION,
} from '../src/services/novrpulse/aiDraft.js';
import { getPulseEvent, SOURCE_BODY_MAX_CHARS } from '../src/controllers/pulseController.js';
import { pillarSlots, pillarPurpose, pillarDepthNote, isRewritePillar } from '../src/services/novrpulse/pillarShapes.js';

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
        cyberRegion: e.cyberRegion ?? null,
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
      const row = { id: `pi-${itemSeq}`, createdAt: new Date(), updatedAt: new Date(), approvedAt: null, rejectedAt: null, publishedAt: null, withdrawnAt: null, ...data };
      items.push(row);
      return { ...row };
    },
    async findFirst({ where } = {}) {
      return items.find((row) => eq(row, where)) ?? null;
    },
    async update({ where, data }) {
      const row = items.find((r) => r.id === where.id);
      if (!row) throw new Error(`publishItem.update: no row ${where.id}`);
      // Prisma maintains `updatedAt` (@updatedAt) on every write.
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
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
    // Cyber by default — the recommender now draws only from
    // cybersecurity-classified events (owner feedback 2026-11-26).
    isCybersecurity: true,
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

  test('field-form pillars carry no depth note; prose pillars do', () => {
    assert.equal(pillarDepthNote(5), null, 'fn5 is a field form');
    assert.equal(pillarDepthNote(6), null, 'fn6 is a field form');
    for (const fn of [1, 2, 3, 4, 7, 8]) {
      assert.equal(typeof pillarDepthNote(fn), 'string', `fn${fn}`);
      assert.ok(pillarDepthNote(fn).length > 0, `fn${fn}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rewrite prompt DEPTH (owner requirement: drafts must be substantially richer)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRewriteSystem — depth requirements', () => {
  test('fn 8 (deep-dive lead) requires 4–6 sentence Summary and 3–5 sentence slots', () => {
    const system = buildRewriteSystem(8);
    assert.ok(system.includes('Summary as 4\u20136 full sentences'), 'Summary depth instruction present');
    assert.ok(system.includes('3\u20135 full sentences'), 'assessment depth instruction present');
    assert.ok(system.includes('DEEP-DIVE LEAD'), 'named as the deep-dive lead');
    assert.ok(system.includes('ENTIRE source article'), 'tells the model to use the full source');
    assert.ok(system.includes('never one-liners') || system.includes('never return a one-liner'),
      'forbids one-liners for the lead');
  });

  test('fn 4 (case study) requires 2–4 sentences per slot', () => {
    const system = buildRewriteSystem(4);
    assert.ok(system.includes('2\u20134 full sentences'));
    assert.ok(system.includes('case study') || system.includes('Case Study'));
  });

  test('fn 7 (news roll) instructs SHORT — do not pad', () => {
    const system = buildRewriteSystem(7);
    assert.ok(system.includes('SHORT IS CORRECT'));
    assert.ok(system.includes('do NOT pad'));
  });

  test('fn 1/2/3 require 2–4 sentences per slot', () => {
    for (const fn of [1, 2, 3]) {
      const system = buildRewriteSystem(fn);
      assert.ok(system.includes('2\u20134 full sentences'), `fn${fn} depth`);
    }
  });

  test('buildRewriteSystem stays backwards-compatible with no opts', () => {
    // Existing callers pass only the functionId; the depth note defaults in.
    const system = buildRewriteSystem(8);
    assert.ok(system.includes('Fill EXACTLY these slots'));
    assert.ok(system.includes('UNTRUSTED'));
    assert.ok(system.includes('Mitigation'));
  });

  test('an explicit opts.depthNote overrides the pillar default (tuning hook)', () => {
    const system = buildRewriteSystem(8, { depthNote: 'CUSTOM_DEPTH_MARKER' });
    assert.ok(system.includes('CUSTOM_DEPTH_MARKER'));
  });

  test('the rewrite requests a larger maxTokens budget than the client default', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm({ headline: 'H', slots: { Summary: 'S' } });
    await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm }),
    );
    assert.equal(typeof llm.calls[0].maxTokens, 'number');
    assert.ok(llm.calls[0].maxTokens > 1024, 'rewrite asks for more than the terse default');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rewrite — region framing (owner feedback 2026-11-26)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRewriteSystem — region framing', () => {
  test('NG framing names Nigerian institutions and forbids inventing facts', () => {
    const system = buildRewriteSystem(7, { cyberRegion: 'NG' });
    assert.ok(/classified NIGERIA cybersecurity news/i.test(system));
    assert.ok(system.includes('Nigerian professional audience'));
    assert.ok(system.includes('NCC'));
    assert.ok(system.includes('NDPC'));
    assert.ok(system.includes('NITDA'));
    assert.ok(system.includes('ngCERT'));
    assert.ok(/do NOT invent Nigerian facts/i.test(system));
  });

  test('AF framing gives African context', () => {
    const system = buildRewriteSystem(7, { cyberRegion: 'AF' });
    assert.ok(/classified AFRICAN cybersecurity news/i.test(system));
    assert.ok(system.includes('African professional audience'));
    assert.ok(/do NOT invent/i.test(system));
  });

  test('GLOBAL framing stays global with no forced localisation', () => {
    const system = buildRewriteSystem(7, { cyberRegion: 'GLOBAL' });
    assert.ok(/classified GLOBAL cybersecurity news/i.test(system));
    assert.ok(/do not force a local/i.test(system));
  });

  test('null / absent region keeps the framing neutral', () => {
    const neutral = regionFramingLine(null);
    assert.ok(/neutral/i.test(neutral));
    assert.ok(/invent/i.test(neutral));
    // The prompt stays neutral too (default when no region is passed).
    const system = buildRewriteSystem(7);
    assert.ok(/keep the framing neutral/i.test(system));
    assert.equal(system.includes('classified NIGERIA cybersecurity news'), false);
  });

  test('an unknown region string also stays neutral', () => {
    assert.ok(/neutral/i.test(regionFramingLine('EUROPE')));
  });

  test('the rewrite flow passes the EVENT cyberRegion into the system prompt', async () => {
    const store = makeStore({ events: [event({ cyberRegion: 'NG' })] });
    const llm = stubLlm({ headline: 'H', slots: { 'What happened': 'W', 'Who is affected': 'A', Where: 'L', Source: 'S' } });
    await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 7, editorId: 'e', llm }),
    );
    assert.ok(/classified NIGERIA cybersecurity news/i.test(llm.calls[0].system),
      'the NG region framing reaches the system prompt');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recommend — NG-first ordering (owner feedback 2026-11-26)
// ─────────────────────────────────────────────────────────────────────────────

describe('aiDraft — recommend NG-first ordering', () => {
  test('the candidate block carries the REGION tag and the system prompt prefers NG', () => {
    const prompt = buildRecommendPrompt([
      { title: 'A', summary: 's', sourceName: 'S', cyberRegion: 'NG' },
      { title: 'B', summary: 's', sourceName: 'S', cyberRegion: null },
    ]);
    assert.ok(prompt.includes('REGION: NG'));
    assert.ok(prompt.includes('REGION: UNCLASSIFIED'));

    const system = buildRecommendSystem(7, 4);
    assert.ok(/PRIORITY TIER/i.test(system));
    assert.ok(/prefer the one tagged NG/i.test(system));
  });

  test('orderPicksNigeriaFirst sorts NG before AF before GLOBAL among equal scores', () => {
    const candidates = [
      { cyberRegion: 'GLOBAL' }, // index 1
      { cyberRegion: 'NG' },     // index 2
      { cyberRegion: 'AF' },     // index 3
      { cyberRegion: null },     // index 4
    ];
    const picks = [
      { index: 1, confidence: 0.8, reason: 'g' },
      { index: 2, confidence: 0.8, reason: 'ng' },
      { index: 3, confidence: 0.8, reason: 'af' },
      { index: 4, confidence: 0.8, reason: 'none' },
    ];
    const ordered = orderPicksNigeriaFirst(picks, candidates);
    assert.deepEqual(ordered.map((p) => p.reason), ['ng', 'af', 'g', 'none']);
  });

  test('a higher-confidence pick still outranks a lower-confidence NG pick', () => {
    const candidates = [{ cyberRegion: 'NG' }, { cyberRegion: 'GLOBAL' }];
    const picks = [
      { index: 1, confidence: 0.5, reason: 'ng-low' },
      { index: 2, confidence: 0.9, reason: 'global-high' },
    ];
    const ordered = orderPicksNigeriaFirst(picks, candidates);
    assert.deepEqual(ordered.map((p) => p.reason), ['global-high', 'ng-low'],
      'region only breaks a tie; confidence still dominates');
  });

  test('recommend returns NG picks before AF before GLOBAL (equal scores) in the judgements', async () => {
    const now = Date.now();
    const store = makeStore({
      events: [
        event({ id: 'e1', title: 'Global story', publishedAt: new Date(now), cyberRegion: 'GLOBAL' }),
        event({ id: 'e2', title: 'Nigeria story', publishedAt: new Date(now - 60_000), cyberRegion: 'NG' }),
        event({ id: 'e3', title: 'Africa story', publishedAt: new Date(now - 120_000), cyberRegion: 'AF' }),
      ],
    });
    // Candidates order (publishedAt desc): e1(1), e2(2), e3(3). The model picks
    // all three at the SAME confidence; the service must re-order NG → AF → GLOBAL.
    const llm = stubLlm({
      picks: [
        { index: 1, reason: 'g', confidence: 0.8 },
        { index: 2, reason: 'ng', confidence: 0.8 },
        { index: 3, reason: 'af', confidence: 0.8 },
      ],
    });
    const out = await withPrisma(store, () => recommendEvents({ functionIds: [7], limit: 3, llm }));
    const ids = out.recommendations[0].judgements.map((j) => j.eventId);
    assert.deepEqual(ids, ['e2', 'e3', 'e1'], 'NG first, then AF, then GLOBAL');
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

  test('a LONG, multi-sentence draft composes and persists without truncation', async () => {
    const store = makeStore({ events: [event()] });
    const longSlot = 'This is a full sentence describing the source in detail. '
      + 'A second sentence adds more context and the numbers involved. '
      + 'A third sentence covers the affected parties. '
      + 'A fourth sentence sets out the mitigation. '
      + 'A fifth sentence closes with the assessment.';
    const llm = stubLlm({
      headline: 'A long, deep-dive lead headline',
      slots: {
        Summary: longSlot,
        Impact: longSlot,
        Affected: longSlot,
        Mitigation: longSlot,
        'Why it matters': longSlot,
        Source: 'According to NCC.',
      },
    });

    const out = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm }),
    );

    assert.equal(store.items.length, 1, 'the draft persists');
    const body = store.items[0].body;
    assert.ok(body.includes('SUMMARY\n'), 'summary block present');
    assert.ok(body.includes('This is a full sentence describing the source in detail.'));
    assert.ok(body.includes('A fifth sentence closes with the assessment.'));
    // The full long slot survives the compose unchanged (no truncation).
    assert.ok(body.includes(longSlot), 'the entire long slot is preserved');
    assert.equal(out.item.id, store.items[0].id);
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
  test('a too-close output is SAVED with a warning + a drafted judgement carrying the warning', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm({
      headline: 'The commission said telecom operators must warn subscribers about rising SIM-swap fraud',
      slots: { Summary: 'S', Impact: 'I', Affected: 'A', Mitigation: 'M', 'Why it matters': 'W', Source: 'Src' },
    });

    const out = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm }),
    );

    // OWNER DECISION: the guard WARNS — the draft is still created.
    assert.deepEqual(out.warnings, ['too_close_to_source']);
    assert.equal(out.existed, false);
    assert.equal(store.items.length, 1, 'the too-close draft is still created');
    assert.equal(store.pivot.length, 1);
    assert.ok(store.items[0].body.startsWith('The commission said telecom operators must warn subscribers'));

    // The judgement is a normal 'drafted' row whose detail carries the warning.
    assert.equal(store.judgements.length, 1);
    const j = store.judgements[0];
    assert.equal(j.kind, 'rewrite');
    assert.equal(j.decision, 'drafted', 'not refused_overlap any more');
    assert.equal(j.publishItemId, store.items[0].id);
    assert.equal(j.detail.warning, 'too_close_to_source');
    assert.ok(j.detail.overlapMaxRun >= 8);
  });

  test('fn7 public output naming an individual is SAVED with a warning + a drafted judgement', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm({
      headline: 'EFCC arrests Chinedu Okafor over fintech fraud',
      slots: { 'What happened': 'The EFCC arrested Chinedu Okafor.', 'Who is affected': 'Customers.', Where: 'Lagos.', Source: 'EFCC.' },
    });

    const out = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 7, editorId: 'e', llm }),
    );

    // OWNER DECISION: the name guard WARNS — the named draft is still created.
    assert.deepEqual(out.warnings, ['names_individual']);
    assert.equal(store.items.length, 1, 'the named draft is still created');
    assert.ok(store.items[0].body.includes('Chinedu Okafor'), 'the named text stays');

    assert.equal(store.judgements.length, 1, 'a drafted judgement is still recorded');
    const j = store.judgements[0];
    assert.equal(j.decision, 'drafted');
    assert.equal(j.publishItemId, store.items[0].id);
    assert.equal(j.detail.warning, 'names_individual');
    assert.ok(Array.isArray(j.detail.leaked) && j.detail.leaked.length > 0);
  });

  test('a warning does NOT block — the same event can still be added to the email', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm({
      headline: 'The commission said telecom operators must warn subscribers about rising SIM-swap fraud',
      slots: { Summary: 'S', Impact: 'I', Affected: 'A', Mitigation: 'M', 'Why it matters': 'W', Source: 'Src' },
    });

    const out = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm }),
    );

    // The returned item is a real, usable publish item (id + body present).
    assert.ok(out.item.id);
    assert.ok(out.item.body.length > 0);
    assert.equal(out.warnings.length, 1);
  });

  test('fn7 output with no person-like token is allowed and warns nothing', async () => {
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
    assert.deepEqual(out.warnings, []);
    assert.equal(store.judgements[0].detail.warning, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rewrite — regenerate (Retry)
// ─────────────────────────────────────────────────────────────────────────────

describe('aiDraft — rewrite regenerate', () => {
  const DRAFT_A = {
    headline: 'Operators told to warn users about SIM-swap fraud',
    slots: { Summary: 'Alert customers about fraud.', Impact: 'Customers are at risk.', Affected: 'Telecom users.', Mitigation: 'Enable SIM locks.', 'Why it matters': 'Fraud is rising.', Source: 'According to NCC.' },
    summary: 'first attempt',
  };
  const DRAFT_B = {
    headline: 'Regulator directs telcos to issue SIM-swap alerts',
    slots: { Summary: 'Carriers must publish a warning.', Impact: 'Subscriber accounts face takeover.', Affected: 'Phone owners nationwide.', Mitigation: 'Lock the SIM and verify odd requests.', 'Why it matters': 'Identity theft is climbing.', Source: 'Per the commission.' },
    summary: 'second attempt, distinct wording',
  };

  test('regenerate=true over a live draft updates it IN PLACE with a new judgement row', async () => {
    const store = makeStore({ events: [event()] });
    // First call: normal create. Second call returns a DIFFERENT valid draft.
    const llm = stubLlm((req) => (req.prompt.includes('FRESH draft') ? DRAFT_B : DRAFT_A));

    const first = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm }),
    );
    const beforeBody = store.items[0].body;

    const out = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', regenerate: true, llm }),
    );

    // Same item id, no duplicate row (same item count and same pivot count).
    assert.equal(out.item.id, first.item.id);
    assert.equal(store.items.length, 1, 'no duplicate item');
    assert.equal(store.pivot.length, 1, 'no duplicate pivot');
    // Body was UPDATED in place to the fresh draft.
    assert.notEqual(out.item.body, beforeBody);
    assert.ok(out.item.body.startsWith('Regulator directs telcos to issue SIM-swap alerts\n\n'));
    // templateVersion is preserved.
    assert.equal(out.item.templateVersion, 'ai@1.0.0');

    // Response shape: the item existed and was regenerated.
    assert.equal(out.existed, true);
    assert.equal(out.regenerated, true);

    // Append-only ledger: 2 rewrite rows for the subject; the first is untouched.
    const rows = store.judgements.filter((j) => j.subjectKey === 'rewrite:evt-1|8');
    assert.equal(rows.length, 2, 'one ledger row per attempt');
    assert.equal(rows[0].decision, 'drafted');
    assert.equal(rows[0].detail.regenerated, undefined, 'the first row is untouched');
    assert.equal(rows[0].publishItemId, first.item.id);
    assert.equal(rows[1].decision, 'drafted');
    assert.equal(rows[1].detail.regenerated, true);
    assert.equal(rows[1].publishItemId, first.item.id, 'the new row points at the same item');
    assert.equal(out.judgementId, rows[1].id);

    // The regenerate call asked the model for a fresh draft.
    assert.equal(llm.calls.length, 2);
    assert.ok(llm.calls[1].prompt.includes('FRESH draft'));
  });

  test('regenerate=true with NO existing draft behaves as a normal create', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm(DRAFT_A);

    const out = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', regenerate: true, llm }),
    );

    assert.equal(out.existed, false);
    assert.equal(out.regenerated, false);
    assert.equal(store.items.length, 1);
    assert.equal(store.pivot.length, 1);
    // No live draft → the normal prompt (no fresh-draft nudge).
    assert.equal(llm.calls.length, 1);
    assert.equal(llm.calls[0].prompt.includes('FRESH draft'), false);
    assert.equal(store.judgements[0].detail.regenerated, undefined);
  });

  test('regenerate=true + overlap guard warning SAVES the fresh body in place and warns', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm((req) =>
      req.prompt.includes('FRESH draft')
        ? {
          // Reproduces an 8-word run from SOURCE_BODY → warns.
          headline: 'The commission said telecom operators must warn subscribers about rising SIM-swap fraud',
          slots: { Summary: 'S', Impact: 'I', Affected: 'A', Mitigation: 'M', 'Why it matters': 'W', Source: 'Src' },
        }
        : DRAFT_A,
    );

    const first = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm }),
    );
    const beforeBody = store.items[0].body;

    const out = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', regenerate: true, llm }),
    );

    // OWNER DECISION: the regen that trips the guard still SAVES + warns.
    assert.deepEqual(out.warnings, ['too_close_to_source']);
    assert.equal(out.regenerated, true);
    assert.equal(store.items.length, 1, 'no duplicate item');
    assert.equal(store.items[0].id, first.item.id, 'same item id');
    assert.notEqual(store.items[0].body, beforeBody, 'the fresh body replaced the old one');
    assert.ok(store.items[0].body.includes('The commission said telecom operators must warn subscribers'));

    // The retry attempt is appended with the warning on a 'drafted' row.
    const rows = store.judgements.filter((j) => j.subjectKey === 'rewrite:evt-1|8');
    assert.equal(rows.length, 2);
    assert.equal(rows[1].decision, 'drafted');
    assert.equal(rows[1].detail.regenerated, true);
    assert.equal(rows[1].detail.warning, 'too_close_to_source');
    assert.equal(rows[1].publishItemId, first.item.id);
  });

  test('regenerate=false (default) over a live draft keeps the idempotent behaviour', async () => {
    const store = makeStore({ events: [event()] });
    const llm = stubLlm(DRAFT_A);

    const first = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', llm }),
    );
    const second = await withPrisma(store, () =>
      rewriteEventToDraft({ eventId: 'evt-1', functionId: 8, editorId: 'e', regenerate: false, llm }),
    );

    assert.equal(second.existed, true);
    assert.equal(second.regenerated, false);
    assert.equal(second.judgementId, null);
    assert.equal(second.item.id, first.item.id);
    assert.equal(store.items.length, 1);
    assert.equal(store.judgements.length, 1, 'no new ledger row on an idempotent return');
    assert.equal(llm.calls.length, 1, 'the idempotent return short-circuits before the LLM');
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
    // Distinct, recent timestamps so `publishedAt desc` ordering is
    // deterministic (both inside the recommend 168h window) — candidates[0]
    // must be e1 for the pick index 1 in the stub below.
    const now = Date.now();
    const store = makeStore({
      events: [
        event({ id: 'e1', title: 'NCC issues SIM-swap advisory', publishedAt: new Date(now) }),
        event({ id: 'e2', title: 'Bank suffers data breach', publishedAt: new Date(now - 60_000) }),
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

  test('recommend draws ONLY from cybersecurity-classified events', async () => {
    const now = Date.now();
    const store = makeStore({
      events: [
        event({ id: 'cyber', title: 'Ransomware hits a Lagos hospital', publishedAt: new Date(now) }),
        // Non-cyber (e.g. a fintech funding round) must never be a candidate.
        event({ id: 'noncyber', title: 'Fintech raises $20m Series A', publishedAt: new Date(now - 60_000), isCybersecurity: false }),
        event({ id: 'unclass', title: 'Something unclassified', publishedAt: new Date(now - 120_000), isCybersecurity: null }),
      ],
    });
    const llm = stubLlm({ picks: [{ index: 1, reason: 'real cyber incident', confidence: 0.9 }] });

    const out = await withPrisma(store, () => recommendEvents({ functionIds: [7], limit: 4, llm }));
    const ids = out.recommendations[0].judgements.map((j) => j.eventId);

    assert.deepEqual(ids, ['cyber'], 'only the cybersecurity event is a candidate');
    assert.equal(store.judgements.length, 1);
  });

  test('recommend defaults to 4 picks per section when limit is omitted', async () => {
    const store = makeStore({
      events: [
        event({ id: 'e1', title: 'Story one' }),
        event({ id: 'e2', title: 'Story two' }),
        event({ id: 'e3', title: 'Story three' }),
        event({ id: 'e4', title: 'Story four' }),
        event({ id: 'e5', title: 'Story five' }),
      ],
    });
    const llm = stubLlm({
      picks: [
        { index: 1, reason: 'fits a', confidence: 0.9 },
        { index: 2, reason: 'fits b', confidence: 0.85 },
        { index: 3, reason: 'fits c', confidence: 0.8 },
        { index: 4, reason: 'fits d', confidence: 0.75 },
        { index: 5, reason: 'fits e', confidence: 0.7 },
      ],
    });

    const out = await withPrisma(store, () => recommendEvents({ functionIds: [7], llm }));

    // No limit passed → the new default (4) caps the model's 5 picks.
    assert.equal(out.recommendations[0].judgements.length, 4);
    assert.equal(store.judgements.length, 4);
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
