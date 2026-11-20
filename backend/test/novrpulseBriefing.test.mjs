import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import { PILLARS, pillarLabel } from '../src/services/novrpulse/pillars.js';
import {
  createBriefing,
  getBriefing,
  listBriefings,
  updateBriefing,
  deleteBriefing,
  updateSection,
  attachSectionItem,
  detachSectionItem,
  reorderSectionItems,
  authorSectionItem,
  listSupportingEvents,
  createSupportingEvent,
  listOpportunities,
  createOpportunity,
  listForumTopics,
  createForumTopic,
} from '../src/controllers/briefingController.js';

// Controller-level tests for the Daily Briefing Desk.
//
// No live database is used: the shared Prisma singleton's delegates are shadowed
// with an in-memory fake for the duration of the run (the same pattern used by
// novrpulsePublish.qa.test.mjs and novrpulsePulseApi.test.mjs). This exercises
// the real controller code path — section seeding, the unique-key guards, the
// attach/detach invariants, and the manual authoring transaction — without a
// Postgres instance.

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stand-in for the briefing-desk tables.
// ─────────────────────────────────────────────────────────────────────────────

function makeStore(seed = {}) {
  const briefings = (seed.briefings ?? []).map((b) => ({ ...b }));
  const sections = (seed.sections ?? []).map((s) => ({ ...s }));
  const sectionItems = (seed.sectionItems ?? []).map((s) => ({ ...s }));
  const publishItems = (seed.publishItems ?? []).map((p) => ({
    approvedAt: null,
    rejectedAt: null,
    publishedAt: null,
    withdrawnAt: null,
    ...p,
  }));
  const supportingEvents = (seed.supportingEvents ?? []).map((e) => ({ ...e }));
  const opportunities = (seed.opportunities ?? []).map((o) => ({ ...o }));
  const forumTopics = (seed.forumTopics ?? []).map((f) => ({ ...f }));

  let seq = 0;
  const nextId = (prefix) => `${prefix}-${(seq += 1)}`;

  const cmpDesc = (key) => (a, b) => new Date(b[key]).getTime() - new Date(a[key]).getTime();
  const cmpAsc = (key) => (a, b) => new Date(a[key]).getTime() - new Date(b[key]).getTime();

  function withSection(section) {
    if (!section) return null;
    const items = sectionItems
      .filter((i) => i.sectionId === section.id)
      .sort((a, b) => a.position - b.position)
      .map((link) => ({
        ...link,
        publishItem: publishItems.find((p) => p.id === link.publishItemId) ?? null,
      }));
    return { ...section, items };
  }

  function withSections(briefing) {
    if (!briefing) return null;
    const secs = sections
      .filter((s) => s.briefingId === briefing.id)
      .sort((a, b) => a.position - b.position)
      .map(withSection);
    return { ...briefing, sections: secs };
  }

  const briefing = {
    async findUnique({ where, include } = {}) {
      const row = briefings.find((b) => (where.id !== undefined ? b.id === where.id : false)
        || (where.briefingDate !== undefined
          && new Date(b.briefingDate).getTime() === new Date(where.briefingDate).getTime()));
      if (!row) return null;
      if (include?.sections) {
        const full = withSections(row);
        // Mirror a `select` on sections when the controller only asks for state.
        const selectsStateOnly = include.sections.select?.state === true
          && !include.sections.include;
        if (selectsStateOnly) {
          return { ...row, sections: full.sections.map((s) => ({ state: s.state })) };
        }
        return full;
      }
      return { ...row };
    },
    async findMany({ where, include } = {}) {
      let rows = [...briefings];
      if (where?.status) rows = rows.filter((b) => b.status === where.status);
      if (where?.briefingDate) {
        const { gte, lte } = where.briefingDate;
        rows = rows.filter((b) => {
          const t = new Date(b.briefingDate).getTime();
          if (gte && t < new Date(gte).getTime()) return false;
          if (lte && t > new Date(lte).getTime()) return false;
          return true;
        });
      }
      rows.sort(cmpDesc('briefingDate'));
      if (include?.sections) {
        return rows.map((b) => ({
          ...b,
          sections: sections.filter((s) => s.briefingId === b.id).map((s) => ({ state: s.state })),
        }));
      }
      return rows.map((b) => ({ ...b }));
    },
    async create({ data }) {
      seq += 1;
      const row = {
        id: `br-${seq}`,
        status: 'not_started',
        title: null,
        publishedAt: null,
        scheduledFor: null,
        createdAt: new Date('2026-11-19T00:00:00Z'),
        updatedAt: new Date('2026-11-19T00:00:00Z'),
        ...data,
      };
      if (briefings.some((b) => new Date(b.briefingDate).getTime() === new Date(row.briefingDate).getTime())) {
        const err = new Error('Unique constraint failed on the fields: (`briefingDate`)');
        err.code = 'P2002';
        throw err;
      }
      briefings.push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = briefings.find((b) => b.id === where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, data, { updatedAt: new Date('2026-11-19T01:00:00Z') });
      return { ...row };
    },
    async delete({ where }) {
      const idx = briefings.findIndex((b) => b.id === where.id);
      if (idx === -1) throw new Error('record not found');
      const [row] = briefings.splice(idx, 1);
      // Cascade: sections and their items.
      const removedSections = sections.filter((s) => s.briefingId === row.id).map((s) => s.id);
      for (let i = sections.length - 1; i >= 0; i -= 1) if (sections[i].briefingId === row.id) sections.splice(i, 1);
      for (let i = sectionItems.length - 1; i >= 0; i -= 1) if (removedSections.includes(sectionItems[i].sectionId)) sectionItems.splice(i, 1);
      return { ...row };
    },
  };

  const briefingSection = {
    async createMany({ data }) {
      for (const d of data) {
        seq += 1;
        sections.push({ id: `sec-${seq}`, note: null, ...d });
      }
      return { count: data.length };
    },
    async findUnique({ where, include } = {}) {
      let row;
      if (where.id !== undefined) {
        row = sections.find((s) => s.id === where.id);
      } else {
        const key = where.briefingId_functionId;
        row = sections.find((s) => s.briefingId === key.briefingId && s.functionId === key.functionId);
      }
      if (!row) return null;
      return include?.items ? withSection(row) : { ...row };
    },
    async update({ where, data }) {
      const row = sections.find((s) => s.id === where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, data);
      return { ...row };
    },
  };

  const briefingSectionItem = {
    async findUnique({ where }) {
      const link = sectionItems.find((i) => {
        if (where.id !== undefined) return i.id === where.id;
        const key = where.sectionId_publishItemId;
        return i.sectionId === key.sectionId && i.publishItemId === key.publishItemId;
      });
      return link ? { ...link } : null;
    },
    async findFirst({ where, orderBy } = {}) {
      let rows = sectionItems.filter((i) => i.sectionId === where.sectionId);
      if (orderBy?.position === 'desc') rows = rows.sort((a, b) => b.position - a.position);
      return rows[0] ? { ...rows[0] } : null;
    },
    async create({ data }) {
      const clash = sectionItems.find((i) => i.sectionId === data.sectionId && i.publishItemId === data.publishItemId);
      if (clash) {
        const err = new Error('Unique constraint failed on (`sectionId`,`publishItemId`)');
        err.code = 'P2002';
        throw err;
      }
      seq += 1;
      const row = { id: `si-${seq}`, ...data };
      sectionItems.push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = sectionItems.find((i) => i.id === where.id);
      if (!row) throw new Error('record not found');
      Object.assign(row, data);
      return { ...row };
    },
    async delete({ where }) {
      const idx = sectionItems.findIndex((i) => i.id === where.id);
      if (idx === -1) throw new Error('record not found');
      const [row] = sectionItems.splice(idx, 1);
      return { ...row };
    },
  };

  const publishItem = {
    async findUnique({ where }) {
      return publishItems.find((p) => p.id === where.id) ?? null;
    },
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
      publishItems.push(row);
      return { ...row };
    },
  };

  const supportingEvent = {
    async findMany({ orderBy } = {}) {
      const rows = [...supportingEvents];
      if (orderBy?.startsAt === 'asc') rows.sort(cmpAsc('startsAt'));
      return rows;
    },
    async count() {
      return supportingEvents.length;
    },
    async create({ data }) {
      seq += 1;
      const row = { id: `se-${seq}`, ...data };
      supportingEvents.push(row);
      return { ...row };
    },
  };

  const opportunity = {
    async findMany() {
      return [...opportunities].sort(cmpDesc('createdAt'));
    },
    async count() {
      return opportunities.length;
    },
    async create({ data }) {
      seq += 1;
      const row = { id: `op-${seq}`, ...data };
      opportunities.push(row);
      return { ...row };
    },
  };

  const forumTopic = {
    async findMany() {
      return [...forumTopics].sort(cmpDesc('createdAt'));
    },
    async count() {
      return forumTopics.length;
    },
    async create({ data }) {
      seq += 1;
      const row = { id: `ft-${seq}`, ...data };
      forumTopics.push(row);
      return { ...row };
    },
  };

  // A transaction runs its callback against this same in-memory store, so a
  // failure mid-callback would (like a real tx) not be rolled back here — tests
  // assert the success paths, which is what the desk relies on.
  const $transaction = async (arg) => (typeof arg === 'function' ? arg(store) : Promise.all(arg));

  const store = {
    briefings,
    sections,
    sectionItems,
    publishItems,
    supportingEvents,
    opportunities,
    forumTopics,
    briefing,
    briefingSection,
    briefingSectionItem,
    publishItem,
    supportingEvent,
    opportunity,
    forumTopic,
    $transaction,
  };
  return store;
}

const DELEGATES = [
  'briefing',
  'briefingSection',
  'briefingSectionItem',
  'publishItem',
  'supportingEvent',
  'opportunity',
  'forumTopic',
  '$transaction',
];

async function withPrisma(store, fn) {
  const saved = new Map();
  for (const key of DELEGATES) {
    saved.set(key, {
      had: Object.prototype.hasOwnProperty.call(prisma, key),
      value: prisma[key],
    });
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
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
    send(body) {
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
  for (const key of DELEGATES) delete prisma[key];
});

// ─────────────────────────────────────────────────────────────────────────────
// 0. Pillars.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing: pillars', () => {
  test('exactly eight pillars, ids 1..8, in order, with labels', () => {
    assert.equal(PILLARS.length, 8);
    assert.deepEqual(PILLARS.map((p) => p.functionId), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(pillarLabel(1), 'Regulatory Impact');
    assert.equal(pillarLabel(8), 'CyberIntel');
    assert.equal(pillarLabel(99), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Create — auto-seeds the eight sections; duplicate date conflicts.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing: create', () => {
  test('auto-seeds exactly 8 sections, position=functionId, state empty', async () => {
    const store = makeStore();
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(createBriefing, { user: { id: 'u-1' }, body: { briefingDate: '2026-11-19' } }),
    );

    assert.equal(statusCode, 201);
    assert.equal(payload.briefing.sections.length, 8);
    assert.deepEqual(payload.briefing.sections.map((s) => s.functionId), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(payload.briefing.sections.map((s) => s.position), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(payload.briefing.sections.every((s) => s.state === 'empty'));

    // Persisted: 8 section rows exist in the store.
    assert.equal(store.sections.length, 8);
  });

  test('a duplicate briefing date is refused with 409', async () => {
    const store = makeStore();
    await withPrisma(store, () =>
      callController(createBriefing, { user: { id: 'u-1' }, body: { briefingDate: '2026-11-19' } }),
    );
    const { error } = await withPrisma(store, () =>
      callController(createBriefing, { user: { id: 'u-1' }, body: { briefingDate: '2026-11-19' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 409);
    assert.equal(store.briefings.length, 1, 'no second briefing written');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Get — eight sections in order with their items and supporting counts.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing: get', () => {
  test('returns the 8 sections ordered, with items and supporting counts', async () => {
    const store = makeStore({
      publishItems: [{ id: 'pi-x', functionId: 7, contentType: 'briefing', body: 'Breaking news body', tier: 'public', templateVersion: 'manual@1.0.0' }],
      supportingEvents: [{ id: 'se-1', title: 'Event', description: 'd', organiser: 'o', startsAt: new Date('2026-11-20T00:00:00Z') }],
      opportunities: [{ id: 'op-1', title: 'Opp', description: 'd', kind: 'scholarship' }],
      forumTopics: [{ id: 'ft-1', title: 'T', prompt: 'p' }],
    });
    await withPrisma(store, () =>
      callController(createBriefing, { user: { id: 'u-1' }, body: { briefingDate: '2026-11-19' } }),
    );
    const briefingId = store.briefings[0].id;
    const section7 = store.sections.find((s) => s.functionId === 7);

    await withPrisma(store, () =>
      callController(attachSectionItem, {
        user: { id: 'u-1' },
        params: { id: briefingId, functionId: '7' },
        body: { publishItemId: 'pi-x' },
      }),
    );

    const { payload } = await withPrisma(store, () =>
      callController(getBriefing, { params: { id: briefingId } }),
    );

    const sections = payload.briefing.sections;
    assert.deepEqual(sections.map((s) => s.functionId), [1, 2, 3, 4, 5, 6, 7, 8]);

    const s7 = sections.find((s) => s.functionId === 7);
    assert.equal(s7.items.length, 1);
    assert.equal(s7.items[0].publishItemId, 'pi-x');
    assert.equal(s7.items[0].publishItem.id, 'pi-x');
    assert.equal(s7.items[0].publishItem.status, 'draft');
    assert.equal(s7.items[0].publishItem.bodyPreview, 'Breaking news body');

    // Supporting counts for §02/§05/§06.
    assert.equal(sections.find((s) => s.functionId === 2).supportingCount, 1);
    assert.equal(sections.find((s) => s.functionId === 5).supportingCount, 1);
    assert.equal(sections.find((s) => s.functionId === 6).supportingCount, 1);
    assert.equal(sections.find((s) => s.functionId === 1).supportingCount, 0);
    void section7;
  });

  test('body preview is clipped to 200 chars', async () => {
    const long = 'x'.repeat(500);
    const store = makeStore({
      publishItems: [{ id: 'pi-long', functionId: 7, contentType: 'briefing', body: long, tier: 'public', templateVersion: 'manual@1.0.0' }],
    });
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));
    const briefingId = store.briefings[0].id;
    await withPrisma(store, () =>
      callController(attachSectionItem, { user: { id: 'u' }, params: { id: briefingId, functionId: '7' }, body: { publishItemId: 'pi-long' } }),
    );
    const { payload } = await withPrisma(store, () => callController(getBriefing, { params: { id: briefingId } }));
    const item = payload.briefing.sections.find((s) => s.functionId === 7).items[0];
    assert.equal(item.publishItem.bodyPreview.length, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Attach / detach — link only; publish item survives.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing: attach/detach invariants', () => {
  async function seeded() {
    const store = makeStore({
      publishItems: [{ id: 'pi-a', functionId: 7, contentType: 'briefing', body: 'A', tier: 'public', templateVersion: 'manual@1.0.0' }],
    });
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));
    return store;
  }

  test('attach adds the item; detach removes the link but keeps the publish item', async () => {
    const store = await seeded();
    const briefingId = store.briefings[0].id;

    const attached = await withPrisma(store, () =>
      callController(attachSectionItem, { user: { id: 'u' }, params: { id: briefingId, functionId: '7' }, body: { publishItemId: 'pi-a' } }),
    );
    assert.equal(attached.statusCode, 201);
    assert.equal(attached.payload.section.items.length, 1);
    const itemId = attached.payload.section.items[0].id;

    const detached = await withPrisma(store, () =>
      callController(detachSectionItem, { user: { id: 'u' }, params: { id: briefingId, functionId: '7', itemId } }),
    );
    assert.equal(detached.payload.section.items.length, 0);
    assert.equal(store.sectionItems.length, 0, 'the link row is gone');
    assert.equal(store.publishItems.length, 1, 'the publish item is NEVER deleted');
  });

  test('attaching the same item twice is a 409', async () => {
    const store = await seeded();
    const briefingId = store.briefings[0].id;
    await withPrisma(store, () =>
      callController(attachSectionItem, { user: { id: 'u' }, params: { id: briefingId, functionId: '7' }, body: { publishItemId: 'pi-a' } }),
    );
    const { error } = await withPrisma(store, () =>
      callController(attachSectionItem, { user: { id: 'u' }, params: { id: briefingId, functionId: '7' }, body: { publishItemId: 'pi-a' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 409);
  });

  test('attaching an unknown publish item is a 404', async () => {
    const store = await seeded();
    const briefingId = store.briefings[0].id;
    const { error } = await withPrisma(store, () =>
      callController(attachSectionItem, { user: { id: 'u' }, params: { id: briefingId, functionId: '7' }, body: { publishItemId: 'ghost' } }),
    );
    assert.equal(error.statusCode, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Reorder.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing: reorder', () => {
  test('sets positions 0..n in the given order', async () => {
    const store = makeStore({
      publishItems: [
        { id: 'pi-1', functionId: 7, contentType: 'briefing', body: '1', tier: 'public', templateVersion: 'manual@1.0.0' },
        { id: 'pi-2', functionId: 7, contentType: 'briefing', body: '2', tier: 'public', templateVersion: 'manual@1.0.0' },
        { id: 'pi-3', functionId: 7, contentType: 'briefing', body: '3', tier: 'public', templateVersion: 'manual@1.0.0' },
      ],
    });
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));
    const briefingId = store.briefings[0].id;
    for (const pid of ['pi-1', 'pi-2', 'pi-3']) {
      await withPrisma(store, () =>
        callController(attachSectionItem, { user: { id: 'u' }, params: { id: briefingId, functionId: '7' }, body: { publishItemId: pid } }),
      );
    }
    const section = store.sections.find((s) => s.functionId === 7);
    const ids = store.sectionItems.filter((i) => i.sectionId === section.id).sort((a, b) => a.position - b.position).map((i) => i.id);
    const reversed = [...ids].reverse();

    const { payload } = await withPrisma(store, () =>
      callController(reorderSectionItems, { user: { id: 'u' }, params: { id: briefingId, functionId: '7' }, body: { itemIds: reversed } }),
    );

    assert.deepEqual(payload.section.items.map((i) => i.id), reversed);
    assert.deepEqual(payload.section.items.map((i) => i.position), [0, 1, 2]);
  });

  test('a mismatched id set is refused with 400', async () => {
    const store = makeStore({
      publishItems: [{ id: 'pi-1', functionId: 7, contentType: 'briefing', body: '1', tier: 'public', templateVersion: 'manual@1.0.0' }],
    });
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));
    const briefingId = store.briefings[0].id;
    await withPrisma(store, () =>
      callController(attachSectionItem, { user: { id: 'u' }, params: { id: briefingId, functionId: '7' }, body: { publishItemId: 'pi-1' } }),
    );
    const { error } = await withPrisma(store, () =>
      callController(reorderSectionItems, { user: { id: 'u' }, params: { id: briefingId, functionId: '7' }, body: { itemIds: ['si-999'] } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Manual authoring.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing: author', () => {
  test('creates a new publish item (manual@1.0.0, tier public, editorId from session) and attaches it', async () => {
    const store = makeStore();
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));
    const briefingId = store.briefings[0].id;

    const { statusCode, payload } = await withPrisma(store, () =>
      callController(authorSectionItem, {
        user: { id: 'editor-7' },
        params: { id: briefingId, functionId: '3' },
        body: { body: 'Hand-written public-education piece' },
      }),
    );

    assert.equal(statusCode, 201);
    assert.equal(store.publishItems.length, 1);
    const created = store.publishItems[0];
    assert.equal(created.body, 'Hand-written public-education piece');
    assert.equal(created.contentType, 'briefing');
    assert.equal(created.tier, 'public');
    assert.equal(created.functionId, 3);
    assert.equal(created.templateVersion, 'manual@1.0.0');
    assert.equal(created.editorId, 'editor-7');
    assert.equal(created.approvedAt, null, 'authored item is a draft');

    assert.equal(payload.section.functionId, 3);
    assert.equal(payload.section.items.length, 1);
    assert.equal(payload.section.items[0].publishItemId, created.id);
  });

  test('authored item appears as draft and honours contentType', async () => {
    const store = makeStore();
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));
    const briefingId = store.briefings[0].id;
    await withPrisma(store, () =>
      callController(authorSectionItem, {
        user: { id: 'editor-7' },
        params: { id: briefingId, functionId: '3' },
        body: { body: 'Urgent piece', contentType: 'urgent_alert' },
      }),
    );
    assert.equal(store.publishItems[0].contentType, 'urgent_alert');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Section state.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing: section state', () => {
  test("state update to 'no_updates' persists", async () => {
    const store = makeStore();
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));
    const briefingId = store.briefings[0].id;

    const { payload } = await withPrisma(store, () =>
      callController(updateSection, { user: { id: 'u' }, params: { id: briefingId, functionId: '4' }, body: { state: 'no_updates' } }),
    );
    assert.equal(payload.section.state, 'no_updates');
    assert.equal(store.sections.find((s) => s.functionId === 4).state, 'no_updates');
  });

  test('an invalid state is refused with 400', async () => {
    const store = makeStore();
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));
    const briefingId = store.briefings[0].id;
    const { error } = await withPrisma(store, () =>
      callController(updateSection, { user: { id: 'u' }, params: { id: briefingId, functionId: '4' }, body: { state: 'bogus' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Delete — allowed on draft, refused in review or later.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing: delete', () => {
  test('delete is allowed on a draft briefing', async () => {
    const store = makeStore();
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));
    const briefingId = store.briefings[0].id;
    await withPrisma(store, () =>
      callController(updateBriefing, { user: { id: 'u' }, params: { id: briefingId }, body: { status: 'draft' } }),
    );

    const { statusCode } = await withPrisma(store, () =>
      callController(deleteBriefing, { user: { id: 'u' }, params: { id: briefingId } }),
    );
    assert.equal(statusCode, 204);
    assert.equal(store.briefings.length, 0);
    assert.equal(store.sections.length, 0, 'sections cascade');
  });

  test('delete is refused on an in_review briefing with 409', async () => {
    const store = makeStore();
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));
    const briefingId = store.briefings[0].id;
    await withPrisma(store, () =>
      callController(updateBriefing, { user: { id: 'u' }, params: { id: briefingId }, body: { status: 'in_review' } }),
    );

    const { error } = await withPrisma(store, () =>
      callController(deleteBriefing, { user: { id: 'u' }, params: { id: briefingId } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 409);
    assert.equal(store.briefings.length, 1, 'the briefing survives');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. List + supporting records.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing: list', () => {
  test('lists briefings newest first with section-state counts', async () => {
    const store = makeStore();
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-18' } }));
    await withPrisma(store, () => callController(createBriefing, { user: { id: 'u' }, body: { briefingDate: '2026-11-19' } }));

    const { payload } = await withPrisma(store, () => callController(listBriefings, { query: {} }));
    assert.equal(payload.briefings.length, 2);
    assert.deepEqual(payload.briefings.map((b) => b.briefingDate.slice(0, 10)), ['2026-11-19', '2026-11-18']);
    assert.equal(payload.briefings[0].sectionTotal, 8);
    assert.equal(payload.briefings[0].sectionCounts.empty, 8);
  });
});

describe('briefing: supporting records', () => {
  test('create a supporting event with verified:true stamps verifiedAt', async () => {
    const store = makeStore();
    const { statusCode, payload } = await withPrisma(store, () =>
      callController(createSupportingEvent, {
        user: { id: 'u' },
        body: {
          title: 'Cyber summit',
          description: 'A summit',
          organiser: 'Novr',
          startsAt: '2026-12-01T09:00:00Z',
          verified: true,
        },
      }),
    );
    assert.equal(statusCode, 201);
    assert.ok(payload.event.verifiedAt, 'verifiedAt stamped');
    assert.equal(store.supportingEvents.length, 1);

    const list = await withPrisma(store, () => callController(listSupportingEvents, {}));
    assert.equal(list.payload.events.length, 1);
  });

  test('a supporting event missing organiser is refused with 400', async () => {
    const store = makeStore();
    const { error } = await withPrisma(store, () =>
      callController(createSupportingEvent, {
        user: { id: 'u' },
        body: { title: 'x', description: 'y', startsAt: '2026-12-01T09:00:00Z' },
      }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 400);
  });

  test('create an opportunity and a forum topic', async () => {
    const store = makeStore();
    const opp = await withPrisma(store, () =>
      callController(createOpportunity, {
        user: { id: 'u' },
        body: { title: 'Scholarship', description: 'd', kind: 'scholarship' },
      }),
    );
    assert.equal(opp.statusCode, 201);
    assert.equal(opp.payload.opportunity.kind, 'scholarship');

    const topic = await withPrisma(store, () =>
      callController(createForumTopic, {
        user: { id: 'u' },
        body: { title: 'Topic', prompt: 'Discuss X' },
      }),
    );
    assert.equal(topic.statusCode, 201);
    assert.equal(topic.payload.forumTopic.prompt, 'Discuss X');

    assert.equal((await withPrisma(store, () => callController(listOpportunities, {}))).payload.opportunities.length, 1);
    assert.equal((await withPrisma(store, () => callController(listForumTopics, {}))).payload.forumTopics.length, 1);
  });

  test('an invalid opportunity kind is refused with 400', async () => {
    const store = makeStore();
    const { error } = await withPrisma(store, () =>
      callController(createOpportunity, { user: { id: 'u' }, body: { title: 'x', description: 'd', kind: 'bogus' } }),
    );
    assert.ok(error);
    assert.equal(error.statusCode, 400);
  });
});
