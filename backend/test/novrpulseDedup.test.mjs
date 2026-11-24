import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import {
  findCandidatePairs,
  confirmPair,
  runDedup,
  dedupSubjectKey,
  titlesBlock,
  normaliseTitleTokens,
  isLatinComparable,
  DEDUP_PROMPT_VERSION,
} from '../src/services/novrpulse/dedup.js';
import { acceptJudgement, listJudgements } from '../src/services/novrpulse/judgements.js';

// Tests for Capability 1: Deduplication.
//
// The LLM is STUBBED everywhere (no network). The service is driven against an
// in-memory fake shadowing the shared Prisma singleton's `npEvent` /
// `aiJudgement` delegates and `$transaction` — the same pattern used by
// novrpulseAiJudgement.test.mjs.

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stand-ins
// ─────────────────────────────────────────────────────────────────────────────

function makeStore(seedEvents = [], seedJudgements = []) {
  const events = seedEvents.map((e) => ({ ...e }));
  const judgements = seedJudgements.map((j) => ({ ...j }));
  let idSeq = 0;

  function matches(row, where = {}) {
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
    async findMany({ where = {}, orderBy, take } = {}) {
      let rows = events.filter((e) => matches(e, where));
      if (orderBy?.publishedAt === 'desc') {
        rows = [...rows].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
      }
      if (typeof take === 'number') rows = rows.slice(0, take);
      return rows.map((e) => ({
        id: e.id,
        title: e.title,
        summary: e.summary ?? '',
        region: e.region ?? null,
        publishedAt: e.publishedAt ?? null,
        clusterId: e.clusterId ?? null,
        sources: e.sources ?? [],
      }));
    },
    async findUnique({ where }) {
      const e = events.find((x) => x.id === where.id);
      return e ? { id: e.id, clusterId: e.clusterId ?? null } : null;
    },
    async updateMany({ where, data }) {
      const ids = where?.id?.in ?? null;
      const hits = events.filter((e) => (ids ? ids.includes(e.id) : matches(e, where)));
      for (const e of hits) Object.assign(e, data);
      return { count: hits.length };
    },
  };

  const aiJudgement = {
    async create({ data }) {
      idSeq += 1;
      const row = {
        id: `aj-${idSeq}`,
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
    async updateMany({ where, data }) {
      const hits = judgements.filter((j) => matches(j, where));
      for (const row of hits) Object.assign(row, data);
      return { count: hits.length };
    },
    async findUnique({ where }) {
      const row = judgements.find((j) => (where.id !== undefined ? j.id === where.id : matches(j, where)));
      return row ? { ...row } : null;
    },
    async findMany({ where, orderBy, take } = {}) {
      let rows = judgements.filter((j) => matches(j, where));
      if (orderBy?.createdAt === 'desc') {
        rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      if (typeof take === 'number') rows = rows.slice(0, take);
      return rows.map((j) => {
        const ev = j.eventId ? events.find((e) => e.id === j.eventId) : null;
        return { ...j, event: ev ? { title: ev.title } : null };
      });
    },
  };

  // Mirror the real client: the delegates passed to the callback are the same
  // store delegates; the callback runs inline (no rollback in the fake).
  const $transaction = async (fn) => fn({ npEvent, aiJudgement });

  return { events, judgements, npEvent, aiJudgement, $transaction };
}

/**
 * Shadow the singleton's delegates, run `fn`, restore exactly. Prisma exposes
 * delegates as GETTERS, so re-define the captured values on restore.
 */
async function withPrisma(store, fn) {
  const names = ['aiJudgement', 'npEvent', '$transaction'];
  const prev = names.map((n) => ({ n, val: prisma[n] }));
  for (const n of names) Object.defineProperty(prisma, n, { value: store[n], configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    for (const { n, val } of prev) {
      Object.defineProperty(prisma, n, { value: val, configurable: true, writable: true });
    }
  }
}

/** An LLM stub whose `complete` returns a fixed verdict and never hits network. */
function stubLlm(verdict = { same_story: true, confidence: 0.9, reason: 'same event' }, model = 'stub-bulk') {
  const calls = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      return verdict;
    },
    model: () => model,
  };
}

const DAY = 24 * 3_600_000;
const now = Date.now();
const event = (over = {}) => ({
  id: over.id ?? `e-${Math.random().toString(36).slice(2)}`,
  title: 'Default headline about something',
  summary: 'A summary.',
  region: null,
  publishedAt: new Date(now - DAY),
  clusterId: null,
  sources: [],
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage A — deterministic blocking
// ─────────────────────────────────────────────────────────────────────────────

describe('dedup — blocking', () => {
  test('two similar titles produce one pair; dissimilar titles produce none', async () => {
    const store = makeStore([
      event({ id: 'a', title: 'EFCC arrests suspect over bank fraud in Lagos' }),
      event({ id: 'b', title: 'EFCC arrests suspect over bank fraud in Lagos' }),
      event({ id: 'c', title: 'NCC issues new spectrum guidance for operators' }),
    ]);
    await withPrisma(store, async () => {
      const pairs = await findCandidatePairs({ eventIds: ['a', 'b', 'c'] });
      assert.equal(pairs.length, 1);
      assert.equal(pairs[0].subjectKey, 'dedup:a|b');
      assert.equal(pairs[0].a.id, 'a');
      assert.equal(pairs[0].b.id, 'b');
    });
  });

  test('the same pair is not duplicated, and is emitted in stable sorted order', async () => {
    const store = makeStore([
      event({ id: 'z', title: 'GTBank suffers data breach in Lagos' }),
      event({ id: 'a', title: 'GTBank suffers data breach in Lagos' }),
    ]);
    await withPrisma(store, async () => {
      const pairs = await findCandidatePairs({ eventIds: ['z', 'a'] });
      assert.equal(pairs.length, 1);
      // Subject key + member order are lexicographic regardless of input order.
      assert.equal(pairs[0].subjectKey, 'dedup:a|z');
      assert.equal(pairs[0].a.id, 'a');
      assert.equal(pairs[0].b.id, 'z');
    });
  });

  test('a pair already judged pending or accepted is skipped', async () => {
    const seed = [
      event({ id: 'a', title: 'Same headline about the same event today' }),
      event({ id: 'b', title: 'Same headline about the same event today' }),
    ];
    const pending = makeStore(seed, [
      { id: 'j1', kind: 'dedup', subjectKey: 'dedup:a|b', outcome: 'pending', createdAt: new Date() },
    ]);
    await withPrisma(pending, async () => {
      assert.equal((await findCandidatePairs({ eventIds: ['a', 'b'] })).length, 0);
    });

    const accepted = makeStore(seed, [
      { id: 'j2', kind: 'dedup', subjectKey: 'dedup:a|b', outcome: 'accepted', createdAt: new Date() },
    ]);
    await withPrisma(accepted, async () => {
      assert.equal((await findCandidatePairs({ eventIds: ['a', 'b'] })).length, 0);
    });

    // A rejected pair is NOT skipped — a human rejection is not a record that
    // the LLM has already judged it in this pass model.
    const rejected = makeStore(seed, [
      { id: 'j3', kind: 'dedup', subjectKey: 'dedup:a|b', outcome: 'rejected', createdAt: new Date() },
    ]);
    await withPrisma(rejected, async () => {
      assert.equal((await findCandidatePairs({ eventIds: ['a', 'b'] })).length, 1);
    });
  });

  test('region + publishedAt within ±72h blocks; beyond the window does not', () => {
    const a = event({ id: 'a', title: 'Alpha', region: 'Lagos', publishedAt: new Date(now) });
    const within = event({ id: 'b', title: 'Beta', region: 'Lagos', publishedAt: new Date(now - DAY) });
    const beyond = event({ id: 'c', title: 'Gamma', region: 'Lagos', publishedAt: new Date(now - 5 * DAY) });
    assert.equal(titlesBlock(a.title, within.title), false, 'titles differ');
    assert.equal(regionTimeAffinity(a, within), true);
    assert.equal(regionTimeAffinity(a, beyond), false);
  });
});

// Local helper mirroring the exported regionTimeBlock behaviour on plain objects.
function regionTimeAffinity(a, b) {
  const ra = (a.region || '').toLowerCase();
  const rb = (b.region || '').toLowerCase();
  if (!ra || ra !== rb) return false;
  return Math.abs(a.publishedAt.getTime() - b.publishedAt.getTime()) / 3_600_000 <= 72;
}

describe('dedup — normalisation', () => {
  test('normaliseTitleTokens lowercases, strips punctuation/stopwords, de-dups', () => {
    const tokens = normaliseTitleTokens('The EFCC, the EFCC — arrests a suspect!');
    assert.deepEqual(tokens, ['efcc', 'arrests', 'suspect']);
  });

  test('dedupSubjectKey is stable and sorted regardless of argument order', () => {
    assert.equal(dedupSubjectKey('b', 'a'), 'dedup:a|b');
    assert.equal(dedupSubjectKey('a', 'b'), 'dedup:a|b');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocking regressions — generic tokens, non-Latin titles, distinctive core
// (see FIX 1/2/3 in dedup.js)
// ─────────────────────────────────────────────────────────────────────────────

describe('dedup — titlesBlock fix 1: generic tokens are not blocking signal', () => {
  test('two stories sharing only generic category tokens do NOT block', () => {
    assert.equal(
      titlesBlock(
        'Huawei warns Nigerian businesses of AI-driven cyberattacks',
        'Zimbabwe Cabinet Approves National AI Charter',
      ),
      false,
    );
  });

  test('a single distinctive shared token is NOT enough (needs >= 2)', () => {
    // Both share only "acme" (a proper noun) plus generic words — too weak.
    assert.equal(
      titlesBlock('Acme AI security report released', 'Acme technology update'),
      false,
    );
  });
});

describe('dedup — titlesBlock fix 2: non-Latin titles never block', () => {
  test('a Japanese title does not block an English headline on stray Latin tokens', () => {
    assert.equal(
      titlesBlock(
        'AIを活用したサイバー攻撃の増加を受け、日本がサイバーセキュリティへの緊急資金拠出を推進',
        'Lawmakers call on White House to develop defensive AI cyber systems',
      ),
      false,
    );
  });

  test('isLatinComparable rejects majority non-Latin and accepts Latin titles', () => {
    assert.equal(isLatinComparable('AIを活用したサイバー攻撃の増加を受け'), false);
    assert.equal(
      isLatinComparable('First Circle Capital closes $26 million fund'),
      true,
    );
  });
});

describe('dedup — titlesBlock true duplicates still detected', () => {
  test('same wire story with a reworded tail still blocks', () => {
    assert.equal(
      titlesBlock(
        'Clea Launches Faster US Dollar Payment Routes From Africa to China',
        'Clea Launches Faster USD Payment Routes to China, Hong Kong for African',
      ),
      true,
    );
  });

  test('same story, reworded, still blocks', () => {
    assert.equal(
      titlesBlock(
        'First Circle Capital closes $26 million fund',
        'First Circle Capital Closes $26 Million African Fintech Fund',
      ),
      true,
    );
  });

  test('same story across sources (punctuation + reordered tail) still blocks', () => {
    assert.equal(
      titlesBlock(
        "Attackers Compromise Microsoft's Agent Framework PyPI Package to Steal Cloud Credentials",
        "Microsoft's Agent Framework PyPI package compromised to steal credentials",
      ),
      true,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage B — LLM confirmation
// ─────────────────────────────────────────────────────────────────────────────

describe('dedup — confirmPair', () => {
  const pair = {
    subjectKey: 'dedup:a|b',
    a: { id: 'a', title: 'Alpha headline', summary: 'Alpha summary.', sourceName: 'https://x/a', publishedAt: new Date(now) },
    b: { id: 'b', title: 'Beta headline', summary: 'Beta summary.', sourceName: 'https://x/b', publishedAt: new Date(now) },
  };

  test('records a judgement with the correct kind/decision/scenario/model/promptVersion', async () => {
    const store = makeStore();
    const llm = stubLlm({ same_story: true, confidence: 0.93, reason: 'identical event' }, 'bulk-model-x');
    await withPrisma(store, async () => {
      const res = await confirmPair(pair, { llm });
      assert.equal(res.decision, 'same_story');

      assert.equal(store.judgements.length, 1);
      const row = store.judgements[0];
      assert.equal(row.kind, 'dedup');
      assert.equal(row.eventId, 'a');
      assert.equal(row.counterpartEventId, 'b');
      assert.equal(row.subjectKey, 'dedup:a|b');
      assert.equal(row.decision, 'same_story');
      assert.equal(row.confidence, 0.93);
      assert.equal(row.rationale, 'identical event');
      assert.equal(row.model, 'bulk-model-x');
      assert.equal(row.promptVersion, DEDUP_PROMPT_VERSION);
      assert.equal(row.outcome, 'pending');
      assert.deepEqual(row.scenario, {
        a: { id: 'a', title: 'Alpha headline', summary: 'Alpha summary.' },
        b: { id: 'b', title: 'Beta headline', summary: 'Beta summary.' },
      });
    });
  });

  test('a distinct verdict is recorded with decision "distinct"', async () => {
    const store = makeStore();
    const llm = stubLlm({ same_story: false, confidence: 0.7, reason: 'same topic only' });
    await withPrisma(store, async () => {
      const res = await confirmPair(pair, { llm });
      assert.equal(res.decision, 'distinct');
      assert.equal(store.judgements[0].decision, 'distinct');
    });
  });

  test('the scenario contains NO raw body field', async () => {
    const store = makeStore();
    const llm = stubLlm();
    const withBody = {
      subjectKey: 'dedup:a|b',
      a: { id: 'a', title: 'Alpha', summary: 'Summarised in our own words', body: 'PUBLISHER RAW BODY', publishedAt: new Date(now) },
      b: { id: 'b', title: 'Beta', summary: 'Summarised too', body: 'ANOTHER RAW BODY', publishedAt: new Date(now) },
    };
    await withPrisma(store, async () => {
      await confirmPair(withBody, { llm });
      const scenario = store.judgements[0].scenario;
      assert.equal('body' in scenario.a, false);
      assert.equal('body' in scenario.b, false);
      assert.equal(JSON.stringify(scenario).includes('RAW BODY'), false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runDedup — dry run vs commit
// ─────────────────────────────────────────────────────────────────────────────

describe('dedup — runDedup', () => {
  test('dryRun (the default) records nothing but still reports the verdicts', async () => {
    const store = makeStore([
      event({ id: 'a', title: 'Same breaking story in Abuja today' }),
      event({ id: 'b', title: 'Same breaking story in Abuja today' }),
    ]);
    const llm = stubLlm({ same_story: true, confidence: 0.8, reason: 'same' });
    await withPrisma(store, async () => {
      const res = await runDedup({ llm, eventIds: ['a', 'b'] });
      assert.equal(res.dryRun, true);
      assert.equal(res.processed, 1);
      assert.equal(res.pairs[0].recorded, false);
      assert.equal(store.judgements.length, 0);
    });
  });

  test('dryRun:false records the judgement', async () => {
    const store = makeStore([
      event({ id: 'a', title: 'Same breaking story in Abuja today' }),
      event({ id: 'b', title: 'Same breaking story in Abuja today' }),
    ]);
    const llm = stubLlm({ same_story: true, confidence: 0.8, reason: 'same' });
    await withPrisma(store, async () => {
      const res = await runDedup({ dryRun: false, llm, eventIds: ['a', 'b'] });
      assert.equal(res.pairs[0].recorded, true);
      assert.equal(store.judgements.length, 1);
    });
  });

  test('limit bounds the number of LLM confirmations', async () => {
    const store = makeStore([
      event({ id: 'a', title: 'One identical headline for blocking' }),
      event({ id: 'b', title: 'One identical headline for blocking' }),
      event({ id: 'c', title: 'Another identical headline for blocking' }),
      event({ id: 'd', title: 'Another identical headline for blocking' }),
    ]);
    const llm = stubLlm();
    await withPrisma(store, async () => {
      const res = await runDedup({ llm, limit: 1, eventIds: ['a', 'b', 'c', 'd'] });
      assert.equal(res.candidates >= 2, true);
      assert.equal(res.processed, 1);
      assert.equal(llm.calls.length, 1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Accept-side effect — grouping via clusterId
// ─────────────────────────────────────────────────────────────────────────────

describe('dedup — accept groups via clusterId', () => {
  test('accepting a same_story judgement sets a shared clusterId on both events; idempotent', async () => {
    const store = makeStore([
      event({ id: 'a', title: 'Alpha' }),
      event({ id: 'b', title: 'Beta' }),
    ], [
      {
        id: 'j1',
        kind: 'dedup',
        eventId: 'a',
        counterpartEventId: 'b',
        subjectKey: 'dedup:a|b',
        decision: 'same_story',
        outcome: 'pending',
        createdAt: new Date(1),
      },
    ]);
    await withPrisma(store, async () => {
      const row = await acceptJudgement('j1', 'reviewer-1');
      assert.equal(row.outcome, 'accepted');

      const a = store.events.find((e) => e.id === 'a');
      const b = store.events.find((e) => e.id === 'b');
      assert.ok(a.clusterId, 'event a must be clustered');
      assert.equal(a.clusterId, b.clusterId, 'both events share one cluster');

      // Idempotent: re-running the grouping changes nothing (and a re-accept is
      // a Conflict, so the effect is one-shot anyway).
      const cluster = a.clusterId;
      await assert.rejects(acceptJudgement('j1', 'reviewer-2'), (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      });
      assert.equal(store.events.find((e) => e.id === 'a').clusterId, cluster);
    });
  });

  test('accepting a distinct judgement does NOT cluster', async () => {
    const store = makeStore([
      event({ id: 'a', title: 'Alpha' }),
      event({ id: 'b', title: 'Beta' }),
    ], [
      {
        id: 'j1',
        kind: 'dedup',
        eventId: 'a',
        counterpartEventId: 'b',
        subjectKey: 'dedup:a|b',
        decision: 'distinct',
        outcome: 'pending',
        createdAt: new Date(1),
      },
    ]);
    await withPrisma(store, async () => {
      await acceptJudgement('j1', 'reviewer-1');
      assert.equal(store.events.find((e) => e.id === 'a').clusterId ?? null, null);
      assert.equal(store.events.find((e) => e.id === 'b').clusterId ?? null, null);
    });
  });

  test('a chain folds existing cluster members into the same cluster', async () => {
    // a is already clustered; b is loose; a~b accepted should pull b into a's cluster.
    const store = makeStore([
      event({ id: 'a', title: 'Alpha', clusterId: 'cluster-1' }),
      event({ id: 'b', title: 'Beta' }),
    ], [
      {
        id: 'j1',
        kind: 'dedup',
        eventId: 'a',
        counterpartEventId: 'b',
        subjectKey: 'dedup:a|b',
        decision: 'same_story',
        outcome: 'pending',
        createdAt: new Date(1),
      },
    ]);
    await withPrisma(store, async () => {
      await acceptJudgement('j1', 'reviewer-1');
      assert.equal(store.events.find((e) => e.id === 'a').clusterId, 'cluster-1');
      assert.equal(store.events.find((e) => e.id === 'b').clusterId, 'cluster-1');
    });
  });
});

// Sanity: the accept hook must not break the existing list path.
describe('dedup — integration with the ledger', () => {
  test('an accepted dedup judgement is still listed and resolvable', async () => {
    const store = makeStore([event({ id: 'a', title: 'Alpha' }), event({ id: 'b', title: 'Beta' })], [
      {
        id: 'j1',
        kind: 'dedup',
        eventId: 'a',
        counterpartEventId: 'b',
        subjectKey: 'dedup:a|b',
        decision: 'same_story',
        outcome: 'pending',
        createdAt: new Date(1),
      },
    ]);
    await withPrisma(store, async () => {
      await acceptJudgement('j1', 'reviewer-1');
      const rows = await listJudgements({ kind: 'dedup', outcome: 'accepted' });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].subject.eventTitle, 'Alpha');
      assert.equal(rows[0].subject.counterpartTitle, 'Beta');
    });
  });
});
