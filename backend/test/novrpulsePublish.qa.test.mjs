import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

// Independent QA suite for the NovrPulse F7 publishing slice.
//
// Written by the qa-engineer against the FROZEN acceptance criteria
// (docs/novrpulse/03-function-templates.md F7, 02-event-schema.md §2 note 8,
// 01-policies.md §2 + §6). It is deliberately adversarial: it tries to defeat
// the defamation control and the approval authorization, not just re-run the
// author's happy path.
//
// No live database is used. Pure logic is called directly. The controller
// suite is driven by calling the controller functions with a fake req/res while
// the shared Prisma singleton's `publishItem`/`npEvent` delegates are shadowed
// with in-memory fakes (see `installPrismaStub`). This exercises the real
// controller code path — including which field it reads for identity — without
// a Postgres instance.

import { renderF7, F7_TEMPLATE_VERSION, isArrestItem, findPersonLikeNames, knownNonPersonTokens } from '../src/services/novrpulse/project/templates/f7.js';
import { assertPublishable, GateError } from '../src/services/novrpulse/project/gates.js';
import { planF7 } from '../src/services/novrpulse/project/projectF7.js';
import { prisma } from '../src/utils/prisma.js';
import {
  approvePublishItem,
  withdrawPublishItem,
  rejectPublishItem,
  editPublishItem,
  projectF7Items,
  listPublishItems,
  deriveStatus,
} from '../src/controllers/publishController.js';

// ─────────────────────────────────────────────────────────────────────────────
// A tiny in-memory Prisma stand-in for the `publish_item` / `np_event` tables.
// ─────────────────────────────────────────────────────────────────────────────

function makeStore(seedItems = [], seedEvents = []) {
  // Model the nullable timestamp columns the way Postgres returns them: a real
  // read yields `null`, never `undefined`. The list default bucket filters on
  // `rejectedAt = null`, so seeded rows must carry the column explicitly.
  const items = seedItems.map((i) => ({ approvedAt: null, rejectedAt: null, publishedAt: null, withdrawnAt: null, ...i }));
  const events = seedEvents.map((e) => ({ ...e }));
  let idSeq = 0;

  const matches = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('not' in v) return row[k] !== v.not;
        if ('in' in v) return v.in.includes(row[k]);
      }
      return row[k] === v;
    });

  const publishItem = {
    async findUnique({ where }) {
      return items.find((i) => (where.id !== undefined ? i.id === where.id : matches(i, where))) ?? null;
    },
    async findMany({ where } = {}) {
      return items.filter((i) => matches(i, where));
    },
    async update({ where, data }) {
      const item = items.find((i) => i.id === where.id);
      if (!item) throw new Error('record not found');
      Object.assign(item, data);
      return { ...item };
    },
    async create({ data }) {
      idSeq += 1;
      const row = {
        id: `pi-${idSeq}`,
        approvedAt: null,
        rejectedAt: null,
        publishedAt: null,
        withdrawnAt: null,
        ...data,
      };
      items.push(row);
      return { ...row };
    },
  };

  const npEvent = {
    async findMany() {
      return events.map((e) => ({ ...e }));
    },
  };

  return { items, events, publishItem, npEvent };
}

/**
 * Shadow the shared singleton's delegates, run `fn`, then remove the shadow so
 * the singleton is left exactly as we found it (no cross-file leakage).
 */
async function withPrisma(store, fn) {
  const hadPublishItem = Object.prototype.hasOwnProperty.call(prisma, 'publishItem');
  const hadNpEvent = Object.prototype.hasOwnProperty.call(prisma, 'npEvent');
  Object.defineProperty(prisma, 'publishItem', { value: store.publishItem, configurable: true, writable: true });
  Object.defineProperty(prisma, 'npEvent', { value: store.npEvent, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (!hadPublishItem) delete prisma.publishItem;
    if (!hadNpEvent) delete prisma.npEvent;
  }
}

/** Minimal Express req/res doubles. Capture the status/json the controller sets. */
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

/** Invoke a controller and return { statusCode, payload } or { error }. */
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
  // Defensive: ensure no shadow survived a failed test.
  delete prisma.publishItem;
  delete prisma.npEvent;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. TEMPLATE EXACTNESS — character-for-character against the frozen template.
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: F7 frozen template exactness', () => {
  test('separator is U+2014 EM DASH and the body ends with a period', () => {
    const { body } = renderF7(
      {
        summary: 'A regulator issued a notice',
        canonicalUrl: 'https://r.example/a',
        region: 'Abuja',
        eventType: 'advisory',
      },
      { sources: [{ name: 'Regulator' }], entities: [{ type: 'agency', name: 'CBN' }], tier: 'public' },
    );

    // Exact expected bytes: "… — … — … — …."
    const expected = 'A regulator issued a notice — CBN — Abuja — Regulator (https://r.example/a).';
    assert.equal(body, expected);

    // Structural pins so a future change to the separator is caught explicitly.
    assert.ok(body.endsWith('.'), 'body must end with a period');
    assert.ok(body.includes(' \u2014 '), 'segments must be joined by " — " (U+2014)');
  });

  test('empty event (no summary/title/url/region/entities) yields no empty em-dash segments', () => {
    const { body } = renderF7({ eventType: 'advisory' }, {});
    // No "what", no who, no where, no source → nothing before the period.
    assert.equal(body, '.');
    assert.ok(!body.includes('\u2014'), 'no em-dash segment should appear with no content');
  });

  test('template version is the frozen f7@1.0.0', () => {
    assert.equal(F7_TEMPLATE_VERSION, 'f7@1.0.0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. LICENCE GATE — denied blocks, unknown/restricted do not.
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: licence gate', () => {
  test('licence "denied" blocks publication for every tier', () => {
    for (const tier of ['public', 'paid']) {
      assert.throws(
        () => assertPublishable({}, 7, tier, { licenceStatus: 'denied' }),
        (err) => err instanceof GateError && err.code === 'licence_denied',
        `denied licence must block tier ${tier}`,
      );
    }
  });

  test('licence "DENIED" in any case blocks (case-insensitive)', () => {
    assert.throws(
      () => assertPublishable({}, 7, 'public', { licenceStatus: 'DENIED' }),
      (err) => err instanceof GateError && err.code === 'licence_denied',
    );
  });

  test('licence "unknown" does NOT block the licence gate; "restricted" does not either', () => {
    assert.doesNotThrow(() => assertPublishable({}, 7, 'public', { licenceStatus: 'unknown' }));
    assert.doesNotThrow(() => assertPublishable({}, 7, 'public', { licenceStatus: 'restricted' }));
    assert.doesNotThrow(() => assertPublishable({}, 7, 'public', { licenceStatus: 'verified' }));
  });

  test('a paywall flag alone does not block (quote-limited, not blocked)', () => {
    assert.doesNotThrow(() =>
      assertPublishable({}, 7, 'public', { licenceStatus: 'unknown', paywall: true }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DEFAMATION — public-tier arrest namelessness is deterministic (code).
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: public-tier arrest namelessness', () => {
  function arrestRow(overrides = {}) {
    return {
      id: 'evt-arr',
      title: 'EFCC arrests suspect over fintech fraud',
      summary: 'The EFCC said it arrested a suspect over an alleged fintech fraud',
      whatItMeans: '',
      canonicalUrl: 'https://efcc.gov.ng/s/1',
      region: 'Lagos',
      eventType: 'arrest',
      publicDescriptor: 'a Lagos fintech executive',
      sources: [
        { rawDocument: { url: 'https://efcc.gov.ng/s/1', source: { name: 'EFCC', licenceStatus: 'verified', paywall: false } } },
      ],
      entities: [
        { role: 'mentioned', entity: { type: 'person_role', canonicalName: 'Chinedu Okafor' } },
        { role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } },
      ],
      ...overrides,
    };
  }

  test('paid tier names the person; public tier does not, for the SAME event', () => {
    const publicPlan = planF7([arrestRow()], { tier: 'public' });
    const paidPlan = planF7([arrestRow()], { tier: 'paid' });

    assert.equal(publicPlan.created.length, 1);
    assert.ok(!publicPlan.created[0].body.includes('Chinedu Okafor'));
    assert.ok(publicPlan.created[0].body.includes('a Lagos fintech executive'));

    assert.equal(paidPlan.created.length, 1);
    assert.ok(paidPlan.created[0].body.includes('Chinedu Okafor'), 'paid tier names the individual');
    assert.ok(paidPlan.created[0].body.includes('A charge is not a conviction.'));
  });

  test('MULTIPLE person entities are ALL withheld in the public tier', () => {
    const multi = arrestRow({
      entities: [
        { role: 'mentioned', entity: { type: 'person_role', canonicalName: 'Chinedu Okafor' } },
        { role: 'mentioned', entity: { type: 'person_role', canonicalName: 'Ada Balogun' } },
        { role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } },
      ],
    });
    const { created, refused } = planF7([multi], { tier: 'public' });
    assert.equal(refused.length, 0);
    assert.equal(created.length, 1);
    assert.ok(!created[0].body.includes('Chinedu Okafor'), 'first person withheld');
    assert.ok(!created[0].body.includes('Ada Balogun'), 'second person withheld');
  });

  test('a "fraud" event type also triggers the arrest/defamation control', () => {
    const fraud = arrestRow({
      eventType: 'fraud',
      summary: 'The EFCC charged a suspect with fraud',
      entities: [{ role: 'mentioned', entity: { type: 'person_role', canonicalName: 'Ngozi Eze' } }],
    });
    const { created } = planF7([fraud], { tier: 'public' });
    assert.equal(created.length, 1);
    assert.ok(!created[0].body.includes('Ngozi Eze'));
  });

  test('gate is deterministic: it refuses a hand-supplied body that leaks an entity name', () => {
    assert.throws(
      () =>
        assertPublishable(
          { eventType: 'arrest' },
          7,
          'public',
          { body: 'An arrest — Chinedu Okafor — Lagos — EFCC.', entities: [{ type: 'person_role', name: 'Chinedu Okafor' }] },
        ),
      (err) => err instanceof GateError && err.code === 'named_individual_in_public_arrest',
    );
  });

  test('DEFECT-REPRO: a person name present ONLY in the title/summary (no matching person entity) leaks into the public body', () => {
    // Adversarial case from the brief: the name is embedded in the title, and the
    // understanding layer did NOT emit a person_role entity for it. The renderer
    // only scrubs forbidden WORDS from the "what" slot; it does not withhold
    // unknown names, and gate 2 only knows names that appear as person_role
    // entities. So the name reaches the highest-reach surface.
    const row = arrestRow({
      title: 'EFCC arrests Chinedu Okafor over alleged fintech fraud',
      summary: 'The EFCC has arrested Chinedu Okafor over an alleged fintech fraud',
      // entity list intentionally omits the person:
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
    });

    const { created, refused } = planF7([row], { tier: 'public' });

    // This is the acceptance-criteria assertion. It currently FAILS, demonstrating
    // the defect. Do not weaken it: the public tier must not expose the name.
    const leakedBody = created[0]?.body ?? '(nothing created)';
    assert.equal(
      refused.length,
      1,
      `a public arrest item whose body names an individual must be refused. leaked body: ${JSON.stringify(leakedBody)}`,
    );
    assert.equal(created.length, 0, 'no public publish item may be created when it names an arrestee');
  });

  test('the public descriptor fallback never itself contains a person name', () => {
    // NEW CONTRACT (defect R2 #4 — STRENGTHENED): the fallback descriptor is a
    // FIXED, name-free phrase. It must NOT be built as "an employee of <org>",
    // because the org/agency label comes from the untrusted LLM understanding
    // layer and could itself be a mislabelled person. We therefore assert the
    // fixed generic phrase and, critically, that the descriptor is name-free.
    const row = arrestRow({
      publicDescriptor: undefined, // force the generic fallback
      entities: [
        { role: 'mentioned', entity: { type: 'person_role', canonicalName: 'Chinedu Okafor' } },
        { role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } },
      ],
    });
    const { created } = planF7([row], { tier: 'public' });
    assert.equal(created.length, 1);
    // The name-free fallback is emitted verbatim...
    assert.ok(
      created[0].body.includes('an unnamed individual'),
      `expected the name-free fallback descriptor in body: ${JSON.stringify(created[0].body)}`,
    );
    // ...and it was NOT interpolated with the untrusted org/agency label.
    assert.ok(
      !created[0].body.includes('an employee of'),
      'the descriptor must not be built from an untrusted org/agency label',
    );
    assert.ok(!created[0].body.includes('Chinedu Okafor'));
    // No surviving person-like token anywhere in the body, once the TRUSTED
    // non-person tokens (region "Lagos", the EFCC source registry, function
    // words) are accounted for. Anything left would be a possible name.
    assert.deepEqual(
      findPersonLikeNames(created[0].body, knownNonPersonTokens(row)),
      [],
      `body must be free of person-like tokens: ${JSON.stringify(created[0].body)}`,
    );
  });

  test('a VETTED publicDescriptor supplies a name-free sector phrase (trusted path, not an entity label)', () => {
    // Positive control: a legitimately-safe org/role context may be expressed via
    // the TRUSTED, caller-supplied `publicDescriptor` (vetted name-free string),
    // never via an untrusted `organisation`/`agency` entity label.
    const row = arrestRow({
      publicDescriptor: 'a Lagos fintech executive',
      entities: [
        { role: 'mentioned', entity: { type: 'person_role', canonicalName: 'Chinedu Okafor' } },
        { role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } },
      ],
    });
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(refused.length, 0, `a vetted descriptor must not be refused: ${JSON.stringify(refused)}`);
    assert.equal(created.length, 1);
    assert.ok(created[0].body.includes('a Lagos fintech executive'));
    assert.ok(!created[0].body.includes('Chinedu Okafor'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. FORBIDDEN PRE-CONVICTION WORDS — adversarial injection via every slot.
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: forbidden pre-conviction words cannot reach public output', () => {
  const FORBIDDEN = ['fraudster', 'culprit', 'scammer', 'criminal', 'hacker', 'thief', 'guilty', 'mastermind'];

  function publicBody({ title = '', summary = '', whatItMeans = '', region = '', entities = [] } = {}) {
    const { body } = renderF7(
      { title, summary, whatItMeans, region, canonicalUrl: 'https://x.example/a', eventType: 'arrest' },
      { sources: [{ name: 'Press' }], entities, tier: 'public' },
    );
    return body;
  }

  test('forbidden words in the SUMMARY are scrubbed', () => {
    const body = publicBody({ summary: 'Police say the scammer and the culprit defrauded a bank and the mastermind fled' });
    for (const w of FORBIDDEN) {
      assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(body), `leaked "${w}" from summary`);
    }
  });

  test('forbidden words in the TITLE (used when summary is empty) are scrubbed', () => {
    const body = publicBody({ summary: '', title: 'Hacker and thief and fraudster arrested in Lagos' });
    for (const w of FORBIDDEN) {
      assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(body), `leaked "${w}" from title`);
    }
  });

  test('forbidden words in whatItMeans (used when summary and title are empty) are scrubbed', () => {
    const body = publicBody({ summary: '', title: '', whatItMeans: 'The criminal was guilty, a mastermind scammer' });
    for (const w of FORBIDDEN) {
      assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(body), `leaked "${w}" from whatItMeans`);
    }
  });

  test('forbidden words in the WHERE slot (region) are scrubbed', () => {
    const body = publicBody({ summary: 'An incident', region: 'the fraudster quarter' });
    for (const w of FORBIDDEN) {
      assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(body), `leaked "${w}" from region`);
    }
  });

  test('greedy capture phrases do not slip through (e.g. "cyber criminal", "fraudster-mastermind")', () => {
    const body = publicBody({ summary: 'A cyber criminal and a fraudster–mastermind were arrested' });
    for (const w of FORBIDDEN) {
      assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(body), `leaked "${w}" in a compound phrase`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ATTRIBUTION + SOURCE LINK.
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: attribution and source link', () => {
  test('the source outlet/agency appears in the body and the canonical link is present', () => {
    const { body } = renderF7(
      {
        summary: 'The EFCC arrested a suspect',
        canonicalUrl: 'https://efcc.gov.ng/statement/9',
        eventType: 'arrest',
        publicDescriptor: 'a bank employee',
      },
      { sources: [{ name: 'EFCC' }], entities: [{ type: 'person_role', name: 'Some Person' }], tier: 'public' },
    );
    assert.ok(body.includes('EFCC'), 'allegation must be attributed to the agency/outlet');
    assert.ok(body.includes('https://efcc.gov.ng/statement/9'), 'source link must be present');
  });

  test('an event with no canonical URL still renders (link absent) — flagged, not fabricated', () => {
    const { body } = renderF7(
      { summary: 'A notice', eventType: 'advisory' },
      { sources: [{ name: 'Agency' }] },
    );
    assert.ok(!body.includes('('), 'no fabricated link when canonicalUrl is absent');
    assert.ok(body.includes('Agency'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. PROJECTION — planF7 invariants (pure, no I/O).
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: F7 projection plan', () => {
  const row = (overrides = {}) => ({
    id: 'evt-1',
    title: 'A regulator issued an advisory',
    summary: 'The regulator issued a consumer advisory',
    whatItMeans: '',
    canonicalUrl: 'https://reg.example/a',
    region: 'Abuja',
    eventType: 'advisory',
    functions: [7],
    sources: [
      { rawDocument: { url: 'https://reg.example/a', source: { name: 'Regulator', licenceStatus: 'verified', paywall: false } } },
    ],
    entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
    ...overrides,
  });

  test('a planned item carries no publishedAt field at all (never auto-publishes)', () => {
    const { created } = planF7([row()], { tier: 'public' });
    assert.equal(created.length, 1);
    assert.ok(!Object.prototype.hasOwnProperty.call(created[0], 'publishedAt'), 'plan must not set publishedAt');
    assert.equal(created[0].requiresHumanApproval, true);
  });

  test('a denied-licence event is refused regardless of tier', () => {
    for (const tier of ['public', 'paid']) {
      const { created, refused } = planF7(
        [row({ sources: [{ rawDocument: { url: 'u', source: { name: 'X', licenceStatus: 'denied', paywall: false } } }] })],
        { tier },
      );
      assert.equal(created.length, 0, `tier ${tier}`);
      assert.equal(refused[0].code, 'licence_denied');
    }
  });

  test('mixed batch: the eligible item is created and the denied one is refused in one pass', () => {
    const ok = row({ id: 'ok' });
    const bad = row({ id: 'bad', sources: [{ rawDocument: { url: 'u', source: { name: 'X', licenceStatus: 'denied' } } }] });
    const { created, refused } = planF7([ok, bad], { tier: 'public' });
    assert.deepEqual(created.map((c) => c.eventId), ['ok']);
    assert.deepEqual(refused.map((r) => r.eventId), ['bad']);
  });

  test('planF7 is pure: the same input produces the same output on re-run (idempotent planning)', () => {
    const a = planF7([row()], { tier: 'public' });
    const b = planF7([row()], { tier: 'public' });
    assert.deepEqual(a.created, b.created);
    assert.deepEqual(a.refused, b.refused);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. APPROVAL API — authorize on the session, not the body; denied paths.
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: approval API authorization', () => {
  const baseItem = {
    id: 'pi-1',
    eventId: 'evt-1',
    functionId: 7,
    tier: 'public',
    body: 'A notice — Regulator — Abuja — Regulator (https://reg.example/a).',
    templateVersion: 'f7@1.0.0',
    editorId: 'projector',
    approvedAt: new Date('2026-11-01T00:00:00Z'),
    publishedAt: null,
    withdrawnAt: null,
  };

  test('an ADMIN session approves; editorId + approvedAt come from the session/clock, not the body', async () => {
    const store = makeStore([baseItem]);
    const { payload, statusCode } = await withPrisma(store, () =>
      callController(approvePublishItem, {
        params: { id: 'pi-1' },
        user: { id: 'admin-1', role: 'ADMIN' },
        // Adversarial: a client tries to set identity + status in the body.
        body: { editor_id: 'attacker', editorId: 'attacker', status: 'published', publishedAt: '2000-01-01T00:00:00Z' },
      }),
    );

    assert.equal(statusCode, 200);
    assert.equal(store.items[0].editorId, 'admin-1', 'editorId must come from the session');
    assert.notEqual(store.items[0].editorId, 'attacker', 'client-supplied editor_id must be ignored');
    assert.equal(payload.item.editorId, 'admin-1');
    assert.equal(store.items[0].publishedAt, null, 'approval must NOT publish');
  });

  test('a client-supplied editor_id cannot override the session even when the session id is set', async () => {
    const store = makeStore([{ ...baseItem, editorId: 'original' }]);
    await withPrisma(store, () =>
      callController(approvePublishItem, {
        params: { id: 'pi-1' },
        user: { id: 'real-admin', role: 'ADMIN' },
        body: { editor_id: 'spoofed' },
      }),
    );
    assert.equal(store.items[0].editorId, 'real-admin');
  });

  test('ANY authenticated role (SENDER / VIEWER) may approve; only a missing session is rejected', async () => {
    // Owner decision 2026-11-18: social team is internal; any authenticated user
    // may act. The former ADMIN-only 403 gate was deliberately relaxed.
    for (const role of ['SENDER', 'VIEWER', 'EDITOR', 'user', 'ADMIN']) {
      const store = makeStore([{ ...baseItem, editorId: 'original' }]);
      const { statusCode } = await withPrisma(store, () =>
        callController(approvePublishItem, { params: { id: 'pi-1' }, user: { id: 'u-1', role } }),
      );
      assert.equal(statusCode, 200, `role ${String(role)} should now be allowed`);
      assert.equal(store.items[0].editorId, 'u-1', `role ${String(role)} acts as the session user`);
    }
  });

  test('a request with NO session (no req.user.id) is still rejected', async () => {
    // Identity must come from the session; an unauthenticated call is refused.
    for (const user of [undefined, null, {}, { role: 'ADMIN' }]) {
      const store = makeStore([{ ...baseItem, editorId: 'original' }]);
      const { error } = await withPrisma(store, () =>
        callController(approvePublishItem, { params: { id: 'pi-1' }, user }),
      );
      assert.ok(error, `user ${JSON.stringify(user)} must be rejected`);
      assert.equal(error.statusCode, 403, `user ${JSON.stringify(user)} should be 403`);
      assert.equal(store.items[0].editorId, 'original', 'a refused call must not mutate the row');
    }
  });

  test('approving a NON-EXISTENT id returns 404', async () => {
    const store = makeStore([]);
    const { error } = await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'nope' }, user: { id: 'admin-1', role: 'ADMIN' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 404);
  });

  test('approving a WITHDRAWN item is refused with 400 (denied path)', async () => {
    const store = makeStore([{ ...baseItem, withdrawnAt: new Date('2026-11-02T00:00:00Z') }]);
    const { error } = await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'pi-1' }, user: { id: 'admin-1', role: 'ADMIN' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 400);
  });

  test('DOUBLE-APPROVE: a second approval does not publish and does not throw (documents current behaviour)', async () => {
    const store = makeStore([baseItem]);
    await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'pi-1' }, user: { id: 'admin-1', role: 'ADMIN' } }),
    );
    const second = await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'pi-1' }, user: { id: 'admin-2', role: 'ADMIN' } }),
    );
    // The critical invariant: an approve never flips publishedAt.
    assert.equal(store.items[0].publishedAt, null, 'double-approve must never publish');
    assert.equal(second.statusCode, 200, 'current behaviour: re-approve is allowed (no conflict guard)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. WITHDRAW — sets withdrawnAt, session identity, denied paths.
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: withdraw', () => {
  const item = {
    id: 'pi-2',
    eventId: 'evt-2',
    functionId: 7,
    tier: 'public',
    body: 'b',
    templateVersion: 'f7@1.0.0',
    editorId: 'projector',
    approvedAt: new Date('2026-11-01T00:00:00Z'),
    publishedAt: null,
    withdrawnAt: null,
  };

  test('withdraw sets withdrawnAt and records the session editor', async () => {
    const store = makeStore([item]);
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(withdrawPublishItem, { params: { id: 'pi-2' }, user: { id: 'admin-9', role: 'ADMIN' } }),
    );
    assert.equal(statusCode, 200);
    assert.ok(store.items[0].withdrawnAt instanceof Date, 'withdrawnAt must be set');
    assert.equal(store.items[0].editorId, 'admin-9');
    assert.equal(payload.item.status, 'withdrawn');
  });

  test('any authenticated role may withdraw (VIEWER allowed; owner decision 2026-11-18)', async () => {
    // Policy change 2026-11-18: the social team is internal; the former
    // ADMIN-only withdraw gate was deliberately relaxed to ANY authenticated user.
    const store = makeStore([item]);
    const { statusCode } = await withPrisma(store, () =>
      callController(withdrawPublishItem, { params: { id: 'pi-2' }, user: { id: 'viewer', role: 'VIEWER' } }),
    );
    assert.equal(statusCode, 200);
    assert.ok(store.items[0].withdrawnAt instanceof Date, 'withdrawnAt must be set');
    assert.equal(store.items[0].editorId, 'viewer');
  });

  test('withdrawing a non-existent id returns 404', async () => {
    const store = makeStore([]);
    const { error } = await withPrisma(store, () =>
      callController(withdrawPublishItem, { params: { id: 'ghost' }, user: { id: 'a', role: 'ADMIN' } }),
    );
    assert.equal(error.statusCode, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9b. REJECT + EDIT — owner decision 2026-11-18 additions.
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: reject', () => {
  const draftItem = {
    id: 'pi-rj',
    eventId: 'evt-rj',
    functionId: 7,
    tier: 'public',
    body: 'b',
    templateVersion: 'f7@1.0.0',
    editorId: undefined,
    approvedAt: null,
    rejectedAt: null,
    publishedAt: null,
    withdrawnAt: null,
  };

  test('reject sets rejectedAt, records the session editor, and reports status "rejected"', async () => {
    const store = makeStore([draftItem]);
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(rejectPublishItem, {
        params: { id: 'pi-rj' },
        user: { id: 'u-1', role: 'VIEWER' },
        body: { editorId: 'attacker', status: 'published' },
      }),
    );
    assert.equal(statusCode, 200);
    assert.ok(store.items[0].rejectedAt instanceof Date, 'rejectedAt must be set');
    assert.equal(store.items[0].editorId, 'u-1', 'identity must come from the session, not the body');
    assert.equal(payload.item.status, 'rejected');
  });

  test('rejecting a PUBLISHED item is refused (409) and nothing is written', async () => {
    const store = makeStore([{ ...draftItem, publishedAt: new Date('2026-11-05T00:00:00Z') }]);
    const { error } = await withPrisma(store, () =>
      callController(rejectPublishItem, { params: { id: 'pi-rj' }, user: { id: 'u-1', role: 'ADMIN' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 409, 'a live publication must use the corrections path');
    assert.equal(store.items[0].rejectedAt, null, 'a refused reject must not mutate the row');
  });

  test('rejecting a non-existent id returns 404', async () => {
    const store = makeStore([]);
    const { error } = await withPrisma(store, () =>
      callController(rejectPublishItem, { params: { id: 'ghost' }, user: { id: 'u-1', role: 'ADMIN' } }),
    );
    assert.equal(error.statusCode, 404);
  });

  test('reject with no session is rejected (identity must come from the session)', async () => {
    const store = makeStore([draftItem]);
    const { error } = await withPrisma(store, () =>
      callController(rejectPublishItem, { params: { id: 'pi-rj' }, user: undefined }),
    );
    assert.equal(error.statusCode, 403);
  });
});

describe('QA: edit body', () => {
  const approvedItem = {
    id: 'pi-ed',
    eventId: 'evt-ed',
    functionId: 7,
    tier: 'public',
    body: 'original body',
    templateVersion: 'f7@1.0.0',
    editorId: 'approver-1',
    approvedAt: new Date('2026-11-01T00:00:00Z'),
    rejectedAt: null,
    publishedAt: null,
    withdrawnAt: null,
  };

  test('edit updates body ONLY and leaves approvedAt/editorId untouched', async () => {
    const store = makeStore([approvedItem]);
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(editPublishItem, {
        params: { id: 'pi-ed' },
        user: { id: 'editor-2', role: 'SENDER' },
        body: { body: 'corrected body', editorId: 'attacker', approvedAt: '2000-01-01T00:00:00Z' },
      }),
    );
    assert.equal(statusCode, 200);
    assert.equal(store.items[0].body, 'corrected body', 'body must be updated');
    assert.equal(store.items[0].editorId, 'approver-1', 'editorId must NOT be changed by an edit');
    assert.ok(store.items[0].approvedAt instanceof Date, 'approvedAt must NOT be changed by an edit');
    assert.equal(payload.item.body, 'corrected body');
  });

  test('edit allows draft and rejected items', async () => {
    for (const seed of [{ approvedAt: null, rejectedAt: null }, { approvedAt: null, rejectedAt: new Date('2026-11-06T00:00:00Z') }]) {
      const store = makeStore([{ ...approvedItem, ...seed }]);
      const { statusCode } = await withPrisma(store, () =>
        callController(editPublishItem, { params: { id: 'pi-ed' }, user: { id: 'e', role: 'VIEWER' }, body: { body: 'new' } }),
      );
      assert.equal(statusCode, 200);
      assert.equal(store.items[0].body, 'new');
    }
  });

  test('editing a PUBLISHED item is refused (409) and the body is unchanged', async () => {
    const store = makeStore([{ ...approvedItem, publishedAt: new Date('2026-11-05T00:00:00Z') }]);
    const { error } = await withPrisma(store, () =>
      callController(editPublishItem, { params: { id: 'pi-ed' }, user: { id: 'e', role: 'ADMIN' }, body: { body: 'hijack' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 409, 'publications are immutable; use the corrections path');
    assert.equal(store.items[0].body, 'original body');
  });

  test('edit rejects an empty body (validation) and a non-existent id (404)', async () => {
    const store = makeStore([approvedItem]);
    const { error: emptyErr } = await withPrisma(store, () =>
      callController(editPublishItem, { params: { id: 'pi-ed' }, user: { id: 'e', role: 'ADMIN' }, body: { body: '' } }),
    );
    assert.ok(emptyErr, 'an empty body must fail validation');

    const empty = makeStore([]);
    const { error: missingErr } = await withPrisma(empty, () =>
      callController(editPublishItem, { params: { id: 'ghost' }, user: { id: 'e', role: 'ADMIN' }, body: { body: 'x' } }),
    );
    assert.equal(missingErr.statusCode, 404);
  });
});

describe('QA: deriveStatus precedence (withdrawn > published > rejected > approved > draft)', () => {
  const base = { approvedAt: null, rejectedAt: null, publishedAt: null, withdrawnAt: null };

  test('draft when no timestamps are set', () => {
    assert.equal(deriveStatus({ ...base }), 'draft');
  });

  test('approved beats nothing below it, rejected beats approved', () => {
    assert.equal(deriveStatus({ ...base, approvedAt: new Date() }), 'approved');
    assert.equal(deriveStatus({ ...base, approvedAt: new Date(), rejectedAt: new Date() }), 'rejected');
  });

  test('published beats rejected', () => {
    assert.equal(deriveStatus({ ...base, rejectedAt: new Date(), publishedAt: new Date() }), 'published');
  });

  test('withdrawn beats everything', () => {
    assert.equal(
      deriveStatus({ approvedAt: new Date(), rejectedAt: new Date(), publishedAt: new Date(), withdrawnAt: new Date() }),
      'withdrawn',
    );
  });

  test('the default list bucket excludes rejected items', async () => {
    const store = makeStore([
      { id: 'd', functionId: 7, tier: 'public', approvedAt: null, rejectedAt: null, publishedAt: null, withdrawnAt: null },
      { id: 'r', functionId: 7, tier: 'public', approvedAt: null, rejectedAt: new Date('2026-11-06T00:00:00Z'), publishedAt: null, withdrawnAt: null },
    ]);
    const { payload } = await withPrisma(store, () =>
      callController(listPublishItems, { query: {}, user: { id: 'u', role: 'VIEWER' } }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['d'], 'rejected items must not appear in the default bucket');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. PROJECTION ENDPOINT + IDEMPOTENCY (controller over the stub store).
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: projection endpoint', () => {
  const event = {
    id: 'evt-10',
    title: 'A regulator issued a notice',
    summary: 'The regulator issued a notice',
    whatItMeans: '',
    canonicalUrl: 'https://reg.example/n',
    region: 'Abuja',
    eventType: 'advisory',
    functions: [7],
    publishedAt: new Date('2026-11-01T00:00:00Z'),
    sources: [{ rawDocument: { url: 'https://reg.example/n', source: { name: 'Regulator', licenceStatus: 'verified', paywall: false } } }],
    entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
  };

  test('dry-run (default) writes NO publish item and reports the plan', async () => {
    const store = makeStore([], [event]);
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(projectF7Items, { user: { id: 'admin-1', role: 'ADMIN' }, body: {} }),
    );
    assert.equal(statusCode, 200);
    assert.equal(payload.mode, 'dry-run');
    assert.equal(store.items.length, 0, 'dry-run must not write');
    assert.equal(payload.results.planned.length, 1);
  });

  test('commit writes a draft row with publishedAt null', async () => {
    const store = makeStore([], [event]);
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(projectF7Items, { user: { id: 'admin-1', role: 'ADMIN' }, body: { commit: true } }),
    );
    assert.equal(statusCode, 201);
    assert.equal(payload.mode, 'commit');
    assert.equal(store.items.length, 1);
    assert.equal(store.items[0].publishedAt, null, 'committed draft must not be published');
  });

  test('re-projection is idempotent: an event already projected at the tier is not selected again', async () => {
    const store = makeStore([], [event]);
    await withPrisma(store, () =>
      callController(projectF7Items, { user: { id: 'admin-1', role: 'ADMIN' }, body: { commit: true } }),
    );
    assert.equal(store.items.length, 1);

    // Second run: the existing publish_item for (functionId 7, tier public, eventId)
    // must exclude the event from selection, so nothing new is written.
    const second = await withPrisma(store, () =>
      callController(projectF7Items, { user: { id: 'admin-1', role: 'ADMIN' }, body: { commit: true } }),
    );
    assert.equal(second.payload.candidates, 0, 're-projection must find no new candidates');
    assert.equal(store.items.length, 1, 're-projection must not create a duplicate');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. LIST — the default view is awaiting-approval, not published.
// ─────────────────────────────────────────────────────────────────────────────

describe('QA: list publish items', () => {
  test('the default listing excludes published and withdrawn items', async () => {
    const store = makeStore([
      { id: 'd1', functionId: 7, tier: 'public', approvedAt: new Date(), publishedAt: null, withdrawnAt: null },
      { id: 'p1', functionId: 7, tier: 'public', approvedAt: new Date(), publishedAt: new Date(), withdrawnAt: null },
      { id: 'w1', functionId: 7, tier: 'public', approvedAt: new Date(), publishedAt: null, withdrawnAt: new Date() },
    ]);
    const { payload } = await withPrisma(store, () =>
      callController(listPublishItems, { query: {} }),
    );
    assert.deepEqual(payload.items.map((i) => i.id), ['d1']);
  });

  test('status=published returns only published items', async () => {
    const store = makeStore([
      { id: 'd1', functionId: 7, tier: 'public', approvedAt: new Date(), publishedAt: null, withdrawnAt: null },
      { id: 'p1', functionId: 7, tier: 'public', approvedAt: new Date(), publishedAt: new Date(), withdrawnAt: null },
    ]);
    const { payload } = await withPrisma(store, () => callController(listPublishItems, { query: { status: 'published' } }));
    assert.deepEqual(payload.items.map((i) => i.id), ['p1']);
  });

  test('an invalid status value is rejected by validation', async () => {
    const store = makeStore([]);
    const { error } = await withPrisma(store, () => callController(listPublishItems, { query: { status: 'bogus' } }));
    assert.ok(error, 'invalid status must be rejected');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. RE-VERIFICATION OF THE D1 FIX — adversarial cases for the NEW heuristic
//     person-like detector (`findPersonLikeNames`) and the secondary arrest
//     signal. These are INDEPENDENT of the implementer's own regression suite.
// ─────────────────────────────────────────────────────────────────────────────

describe('QA re-verify D1: adversarial person-like name detection', () => {
  function arrestRow(overrides = {}) {
    return {
      id: 'evt-adv',
      title: 'EFCC arrests suspect over fintech fraud',
      summary: 'The EFCC said it arrested a suspect over an alleged fintech fraud',
      whatItMeans: '',
      canonicalUrl: 'https://efcc.gov.ng/s/1',
      region: 'Lagos',
      eventType: 'arrest',
      sources: [
        { rawDocument: { url: 'https://efcc.gov.ng/s/1', source: { name: 'EFCC', licenceStatus: 'verified', paywall: false } } },
      ],
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
      ...overrides,
    };
  }

  test('ADV-1: a name present ONLY in whatItMeans (no person entity) is refused, not leaked', () => {
    const row = arrestRow({
      summary: '',
      title: '',
      whatItMeans: 'The EFCC detained Chinedu Okafor over an alleged fintech fraud',
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
    });
    const { created, refused } = planF7([row], { tier: 'public' });
    const leaked = created[0]?.body ?? '(nothing created)';
    assert.equal(refused.length, 1, `whatItMeans name must be refused; body: ${JSON.stringify(leaked)}`);
    assert.equal(refused[0].code, 'named_individual_in_public_arrest');
    assert.equal(created.length, 0);
    assert.ok(!String(leaked).includes('Chinedu Okafor'), 'the name must never reach the created body');
  });

  test('ADV-2: a TWO-name item ("Chinedu Okafor and Ada Nwosu") is refused and both names leak nowhere', () => {
    const row = arrestRow({
      title: 'EFCC arrests Chinedu Okafor and Ada Nwosu over alleged fintech fraud',
      summary: 'The EFCC has arrested Chinedu Okafor and Ada Nwosu over an alleged fintech fraud',
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
    });
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(refused.length, 1, `two-name item must be refused`);
    assert.equal(refused[0].code, 'named_individual_in_public_arrest');
    assert.equal(created.length, 0);
  });

  test('ADV-2b: the detector finds EVERY name token in a two-name string (unit level)', () => {
    // NEW CONTRACT (defect R2 #2 — STRENGTHENED): the detector no longer requires
    // an adjacent Titlecase PAIR. It reports each capitalized, unknown,
    // non-function token independently, so it also catches MONONYMS. The security
    // property preserved is that BOTH individuals' tokens ARE detected (hence the
    // item is refused); joining them into pairs was never the security guarantee.
    const tokens = findPersonLikeNames('Chinedu Okafor and Ada Nwosu were detained', new Set());
    for (const name of ['Chinedu', 'Okafor', 'Ada', 'Nwosu']) {
      assert.ok(tokens.includes(name), `expected token "${name}" in ${JSON.stringify(tokens)}`);
    }
    // The function words "and"/"were" are not reported as names.
    assert.ok(!tokens.includes('And'), `"And" is not a person name: ${JSON.stringify(tokens)}`);
    assert.ok(!tokens.includes('Were'), `"Were" is not a person name: ${JSON.stringify(tokens)}`);
  });

  test('ADV-2c: a MONONYM (single capitalized unknown token) is detected', () => {
    // NEW CONTRACT (defect R2 #2): a single-token name like "Madonna" must be
    // flagged now that the adjacent-pair requirement is gone.
    const tokens = findPersonLikeNames('Police detained Madonna in Lagos', new Set());
    assert.ok(tokens.includes('Madonna'), `mononym must be detected: ${JSON.stringify(tokens)}`);
  });

  test('ADV-2d: a NON-ASCII name (Chinédu) is detected as ONE token (Unicode-aware)', () => {
    // NEW CONTRACT (defect R2 #1): the old ASCII-only regex split "Chinédu" into
    // "Chin"+"du" so no pair matched and non-ASCII names leaked. The Unicode-aware
    // tokenizer treats it as a single token.
    const tokens = findPersonLikeNames('The EFCC detained Chinédu over an alleged fraud', new Set());
    assert.ok(tokens.includes('Chinédu'), `non-ASCII name must be detected: ${JSON.stringify(tokens)}`);
  });

  test('ADV-3: an `organisation` entity label is NOT trusted, so an unknown Titlecase phrase is refused (fail-closed)', () => {
    // NEW CONTRACT (defect R2 #3 — STRENGTHENED): the old contract treated a
    // non-`person_role` entity label ("Zenith Bank" typed as `organisation`) as a
    // safe allow-list and CREATED the item. That trust was the leak: the same
    // label comes from the untrusted LLM understanding layer, so a person
    // mislabelled `organisation` would be published verbatim. The new contract
    // trusts ONLY reviewed code data (the `sources.js` registry), a geographic
    // constant, `event.region`/`location`, and a vetted `event.publicDescriptor`.
    // An unknown Titlecase token ("Zenith") therefore DENIES. Over-blocking is the
    // accepted failure direction; a false deny is reviewed, a leak is not.
    const row = arrestRow({
      title: 'EFCC detains suspect over alleged fraud at Zenith Bank',
      summary: 'The EFCC detained a suspect over an alleged fraud at Zenith Bank',
      entities: [
        { role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } },
        // Adversarial: the mislabel-prone `organisation` type must NOT rescue this.
        { role: 'mentioned', entity: { type: 'organisation', canonicalName: 'Zenith Bank' } },
      ],
    });
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(created.length, 0, 'an untrusted org label must NOT make the item publishable');
    assert.equal(refused.length, 1);
    assert.equal(refused[0].code, 'named_individual_in_public_arrest');
    assert.equal(refused[0].details?.reason, 'person_like_token');
    assert.ok(
      refused[0].details?.leaked?.includes('Zenith'),
      `the unknown Titlecase token must be the offender: ${JSON.stringify(refused[0].details)}`,
    );
  });

  test('ADV-3c (POSITIVE CONTROL, trusted path): an org from the reviewed sources.js registry is safe', () => {
    // The legitimate way to reference an organisation is the TRUSTED path: a name
    // present in the reviewed `sources.js` registry (code data, not model output).
    // "Vanguard" is a registry outlet, so its Titlecase token is allow-listed and
    // the item publishes. This proves the new contract blocks only the UNTRUSTED
    // (entity-label) path, not legitimate org references.
    const row = arrestRow({
      title: 'EFCC detains suspect over alleged fraud reported by Vanguard',
      summary: 'The EFCC detained a suspect over an alleged fraud reported by Vanguard',
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
    });
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(refused.length, 0, `a registry org must not false-deny: ${JSON.stringify(refused)}`);
    assert.equal(created.length, 1);
    assert.ok(created[0].body.includes('Vanguard'), 'the trusted registry org name may appear');
  });

  test('ADV-3b (FALSE-POSITIVE, documented trade-off): an UNKNOWN two-word org in prose is refused', () => {
    // "Zenith Bank" appears in prose but is NOT a known entity/agency/region.
    // The detector cannot distinguish it from a personal name, so it DENIES.
    // This is the accepted fail-closed trade-off (an editor can review); we pin
    // it so a future regression that starts LEAKING is caught.
    const row = arrestRow({
      title: 'EFCC detains suspect over alleged fraud at Zenith Bank',
      summary: 'The EFCC detained a suspect over an alleged fraud at Zenith Bank',
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
    });
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(created.length, 0, 'unknown two-word org is denied (documented false positive)');
    assert.equal(refused[0].code, 'named_individual_in_public_arrest');
    assert.equal(refused[0].details?.reason, 'person_like_token');
  });

  test('ADV-4: an ALL-CAPS acronym (EFCC) is NOT treated as a person name and does not false-deny', () => {
    // Unit level: the acronym must not be reported as a person-like token.
    assert.deepEqual(findPersonLikeNames('EFCC and NCC issued a notice', new Set()), []);
    // End-to-end: an agency-only arrest whose text contains the acronym passes.
    const row = arrestRow({
      title: 'EFCC arrests suspect over fintech fraud',
      summary: 'The EFCC has arrested a suspect over an alleged fintech fraud',
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
    });
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(refused.length, 0, `EFCC acronym must not false-deny: ${JSON.stringify(refused)}`);
    assert.equal(created.length, 1);
  });

  test('ADV-5: an arrest signalled ONLY by a verb, eventType NOT arrest, still triggers the name control', () => {
    // eventType 'advisory' (NOT arrest) but the text says "detained".
    const row = arrestRow({
      eventType: 'advisory',
      title: 'Police detain suspect over alleged fraud',
      summary: 'Police detained Chinedu Okafor over an alleged fraud in Lagos',
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
    });
    assert.equal(isArrestItem(row), true, 'the text verb must classify this as arrest-like');
    const { created, refused } = planF7([row], { tier: 'public' });
    const leaked = created[0]?.body ?? '(nothing created)';
    assert.equal(refused.length, 1, `verb-only arrest must be refused; body: ${JSON.stringify(leaked)}`);
    assert.equal(refused[0].code, 'named_individual_in_public_arrest');
    assert.equal(created.length, 0);
  });

  test('ADV-5b: each arrest verb (detained/charged/arraigned) with eventType NOT arrest triggers control', () => {
    for (const verb of ['detained', 'charged', 'arraigned']) {
      const row = arrestRow({
        eventType: 'policy', // deliberately NOT an arrest/fraud type
        title: `EFCC ${verb} suspect over alleged fraud`,
        summary: `The EFCC ${verb} Chinedu Okafor over an alleged fraud`,
        entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'EFCC' } }],
      });
      assert.equal(isArrestItem(row), true, `"${verb}" must signal arrest`);
      const { created, refused } = planF7([row], { tier: 'public' });
      assert.equal(refused.length, 1, `verb "${verb}" must trigger the name control`);
      assert.equal(created.length, 0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. NEW DEFECT D8 — arrest verb in a NON-FIRT non-empty field is ignored.
//
// `isArrestItem` tests an arrest verb only against the FIRST non-empty of
// (summary, whatItMeans, title, body). When the understanding layer places the
// NAME in `summary` and the arrest VERB in `title` (summary is verb-free), the
// item is NOT classified arrest-like, gate 3 never runs, and the name reaches
// the public-tier body. This is the D1 class re-opened through a different field.
//
// The test below is intentionally FAILING: it asserts the required behaviour.
// DO NOT weaken it — it is the regression proof for D8.
// ─────────────────────────────────────────────────────────────────────────────

describe('QA NEW DEFECT D8: arrest verb in a later field bypasses the name control', () => {
  test('D8-REPRO: name in summary + verb only in title is (wrongly) published to the public tier', () => {
    const row = {
      id: 'evt-d8',
      // The VERB lives only in the title...
      title: 'Police detained a suspect over an alleged fintech fraud',
      // ...while the NAME lives in the summary (which wins the {what} slot and is verb-free).
      summary: 'Chinedu Okafor was involved in an alleged fintech fraud',
      whatItMeans: '',
      canonicalUrl: 'https://x.example/a',
      region: 'Lagos',
      eventType: 'advisory', // deliberately not an arrest/fraud type
      functions: [7],
      sources: [{ rawDocument: { url: 'https://x.example/a', source: { name: 'X', licenceStatus: 'verified', paywall: false } } }],
      entities: [], // no person entity — the understanding layer missed it
    };

    const { created, refused } = planF7([row], { tier: 'public' });

    // REQUIRED: the item must be refused (arrest-like via the title verb).
    // ACTUAL (defect): created.length === 1 with the name in the body.
    const leaked = created[0]?.body ?? '(nothing created)';
    assert.ok(
      !String(leaked).includes('Chinedu Okafor'),
      `D8: the public-tier body must not name an individual. Leaked body: ${JSON.stringify(leaked)}`,
    );
    assert.equal(refused.length, 1, `D8: an arrest signalled by a verb in ANY field must be refused. leaked body: ${JSON.stringify(leaked)}`);
    assert.equal(created.length, 0);
  });

  test('D8-UNIT: isArrestItem must detect an arrest verb in a field other than the first non-empty', () => {
    // Verb only in the title; summary is a verb-free first non-empty field.
    const ev = {
      eventType: 'advisory',
      summary: 'Chinedu Okafor was involved in an alleged fintech fraud',
      title: 'Police detained a suspect over alleged fraud',
    };
    assert.equal(
      isArrestItem(ev),
      true,
      'D8: an arrest verb in the title must classify the item arrest-like even when a verb-free summary is present',
    );
  });
});

describe('QA re-verify D2: denied-path authorization (VIEWER cannot read non-public tiers or project)', () => {
  const paidItem = {
    id: 'paid-1',
    eventId: 'evt-paid',
    functionId: 7,
    tier: 'paid',
    body: 'A paid-tier body — Chinedu Okafor — Lagos — EFCC.',
    templateVersion: 'f7@1.0.0',
    editorId: 'projector',
    approvedAt: null,
    publishedAt: null,
    withdrawnAt: null,
  };

  test('any authenticated user may list the paid tier (tier masking relaxed; owner decision 2026-11-18)', async () => {
    // Policy change 2026-11-18: the social team is internal; list-tier masking was
    // deliberately relaxed. An authenticated VIEWER may now request paid tier.
    const store = makeStore([paidItem]);
    const { payload } = await withPrisma(store, () =>
      callController(listPublishItems, { query: { tier: 'paid' }, user: { id: 'v1', role: 'VIEWER' } }),
    );
    assert.equal(payload.items.length, 1, 'an authenticated VIEWER may now read the paid tier');
    assert.equal(payload.items[0].tier, 'paid');
  });

  test('an authenticated session with NO role may still retrieve non-public bodies', async () => {
    // Owner decision 2026-11-18: identity, not role, is what the gate checks.
    const store = makeStore([paidItem]);
    const { payload } = await withPrisma(store, () =>
      callController(listPublishItems, { query: { tier: 'paid' }, user: { id: 'x' } }),
    );
    assert.equal(payload.items.length, 1, 'a session id is enough; role is not required');
  });

  test('an unauthenticated direct call still fails closed to the public tier', async () => {
    // Fail-closed path retained: no session => public tier only.
    const store = makeStore([paidItem]);
    const { payload } = await withPrisma(store, () =>
      callController(listPublishItems, { query: { tier: 'paid' }, user: undefined }),
    );
    assert.deepEqual(payload.items, [], 'a session-less call must not receive a non-public body');
  });

  test('any authenticated user may trigger POST /api/publish/f7 (owner decision 2026-11-18)', async () => {
    // Policy change 2026-11-18: projecting is now allowed for ANY authenticated
    // user, not just ADMIN. The former VIEWER 403 gate was deliberately relaxed.
    const store = makeStore([], []);
    const { statusCode } = await withPrisma(store, () =>
      callController(projectF7Items, { user: { id: 'v1', role: 'VIEWER' }, body: { commit: false } }),
    );
    assert.equal(statusCode, 200, 'an authenticated VIEWER may now run a dry-run projection');
  });

  test('an administrator CAN retrieve the paid-tier body (positive control)', async () => {
    const store = makeStore([paidItem]);
    const { payload } = await withPrisma(store, () =>
      callController(listPublishItems, { query: { tier: 'paid' }, user: { id: 'a1', role: 'ADMIN' } }),
    );
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].tier, 'paid');
  });
});

describe('QA re-verify D3: projected row is a draft; only approve sets approvedAt', () => {
  test('a projected row reports status "draft" and has null approvedAt', () => {
    // Serialize the exact shape the projection writes (no approvedAt/editorId).
    const projected = {
      id: 'pi-new',
      eventId: 'evt-new',
      functionId: 7,
      tier: 'public',
      body: 'b',
      templateVersion: 'f7@1.0.0',
      editorId: undefined,
      approvedAt: null,
      publishedAt: null,
      withdrawnAt: null,
    };
    assert.equal(deriveStatus(projected), 'draft');
    assert.equal(projected.approvedAt, null);
  });

  test('only the approve endpoint sets approvedAt (the projector never does)', async () => {
    const store = makeStore([
      { id: 'pi-a', functionId: 7, tier: 'public', approvedAt: null, publishedAt: null, withdrawnAt: null, editorId: undefined },
    ]);
    const { payload } = await withPrisma(store, () =>
      callController(approvePublishItem, { params: { id: 'pi-a' }, user: { id: 'admin-1', role: 'ADMIN' } }),
    );
    assert.equal(payload.item.status, 'approved', 'the approve endpoint transitions draft -> approved');
    assert.ok(store.items[0].approvedAt instanceof Date, 'approvedAt is set by the approve endpoint');
    assert.equal(store.items[0].editorId, 'admin-1');
  });

  test('commit-projected rows over a stub store are drafts (approvedAt null, status draft)', async () => {
    const event = {
      id: 'evt-p', title: 'A regulator issued a notice', summary: 'The regulator issued a notice',
      whatItMeans: '', canonicalUrl: 'https://reg.example/n', region: 'Abuja', eventType: 'advisory',
      functions: [7],
      sources: [{ rawDocument: { url: 'https://reg.example/n', source: { name: 'Regulator', licenceStatus: 'verified', paywall: false } } }],
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
    };
    const store = makeStore([], [event]);
    await withPrisma(store, () => callController(projectF7Items, { user: { id: 'admin-1', role: 'ADMIN' }, body: { commit: true } }));
    assert.equal(store.items.length, 1);
    assert.equal(store.items[0].approvedAt, null, 'the projector must not set approvedAt');
    assert.equal(deriveStatus({ ...store.items[0] }), 'draft');
  });
});

describe('QA re-verify D4: denied licence at source index >= 1 blocks projection', () => {
  test('a denied licence at INDEX 1 (second source) refuses the event', () => {
    const row = {
      id: 'evt-2src',
      title: 'A regulator issued a notice',
      summary: 'The regulator issued a notice',
      whatItMeans: '',
      canonicalUrl: 'https://reg.example/n',
      region: 'Abuja',
      eventType: 'advisory',
      functions: [7],
      sources: [
        { rawDocument: { url: 'https://reg.example/n', source: { name: 'Regulator', licenceStatus: 'verified', paywall: false } } },
        { rawDocument: { url: 'https://blocked.example/n', source: { name: 'Blocked', licenceStatus: 'denied', paywall: false } } },
      ],
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
    };
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(created.length, 0, 'a denied licence at index >= 1 must block');
    assert.equal(refused.length, 1);
    assert.equal(refused[0].code, 'licence_denied');
  });

  test('a denied licence at the LAST index of a 3-source event also blocks', () => {
    const mk = (n, status) => ({ rawDocument: { url: `https://s${n}.example`, source: { name: `S${n}`, licenceStatus: status, paywall: false } } });
    const row = {
      id: 'evt-3src', title: 'A regulator issued a notice', summary: 'A notice', whatItMeans: '',
      canonicalUrl: 'https://reg.example/n', region: 'Abuja', eventType: 'advisory', functions: [7],
      sources: [mk(1, 'verified'), mk(2, 'unknown'), mk(3, 'DENIED')],
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
    };
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(created.length, 0);
    assert.equal(refused[0].code, 'licence_denied');
  });
});

describe('QA re-verify D5: no resolvable source link -> refused', () => {
  test('an item with NO canonicalUrl and NO source URL is refused by projection', () => {
    const row = {
      id: 'evt-nolink',
      title: 'A regulator issued a notice',
      summary: 'The regulator issued a notice',
      whatItMeans: '',
      canonicalUrl: null,
      region: 'Abuja',
      eventType: 'advisory',
      functions: [7],
      sources: [{ rawDocument: { url: null, source: { name: 'Regulator', licenceStatus: 'verified', paywall: false } } }],
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
    };
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(created.length, 0, 'a linkless item must be refused');
    assert.equal(refused[0].code, 'missing_source_link');
  });

  test('a whitespace-only canonicalUrl with no source URL is refused', () => {
    const row = {
      id: 'evt-ws', title: 'A notice', summary: 'A regulator issued a notice', whatItMeans: '',
      canonicalUrl: '   ', region: 'Abuja', eventType: 'advisory', functions: [7],
      sources: [{ rawDocument: { url: '', source: { name: 'Regulator', licenceStatus: 'verified', paywall: false } } }],
      entities: [{ role: 'mentioned', entity: { type: 'agency', canonicalName: 'Regulator' } }],
    };
    const { created, refused } = planF7([row], { tier: 'public' });
    assert.equal(created.length, 0);
    assert.equal(refused[0].code, 'missing_source_link');
  });
});
