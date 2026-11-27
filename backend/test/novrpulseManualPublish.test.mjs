import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import { createManualItem, composeManualBody, assertManualNameless } from '../src/controllers/publishController.js';

// Controller-level tests for the manual publish path (POST /api/publish).
//
// A manual piece is written directly by the editor ("✎ Write your own"): no
// source event, `eventId: null`, `editorId` from the SESSION, body composed as
// "<headline>\n\n<text>" plus an optional "Reference: <link>" line. The F7
// public-tier defamation gate still applies lexically (a person-like name in a
// fn7 public piece is refused), fail-closed.
//
// No live database: the shared Prisma `publishItem` delegate is shadowed with an
// in-memory fake (the same pattern as novrpulseEditorialCanvas.test.mjs).

function makeStore(seedItems = []) {
  const items = seedItems.map((i) => ({
    approvedAt: null,
    rejectedAt: null,
    publishedAt: null,
    withdrawnAt: null,
    ...i,
  }));
  let seq = 0;

  const publishItem = {
    async create({ data }) {
      seq += 1;
      const row = {
        id: `pi-${seq}`,
        approvedAt: null,
        rejectedAt: null,
        publishedAt: null,
        withdrawnAt: null,
        ...data,
      };
      items.push(row);
      return { ...row };
    },
    async findMany({ where, take } = {}) {
      const out = items.filter((row) =>
        Object.entries(where ?? {}).every(([k, v]) => row[k] === v),
      );
      return take !== undefined ? out.slice(0, take) : out;
    },
  };

  return { items, publishItem };
}

const DELEGATES = ['publishItem'];

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

function fakeRes() {
  const res = {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
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
  for (const key of DELEGATES) delete prisma[key];
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. composeManualBody — the body contract.
// ─────────────────────────────────────────────────────────────────────────────

describe('manual publish: body composition', () => {
  test('joins headline and text with a blank line (the seed/tray contract)', () => {
    assert.equal(
      composeManualBody({ headline: 'A headline', text: 'Body text.' }),
      'A headline\n\nBody text.',
    );
  });

  test('appends a final "Reference:" line when a link is given', () => {
    assert.equal(
      composeManualBody({ headline: 'H', text: 'T', referenceLink: 'https://x.example/a' }),
      'H\n\nT\n\nReference: https://x.example/a',
    );
  });

  test('omits the reference line when no link is given', () => {
    assert.equal(composeManualBody({ headline: 'H', text: 'T', referenceLink: '' }), 'H\n\nT');
    assert.equal(composeManualBody({ headline: 'H', text: 'T' }), 'H\n\nT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The defamation gate helper — lexical, fail-closed.
// ─────────────────────────────────────────────────────────────────────────────

describe('manual publish: manual defamation gate', () => {
  test('a fn7 public body naming a person-like individual is refused (422)', () => {
    assert.throws(
      () => assertManualNameless(7, 'public', 'H\n\nThe suspect, Chinedu Okafor, was arrested.'),
      (err) => err.statusCode === 422 && err.code === 'named_individual_in_public_arrest',
    );
  });

  test('a fn7 public body with no person-like token passes', () => {
    // FAIL-CLOSED NOTE: the lexical detector denies ANY untrusted token, so a
    // passing body must use only trusted vocabulary (common/function words,
    // reviewed source names, geography). Plain English with an out-of-vocabulary
    // content word over-blocks — see the dedicated test below.
    assert.doesNotThrow(() =>
      assertManualNameless(
        7,
        'public',
        'A regulator issued a new advisory to the bank and the agency said the group and the sector in the market and the service and the office and the ministry and the commission',
      ),
    );
  });

  test('the detector is deliberately fail-closed: an out-of-vocabulary word over-blocks', () => {
    // Documents the intended failure direction: a false DENY is reviewed by a
    // human; a leak is not. "banks"/"must" are not on the trusted list, so a
    // fn7 public manual piece using them is denied rather than risk a name.
    assert.throws(
      () => assertManualNameless(7, 'public', 'The banks must comply'),
      (err) => err.statusCode === 422 && err.code === 'named_individual_in_public_arrest',
    );
  });

  test('non-fn7 pillars are unaffected by the gate', () => {
    assert.doesNotThrow(() =>
      assertManualNameless(1, 'public', 'H\n\nThe suspect, Chinedu Okafor, was named.'),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Happy path — the created row + response.
// ─────────────────────────────────────────────────────────────────────────────

describe('manual publish: create', () => {
  test('creates a draft briefing item with eventId null and editorId from the session', async () => {
    const store = makeStore();
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(createManualItem, {
        user: { id: 'editor-9', role: 'SENDER' },
        body: { functionId: 3, headline: 'Phishing is rising', text: 'Watch out for bad links.' },
      }),
    );

    assert.equal(statusCode, 201);
    assert.equal(store.items.length, 1);
    const created = store.items[0];
    assert.equal(created.eventId, null);
    assert.equal(created.functionId, 3);
    assert.equal(created.contentType, 'briefing');
    assert.equal(created.tier, 'public');
    assert.equal(created.templateVersion, 'manual@2.0.0');
    assert.equal(created.editorId, 'editor-9', 'editorId must come from the session');
    assert.equal(created.approvedAt, null, 'a manual item is a draft, not a sign-off');
    assert.equal(created.body, 'Phishing is rising\n\nWatch out for bad links.');

    assert.equal(payload.item.id, created.id);
    assert.equal(payload.item.status, 'draft');
    assert.equal(payload.item.eventId, null);
  });

  test('the client cannot override the acting editor or approval via the body', async () => {
    const store = makeStore();
    await withPrisma(store, () =>
      callController(createManualItem, {
        user: { id: 'real-editor' },
        body: {
          functionId: 3,
          headline: 'H',
          text: 'T',
          editorId: 'attacker',
          approvedAt: '2000-01-01T00:00:00Z',
        },
      }),
    );
    assert.equal(store.items[0].editorId, 'real-editor');
    assert.equal(store.items[0].approvedAt, null);
  });

  test('a reference link is composed into the body', async () => {
    const store = makeStore();
    const { payload } = await withPrisma(store, () =>
      callController(createManualItem, {
        user: { id: 'e' },
        body: { functionId: 2, headline: 'H', text: 'T', referenceLink: 'https://forum.example/t/1' },
      }),
    );
    assert.equal(payload.item.body, 'H\n\nT\n\nReference: https://forum.example/t/1');
  });

  test('a manual piece surfaces in the desk-usable list (eventId null → usable)', async () => {
    const store = makeStore();
    await withPrisma(store, () =>
      callController(createManualItem, {
        user: { id: 'e' },
        body: { functionId: 3, headline: 'H', text: 'T' },
      }),
    );
    const usable = await store.publishItem.findMany({ where: { eventId: null } });
    assert.equal(usable.length, 1);
    assert.equal(usable[0].eventId, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Denied paths — the fn7 person name (422), validation (400), no session.
// ─────────────────────────────────────────────────────────────────────────────

describe('manual publish: denied paths', () => {
  test('a fn7 manual body naming a person is a 422 and writes nothing', async () => {
    const store = makeStore();
    const { error } = await withPrisma(store, () =>
      callController(createManualItem, {
        user: { id: 'e' },
        body: {
          functionId: 7,
          headline: 'EFCC arrests Chinedu Okafor',
          text: 'Chinedu Okafor was taken into custody over an alleged fintech fraud.',
        },
      }),
    );
    assert.ok(error, 'the create must be refused');
    assert.equal(error.statusCode, 422);
    assert.equal(error.code, 'named_individual_in_public_arrest');
    assert.equal(store.items.length, 0, 'no item may be created when it names a person');
  });

  test('a fn7 manual body without a person name is allowed', async () => {
    const store = makeStore();
    const { statusCode } = await withPrisma(store, () =>
      callController(createManualItem, {
        user: { id: 'e' },
        body: {
          functionId: 7,
          headline: 'A regulator issued a new advisory',
          text: 'A regulator issued a new advisory to the bank and the agency said the sector in the market and the office and the commission',
        },
      }),
    );
    assert.equal(statusCode, 201);
    assert.equal(store.items.length, 1);
  });

  test('validation: missing/blank fields and out-of-range functionId are 400 and write nothing', async () => {
    const bad = [
      { headline: 'H', text: 'T' }, // missing functionId
      { functionId: 0, headline: 'H', text: 'T' }, // out of range
      { functionId: 11, headline: 'H', text: 'T' },
      { functionId: 3, headline: '', text: 'T' }, // blank headline
      { functionId: 3, headline: 'H', text: '' }, // blank text
      { functionId: 3, headline: 'H' }, // missing text
      { functionId: 3, headline: 'H', text: 'T', referenceLink: 'not a url' }, // bad uri
    ];
    for (const body of bad) {
      const store = makeStore();
      const { error } = await withPrisma(store, () =>
        callController(createManualItem, { user: { id: 'e' }, body }),
      );
      assert.ok(error, `payload ${JSON.stringify(body)} must be rejected`);
      assert.equal(error.statusCode, 400);
      assert.equal(store.items.length, 0);
    }
  });

  test('a missing session is refused (identity must come from the session)', async () => {
    const store = makeStore();
    const { error } = await withPrisma(store, () =>
      callController(createManualItem, { body: { functionId: 3, headline: 'H', text: 'T' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 403);
    assert.equal(store.items.length, 0);
  });
});
