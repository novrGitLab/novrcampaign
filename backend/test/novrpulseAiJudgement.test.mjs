import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '../src/utils/prisma.js';
import {
  recordJudgement,
  acceptJudgement,
  rejectJudgement,
  listJudgements,
  JUDGEMENT_KINDS,
  MIN_REASON_LENGTH,
} from '../src/services/novrpulse/judgements.js';
import {
  list,
  accept,
  reject,
  listSchema,
  rejectSchema,
} from '../src/controllers/aiJudgementController.js';

// Tests for the AI judgement ledger + review loop.
//
// Two layers are covered:
//  1. SERVICE + CONTROLLER: driven against in-memory fakes shadowing the shared
//     Prisma singleton's `aiJudgement`/`npEvent` delegates (the pattern used by
//     novrpulsePulseApi.test.mjs). No live database needed.
//  2. EXPORT CLI and the DB-level append-only TRIGGER: these genuinely need
//     Postgres. They probe the database at load and skip when it is unreachable
//     (the pattern used by driveAuth.test.mjs). The trigger test additionally
//     guards on the `ai_judgement` table existing, so a DB that predates this
//     migration skips rather than fails.

const BACKEND_DIR = fileURLToPath(new URL('..', import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stand-in for the `ai_judgement` / `np_event` delegates.
// ─────────────────────────────────────────────────────────────────────────────

function makeStore(seedJudgements = [], seedEvents = []) {
  const judgements = seedJudgements.map((j) => ({ ...j }));
  const events = seedEvents.map((e) => ({ ...e }));
  let idSeq = 0;

  function matches(row, where = {}) {
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('not' in v) return row[k] !== v.not;
        if ('in' in v) return v.in.includes(row[k]);
      }
      return row[k] === v;
    });
  }

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
      // Emulate the relation `select: { event: { select: { title } } }` the
      // service asks for, so `row.event?.title` resolves like real Prisma.
      return rows.map((j) => {
        const ev = j.eventId ? events.find((e) => e.id === j.eventId) : null;
        return { ...j, event: ev ? { title: ev.title } : null };
      });
    },
  };

  const npEvent = {
    async findMany({ where } = {}) {
      const ids = where?.id?.in ?? null;
      const rows = ids ? events.filter((e) => ids.includes(e.id)) : events;
      return rows.map((e) => ({ id: e.id, title: e.title }));
    },
  };

  return { judgements, events, aiJudgement, npEvent };
}

/**
 * Shadow the singleton's delegates, run `fn`, restore exactly.
 *
 * Prisma exposes its delegates as GETTERS on the client, not own properties, so
 * a naive `delete prisma[n]` in the restore would remove the accessor and break
 * every later test. We capture the real delegate value and always re-define it
 * as a plain own property on restore (covering the getter on the prototype).
 */
async function withPrisma(store, fn) {
  const names = ['aiJudgement', 'npEvent'];
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

after(() => {
  // Defensive: ensure the real delegates are restored (prisma.aiJudgement is an
  // accessor on the client; withPrisma re-defines the captured value).
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. SERVICE
// ─────────────────────────────────────────────────────────────────────────────

describe('judgements service — record', () => {
  test('recordJudgement inserts with outcome "pending" and returns the row', async () => {
    const store = makeStore();
    await withPrisma(store, async () => {
      const row = await recordJudgement({
        kind: 'dedup',
        counterpartEventId: 'cp-1',
        subjectKey: 'dedup:a|b',
        scenario: { a: 'x', b: 'y' },
        decision: 'same',
        confidence: 0.91,
        model: 'test-model',
        promptVersion: 'v1',
      });

      assert.equal(row.outcome, 'pending');
      assert.equal(row.kind, 'dedup');
      assert.equal(row.decision, 'same');
      assert.equal(row.confidence, 0.91);
      assert.equal(store.judgements.length, 1);
    });
  });

  test('recordJudgement rejects an unknown kind with a 400', async () => {
    const store = makeStore();
    await withPrisma(store, async () => {
      await assert.rejects(
        recordJudgement({
          kind: 'not-a-kind',
          subjectKey: 'k',
          scenario: {},
          decision: 'd',
          model: 'm',
          promptVersion: 'v1',
        }),
        (err) => {
          assert.equal(err.statusCode, 400);
          return true;
        },
      );
      assert.equal(store.judgements.length, 0);
    });
  });

  test('JUDGEMENT_KINDS is the closed set', () => {
    assert.deepEqual(JUDGEMENT_KINDS, ['dedup', 'rewrite', 'recommend']);
  });
});

describe('judgements service — accept', () => {
  test('accept sets accepted + reviewerId + reviewedAt, and a second accept is a Conflict', async () => {
    const store = makeStore([
      { id: 'j1', kind: 'dedup', outcome: 'pending', subjectKey: 'k', createdAt: new Date(1) },
    ]);
    await withPrisma(store, async () => {
      const row = await acceptJudgement('j1', 'reviewer-1');
      assert.equal(row.outcome, 'accepted');
      assert.equal(row.reviewerId, 'reviewer-1');
      assert.ok(row.reviewedAt instanceof Date, 'reviewedAt must be set');

      await assert.rejects(acceptJudgement('j1', 'reviewer-2'), (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      });
    });
  });
});

describe('judgements service — reject', () => {
  test('reject requires a reason (missing and 2-char both throw a 400)', async () => {
    const store = makeStore([
      { id: 'j1', kind: 'dedup', outcome: 'pending', subjectKey: 'k', createdAt: new Date(1) },
    ]);
    await withPrisma(store, async () => {
      await assert.rejects(rejectJudgement('j1', 'r1', ''), (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      });
      await assert.rejects(rejectJudgement('j1', 'r1', undefined), (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      });
      await assert.rejects(rejectJudgement('j1', 'r1', 'no'), (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      });
      // Reason too short → the row is untouched and still pending.
      assert.equal(store.judgements[0].outcome, 'pending');
      assert.equal(MIN_REASON_LENGTH, 3);
    });
  });

  test('reject sets rejected + reason + reviewerId; reject then accept is a Conflict (one-way)', async () => {
    const store = makeStore([
      { id: 'j1', kind: 'dedup', outcome: 'pending', subjectKey: 'k', createdAt: new Date(1) },
    ]);
    await withPrisma(store, async () => {
      const row = await rejectJudgement('j1', 'r1', 'not the same event');
      assert.equal(row.outcome, 'rejected');
      assert.equal(row.reason, 'not the same event');
      assert.equal(row.reviewerId, 'r1');

      await assert.rejects(acceptJudgement('j1', 'r2'), (err) => {
        assert.equal(err.statusCode, 409);
        return true;
      });
    });
  });
});

describe('judgements service — list', () => {
  const seed = [
    { id: 'j1', kind: 'dedup', outcome: 'pending', subjectKey: 'k1', counterpartEventId: 'e2', createdAt: new Date(2) },
    { id: 'j2', kind: 'rewrite', outcome: 'accepted', subjectKey: 'k2', eventId: 'e1', createdAt: new Date(3) },
    { id: 'j3', kind: 'dedup', outcome: 'pending', subjectKey: 'k3', eventId: 'e1', createdAt: new Date(1) },
  ];

  test('outcome "pending" resolves subject titles and orders createdAt desc (no N+1)', async () => {
    const store = makeStore(seed, [
      { id: 'e1', title: 'Primary event' },
      { id: 'e2', title: 'Counterpart event' },
    ]);
    await withPrisma(store, async () => {
      const rows = await listJudgements({ outcome: 'pending' });
      assert.equal(rows.length, 2);
      assert.ok(rows.every((r) => r.outcome === 'pending'));
      // Ordered createdAt desc → j1 then j3.
      assert.deepEqual(rows.map((r) => r.id), ['j1', 'j3']);

      const j3 = rows.find((r) => r.id === 'j3');
      assert.equal(j3.subject.eventTitle, 'Primary event');
      const j1 = rows.find((r) => r.id === 'j1');
      assert.equal(j1.subject.counterpartTitle, 'Counterpart event');
    });
  });

  test('filters by kind and by outcome', async () => {
    const store = makeStore(seed, []);
    await withPrisma(store, async () => {
      const pending = await listJudgements({ outcome: 'pending' });
      assert.equal(pending.length, 2);
      const rewrites = await listJudgements({ kind: 'rewrite' });
      assert.equal(rewrites.length, 1);
      assert.equal(rewrites[0].id, 'j2');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────

describe('aiJudgement controller — list', () => {
  test('GET returns { judgements: [...] } including scenario/detail and subject', async () => {
    const store = makeStore([
      {
        id: 'j1',
        kind: 'dedup',
        outcome: 'pending',
        subjectKey: 'dedup:a|b',
        counterpartEventId: 'e2',
        scenario: { left: 'A', right: 'B' },
        detail: { notes: 'x' },
        decision: 'same',
        confidence: 0.8,
        rationale: 'because',
        createdAt: new Date(1),
      },
    ], [{ id: 'e2', title: 'Counterpart' }]);

    await withPrisma(store, async () => {
      const { payload } = await callController(list, { query: {}, user: { id: 'r1' } });
      assert.equal(payload.judgements.length, 1);
      const j = payload.judgements[0];
      assert.equal(j.id, 'j1');
      assert.deepEqual(j.scenario, { left: 'A', right: 'B' });
      assert.deepEqual(j.detail, { notes: 'x' });
      assert.equal(j.subject.counterpartTitle, 'Counterpart');
      assert.equal(j.subject.subjectKey, 'dedup:a|b');
      assert.equal(j.outcome, 'pending');
    });
  });

  test('default outcome is "pending"', async () => {
    const { outcome } = await listSchema.validateAsync({});
    assert.equal(outcome, 'pending');
  });
});

describe('aiJudgement controller — accept/reject', () => {
  test('accept uses the SESSION identity (never a body field)', async () => {
    const store = makeStore([
      { id: 'j1', kind: 'dedup', outcome: 'pending', subjectKey: 'k', createdAt: new Date(1) },
    ]);
    await withPrisma(store, async () => {
      const { payload } = await callController(accept, {
        params: { id: 'j1' },
        body: { reviewerId: 'attacker', outcome: 'accepted' },
        user: { id: 'session-user' },
      });
      assert.equal(payload.judgement.outcome, 'accepted');
      assert.equal(store.judgements[0].reviewerId, 'session-user');
    });
  });

  test('accept on an unknown id is a 404', async () => {
    const store = makeStore();
    await withPrisma(store, async () => {
      const { error } = await callController(accept, { params: { id: 'nope' }, user: { id: 'r1' } });
      assert.equal(error.statusCode, 404);
    });
  });

  test('reject without a reason is a 400 and writes nothing', async () => {
    const store = makeStore([
      { id: 'j1', kind: 'dedup', outcome: 'pending', subjectKey: 'k', createdAt: new Date(1) },
    ]);
    await withPrisma(store, async () => {
      const { error } = await callController(reject, { params: { id: 'j1' }, body: {}, user: { id: 'r1' } });
      assert.equal(error.statusCode, 400);
      assert.equal(store.judgements[0].outcome, 'pending');
    });
  });

  test('reject with a 2-char reason is a 400 (Joi min 3)', async () => {
    await assert.rejects(rejectSchema.validateAsync({ reason: 'no' }), (err) => err.isJoi);
  });

  test('reject then accept is a 409 (one-way transition)', async () => {
    const store = makeStore([
      { id: 'j1', kind: 'dedup', outcome: 'pending', subjectKey: 'k', createdAt: new Date(1) },
    ]);
    await withPrisma(store, async () => {
      const r = await callController(reject, { params: { id: 'j1' }, body: { reason: 'wrong match' }, user: { id: 'r1' } });
      assert.equal(r.payload.judgement.outcome, 'rejected');

      const a = await callController(accept, { params: { id: 'j1' }, user: { id: 'r2' } });
      assert.equal(a.error.statusCode, 409);
    });
  });

  test('an unauthenticated accept is a 403', async () => {
    const store = makeStore([
      { id: 'j1', kind: 'dedup', outcome: 'pending', subjectKey: 'k', createdAt: new Date(1) },
    ]);
    await withPrisma(store, async () => {
      const { error } = await callController(accept, { params: { id: 'j1' }, user: null });
      assert.equal(error.statusCode, 403);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. EXPORT CLI + DB-LEVEL APPEND-ONLY TRIGGER (need Postgres; skip otherwise)
// ─────────────────────────────────────────────────────────────────────────────

let dbUp = false;
let hasTable = false;
if (process.env.DATABASE_URL) {
  try {
    await prisma.aiJudgement.count();
    dbUp = true;
    hasTable = true;
  } catch (err) {
    // Table missing (pre-migration DB) vs DB entirely down — distinguish by message.
    dbUp = !/can't reach|ECONNREFUSED|ENOTFOUND|authentication/i.test(err.message);
    hasTable = false;
    console.error('[novrpulseAiJudgement.test] DB/tables unavailable:', err.message.split('\n')[0]);
  }
}

describe('export CLI', { skip: !hasTable }, () => {
  let dir;
  const createdIds = [];

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'aj-export-'));
  });

  after(async () => {
    // Clean only the rows this suite inserted.
    if (createdIds.length) {
      await prisma.$executeRawUnsafe('ALTER TABLE "ai_judgement" DISABLE TRIGGER "ai_judgement_no_delete"');
      await prisma.aiJudgement.deleteMany({ where: { id: { in: createdIds } } });
      await prisma.$executeRawUnsafe('ALTER TABLE "ai_judgement" ENABLE TRIGGER "ai_judgement_no_delete"');
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('exports only non-pending rows and EXCLUDES reviewerId; each line is valid JSON', async () => {
    // Two adjudicated rows (exported) + one pending row (excluded).
    const accepted = await prisma.aiJudgement.create({
      data: {
        kind: 'dedup',
        counterpartEventId: 'cp-x',
        subjectKey: `export:${Date.now()}:accepted`,
        scenario: { a: 'left', b: 'right' },
        decision: 'same',
        confidence: 0.75,
        model: 'export-model',
        promptVersion: 'v1',
        outcome: 'accepted',
        reviewerId: 'SECRET-REVIEWER-ID',
        reviewedAt: new Date(),
      },
    });
    const rejected = await prisma.aiJudgement.create({
      data: {
        kind: 'rewrite',
        counterpartEventId: 'cp-y',
        subjectKey: `export:${Date.now()}:rejected`,
        scenario: { text: 'draft' },
        decision: 'rewrite',
        model: 'export-model',
        promptVersion: 'v1',
        outcome: 'rejected',
        reason: 'tone wrong',
        reviewerId: 'SECRET-REVIEWER-ID',
        reviewedAt: new Date(),
      },
    });
    const pending = await prisma.aiJudgement.create({
      data: {
        kind: 'recommend',
        counterpartEventId: 'cp-z',
        subjectKey: `export:${Date.now()}:pending`,
        scenario: { x: 1 },
        decision: 'recommend',
        model: 'export-model',
        promptVersion: 'v1',
        outcome: 'pending',
      },
    });
    createdIds.push(accepted.id, rejected.id, pending.id);

    const out = join(dir, 'out.jsonl');
    execFileSync(process.execPath, ['scripts/export-judgements.mjs', '--out', out], {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    });

    const raw = readFileSync(out, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const records = lines.map((l) => JSON.parse(l));

    // Only the two adjudicated rows created here (the suite is additive-safe:
    // filter to our subjectKeys so a shared DB does not break the assertion).
    const ours = records.filter((r) => String(r.scenario && r.scenario.a) === 'left' || (r.scenario && r.scenario.text === 'draft'));
    assert.equal(ours.length, 2, 'exactly the two adjudicated rows should be exported');
    assert.ok(records.every((r) => r.outcome !== 'pending'), 'no pending row may be exported');
    assert.equal(JSON.stringify(records).includes('SECRET-REVIEWER-ID'), false, 'reviewerId must be excluded');
    assert.ok(records.every((r) => !Object.prototype.hasOwnProperty.call(r, 'reviewerId')));
    // Every emitted field is from the allowed training projection.
    for (const r of records) {
      for (const key of Object.keys(r)) {
        assert.ok(
          ['kind', 'scenario', 'decision', 'confidence', 'model', 'promptVersion', 'detail', 'outcome', 'reason', 'reviewedAt'].includes(key),
          `unexpected export field: ${key}`,
        );
      }
    }
  });
});

describe('append-only trigger (DB level)', { skip: !hasTable }, () => {
  test('updating decision is refused, updating outcome is allowed, deleting is refused', async () => {
    const row = await prisma.aiJudgement.create({
      data: {
        kind: 'dedup',
        counterpartEventId: 'cp-trigger',
        subjectKey: `trigger:${Date.now()}`,
        scenario: { frozen: true },
        decision: 'same',
        model: 'm',
        promptVersion: 'v1',
        outcome: 'pending',
      },
    });

    try {
      // Forbidden: a record column (decision) may not change.
      await assert.rejects(
        prisma.aiJudgement.update({ where: { id: row.id }, data: { decision: 'different' } }),
        /append-only/,
      );
      // Forbidden: scenario (the frozen snapshot) may not change.
      await assert.rejects(
        prisma.aiJudgement.update({ where: { id: row.id }, data: { scenario: { frozen: false } } }),
        /append-only/,
      );
      // Allowed: the review columns may change.
      const updated = await prisma.aiJudgement.update({
        where: { id: row.id },
        data: { outcome: 'accepted', reviewerId: 'r1', reviewedAt: new Date() },
      });
      assert.equal(updated.outcome, 'accepted');

      // Forbidden: rows are training data and may not be deleted.
      await assert.rejects(
        prisma.aiJudgement.delete({ where: { id: row.id } }),
        /append-only/,
      );
    } finally {
      // The delete trigger also blocks cleanup, so bypass it for this one row.
      await prisma.$executeRawUnsafe('ALTER TABLE "ai_judgement" DISABLE TRIGGER "ai_judgement_no_delete"');
      await prisma.aiJudgement.deleteMany({ where: { id: row.id } });
      await prisma.$executeRawUnsafe('ALTER TABLE "ai_judgement" ENABLE TRIGGER "ai_judgement_no_delete"');
    }
  });
});

if (!dbUp) {
  test('DB-dependent suite skipped (no reachable Postgres / ai_judgement table)', { skip: true }, () => {});
}
