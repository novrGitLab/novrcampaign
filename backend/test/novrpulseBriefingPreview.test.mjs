import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { pillarLabel } from '../src/services/novrpulse/pillars.js';

import { prisma } from '../src/utils/prisma.js';
import { previewBriefing } from '../src/controllers/briefingController.js';
import {
  escapeHtml,
  parseComposedBody,
  buildStory,
  groupStories,
  renderBriefingPreview,
  formatBriefingDate,
  CURATED_PLACEHOLDER,

} from '../src/services/novrpulse/briefingPreview.js';

// Controller + renderer tests for the Briefing Desk rendered-email preview.
//
// The renderer is pure, so most of it is exercised directly. The endpoint is
// exercised through the controller with the shared Prisma singleton's `briefing`
// delegate shadowed by an in-memory fake (the same pattern used by
// novrpulseBriefing.test.mjs). This covers per-pillar token mapping, escaping,
// curated placeholders, the empty-briefing path, and the 404.

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stand-in for the briefing preview query.
// ─────────────────────────────────────────────────────────────────────────────

function makeStore(seed = {}) {
  const briefings = (seed.briefings ?? []).map((b) => ({ ...b }));
  const sections = (seed.sections ?? []).map((s) => ({ ...s }));
  const sectionItems = (seed.sectionItems ?? []).map((s) => ({ ...s }));
  const publishItems = (seed.publishItems ?? []).map((p) => ({ ...p }));

  function withItems(section) {
    const items = sectionItems
      .filter((i) => i.sectionId === section.id)
      .sort((a, b) => a.position - b.position)
      .map((link) => ({
        ...link,
        publishItem: publishItems.find((p) => p.id === link.publishItemId) ?? null,
      }));
    return { ...section, items };
  }

  const briefing = {
    async findUnique({ where }) {
      const row = briefings.find((b) => b.id === where.id);
      if (!row) return null;
      const secs = sections
        .filter((s) => s.briefingId === row.id)
        .sort((a, b) => a.position - b.position)
        .map(withItems);
      return { ...row, sections: secs };
    },
  };

  return { briefings, sections, sectionItems, publishItems, briefing };
}

const DELEGATES = ['briefing'];

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
  return {
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
}

async function callPreview(req, store) {
  const res = fakeRes();
  try {
    await withPrisma(store, () => previewBriefing(req, res));
    return { statusCode: res.statusCode, payload: res.payload };
  } catch (error) {
    return { error };
  }
}

/** A section row with one publish item (+ optional event) at position 0. */
function sectionWithItem({ functionId, body, event }) {
  return {
    section: { id: `sec-${functionId}`, briefingId: 'br-1', functionId, position: functionId, state: 'ready', note: null },
    item: { id: `si-${functionId}`, sectionId: `sec-${functionId}`, publishItemId: `pi-${functionId}`, position: 0 },
    publish: { id: `pi-${functionId}`, functionId, contentType: 'briefing', body, tier: 'public', event: event ?? null },
  };
}

/** A composed fn 8 body with real depth in every slot. */
const LEAD_BODY = [
  'Banks face automated threat containment gap',
  '',
  'SUMMARY',
  'About four in five banks cannot contain threats automatically. Only about one in five detect and quarantine in real time. The rest rely on manual intervention. The survey covered hundreds of security professionals.',
  '',
  'IMPACT',
  'Network reliability is a pressure point for most respondents. Disruptions affect customer transactions and digital banking. Operational cost is rising too. Manual compliance work is significant.',
  '',
  'AFFECTED',
  'Banks, insurers, payment firms and fintechs across the sector. Third-party access is weakly segmented at most firms. Nigerian payment operators face the same exposure.',
  '',
  'MITIGATION',
  'Institutions should modernise legacy architecture carefully. Adopt automation where the effort can be reduced. Consider managed network services. Establish dual connectivity for payment routes.',
  '',
  'WHY IT MATTERS',
  'Network maturity varies widely across the surveyed firms. Digital-payment fraud remains a serious risk. Regulators have flagged financial services as exposed. Phishing and ransomware persist.',
  '',
  'SOURCE',
  'According to Punch.',
].join('\n');

after(() => {
  for (const key of DELEGATES) delete prisma[key];
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Escaping.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing preview: escaping', () => {
  test('escapeHtml neutralises HTML-significant characters', () => {
    assert.equal(
      escapeHtml('<script>alert(1)</script>'),
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    assert.equal(escapeHtml(`a & b "c" 'd'`), 'a &amp; b &quot;c&quot; &#39;d&#39;');
    assert.equal(escapeHtml(null), '');
  });

  test('a script tag in an item body is escaped in the rendered html', () => {
    const sections = [
      {
        functionId: 8,
        position: 8,
        items: [
          {
            position: 0,
            publishItem: {
              functionId: 8,
              body: '<script>alert(1)</script> headline\n\nSUMMARY\nSummary text here.',
              event: null,
            },
          },
        ],
      },
    ];
    const html = renderBriefingPreview({
      date: '19 November 2026',
      preheader: '',
      groups: groupStories(sections),
      unsubscribeUrl: '{{unsubscribeUrl}}',
    });
    assert.ok(!html.includes('<script>alert(1)</script>'), 'no raw script tag');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script is escaped');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Composed-body parsing + grouping.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing preview: parsing', () => {
  test('parseComposedBody splits headline and slots on pillar labels', () => {
    const { headline, slots } = parseComposedBody(LEAD_BODY, 8);
    assert.equal(headline, 'Banks face automated threat containment gap');
    assert.ok(slots.SUMMARY.startsWith('About four in five banks'));
    assert.equal(slots.IMPACT, 'Network reliability is a pressure point for most respondents. Disruptions affect customer transactions and digital banking. Operational cost is rising too. Manual compliance work is significant.');
    assert.equal(slots.SOURCE, 'According to Punch.');
  });

  test('a multi-line slot paragraph is joined into one value', () => {
    const body = 'H\n\nSUMMARY\nFirst line\nsecond line\n\nIMPACT\nImpact line';
    const { slots } = parseComposedBody(body, 8);
    assert.equal(slots.SUMMARY, 'First line second line');
    assert.equal(slots.IMPACT, 'Impact line');
  });

  test('groupStories groups items by functionId, ordered by position', () => {
    const sections = [
      { functionId: 7, items: [
        { position: 1, publishItem: { functionId: 7, body: 'B\n', event: null } },
        { position: 0, publishItem: { functionId: 7, body: 'A\n', event: null } },
      ] },
      { functionId: 8, items: [{ position: 0, publishItem: { functionId: 8, body: 'Lead\n', event: null } }] },
    ];
    const groups = groupStories(sections);
    assert.equal(groups.get(7).length, 2);
    assert.equal(groups.get(7)[0].headline, 'A');
    assert.equal(groups.get(8).length, 1);
  });

  test('derives source/sourceUrl from the linked event, else NovrPulse', () => {
    const withEvent = buildStory({
      position: 0,
      publishItem: {
        functionId: 8,
        body: 'Body text',
        event: {
          title: 'Event headline',
          publishedAt: new Date('2026-11-18T00:00:00Z'),
          canonicalUrl: 'https://example.gov/notice',
          sources: [{ rawDocument: { source: { name: 'EFCC' } } }],
        },
      },
    });
    assert.equal(withEvent.headline, 'Body text');
    assert.equal(withEvent.source, 'EFCC');
    assert.equal(withEvent.sourceUrl, 'https://example.gov/notice');

    const manual = buildStory({ position: 0, publishItem: { functionId: 8, body: 'Just a body\nwith a line', event: null } });
    assert.equal(manual.source, 'NovrPulse');
    assert.equal(manual.sourceUrl, '');
    assert.equal(manual.headline, 'Just a body');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Token mapping + no leftover tokens.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing preview: token mapping', () => {
  test('fn 8 → the lead block tokens carry the deep slots', () => {
    const sections = [
      { functionId: 8, position: 8, items: [{ position: 0, publishItem: { functionId: 8, body: LEAD_BODY, event: null } }] },
    ];
    const html = renderBriefingPreview({
      date: '19 November 2026',
      preheader: '',
      groups: groupStories(sections),
      unsubscribeUrl: '{{unsubscribeUrl}}',
    });
    assert.ok(
      !html.replace(/\{\{unsubscribeUrl\}\}/g, '').includes('{{'),
      'no raw tokens remain (except the unsubscribe passthrough)',
    );
    assert.ok(html.includes(pillarLabel(8)), 'the fn 8 pillar header is used');
    assert.ok(html.includes('Who is affected'), 'affected readers have a section');
    assert.ok(html.includes('Why It Matters'), 'why it matters callout present');
    assert.ok(html.includes('About four in five banks'), 'lead summary is present');
    assert.ok(html.includes('Network reliability is a pressure point'), 'lead impact is present');
    assert.ok(html.includes('Banks, insurers, payment firms'), 'lead affected is present');
    // The old editorial headers are gone.
    assert.ok(!html.includes('Cybersecurity News of the Day'), 'no editorial lead header');
  });

  test('fn 7 → EVERY news piece renders, with the fn 7 pillar header', () => {
    const count = 5; // more than the old 3-piece cap
    const items = Array.from({ length: count }, (_, i) => ({
      position: i,
      publishItem: {
        functionId: 7,
        body: `Roll headline ${i + 1}\n\nWHAT HAPPENED\nRoll summary ${i + 1}.`,
        event: null,
      },
    }));
    const html = renderBriefingPreview({
      date: '19 November 2026',
      preheader: '',
      groups: groupStories([{ functionId: 7, items }]),
      unsubscribeUrl: '{{unsubscribeUrl}}',
    });
    assert.ok(html.includes(pillarLabel(7)), 'the fn 7 pillar header is used');
    assert.ok(!html.includes('More news today'), 'the old editorial roll header is gone');
    assert.ok(html.includes('Roll headline 1'));
    assert.ok(html.includes(`Roll headline ${count}`), 'all news pieces render (no cap)');
  });

  test('empty sections render NOTHING — no headers, no placeholder rows', () => {
    const html = renderBriefingPreview({
      date: '19 November 2026',
      preheader: '',
      groups: new Map(),
      unsubscribeUrl: '{{unsubscribeUrl}}',
    });
    // No section headers at all when every section is empty.
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      assert.ok(!html.includes(pillarLabel(id)), `no fn ${id} header when empty`);
    }
    assert.ok(!html.includes(CURATED_PLACEHOLDER), 'no placeholder text is rendered');
    assert.ok(!html.includes('takes a break'), 'no "takes a break" placeholder rows');
    assert.ok(
      !html.replace(/\{\{unsubscribeUrl\}\}/g, '').includes('{{'),
      'no raw tokens (except unsubscribe)',
    );
  });

  test('an empty section slot does not render an empty source link', () => {
    // A fn 7 piece with a body but NO event/source: no bare 🔗 link is emitted.
    const html = renderBriefingPreview({
      date: '19 November 2026',
      preheader: '',
      groups: groupStories([{
        functionId: 7,
        items: [{ position: 0, publishItem: { functionId: 7, body: 'Roll headline\n\nWHAT HAPPENED\nSummary.', event: null } }],
      }]),
      unsubscribeUrl: '{{unsubscribeUrl}}',
    });
    assert.ok(html.includes('Roll headline'));
    assert.ok(!html.includes('🔗 <a href=""'), 'no empty source link is rendered');
    assert.ok(!/🔗\s*<a href=""/.test(html), 'no empty href in the roll');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Endpoint: happy path, empty briefing, 404.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing preview: endpoint', () => {
  test('builds a preview mapping each section to its block', async () => {
    const s8 = sectionWithItem({ functionId: 8, body: LEAD_BODY, event: null });
    const s7 = sectionWithItem({
      functionId: 7,
      body: 'Breaking item body\n\nWHAT HAPPENED\nSomething happened fast.',
      event: {
        title: 'Breaking headline',
        publishedAt: new Date('2026-11-18T00:00:00Z'),
        canonicalUrl: 'https://news.example/1',
        sources: [{ rawDocument: { source: { name: 'Reuters' } } }],
      },
    });
    const store = makeStore({
      briefings: [{ id: 'br-1', briefingDate: new Date('2026-11-19T00:00:00Z'), title: null }],
      sections: [s7.section, s8.section],
      sectionItems: [s7.item, s8.item],
      publishItems: [s7.publish, s8.publish],
    });

    const { statusCode, payload } = await callPreview({ params: { id: 'br-1' } }, store);
    assert.equal(statusCode, 200);
    assert.equal(typeof payload.html, 'string');
    assert.ok(payload.html.includes('19 November 2026'), 'briefing date is rendered');
    assert.ok(payload.html.includes('Breaking item body'), 'the roll story is rendered');
    assert.ok(payload.html.includes('Banks face automated threat containment gap'), 'the lead is rendered');
    assert.ok(payload.html.includes('{{unsubscribeUrl}}'), 'unsubscribe passthrough survives');
    // No raw tokens other than the deliberate unsubscribe passthrough.
    assert.equal(payload.html.replace(/\{\{unsubscribeUrl\}\}/g, '').includes('{{'), false);
  });

  test('an empty briefing renders valid html and no {{ tokens (but the passthrough)', async () => {
    const store = makeStore({
      briefings: [{ id: 'br-1', briefingDate: new Date('2026-11-19T00:00:00Z'), title: null }],
      sections: [{ id: 'sec-1', briefingId: 'br-1', functionId: 1, position: 1, state: 'empty', note: null }],
      sectionItems: [],
      publishItems: [],
    });

    const { statusCode, payload } = await callPreview({ params: { id: 'br-1' } }, store);
    assert.equal(statusCode, 200);
    assert.ok(/^<!doctype html>/i.test(payload.html));
    assert.ok(!/\{\{date\}\}/.test(payload.html), 'tokens are filled');
    assert.equal(payload.html.replace(/\{\{unsubscribeUrl\}\}/g, '').includes('{{'), false);
  });

  test('unknown briefing is a 404', async () => {
    const store = makeStore();
    const { error } = await callPreview({ params: { id: 'ghost' } }, store);
    assert.ok(error);
    assert.equal(error.statusCode, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Date formatting.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing preview: date', () => {
  test('formats "D Month YYYY"', () => {
    assert.equal(formatBriefingDate(new Date('2026-11-19T00:00:00Z')), '19 November 2026');
    assert.equal(formatBriefingDate(new Date('2026-01-02T00:00:00Z')), '2 January 2026');
    assert.equal(formatBriefingDate('nonsense'), '');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Route guard: the preview route exists and /briefings is behind requireAuth.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing preview: route guard', () => {
  test('the briefings router is mounted behind requireAuth', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/routes/index.js', import.meta.url));
    const text = await readFile(path, 'utf8');
    assert.match(
      text,
      /router\.use\('\/briefings',\s*requireAuth,\s*briefingRoutes\);/,
      'briefings must be mounted with requireAuth',
    );
  });

  test('the briefing router registers the preview POST route', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../src/routes/briefingRoutes.js', import.meta.url));
    const text = await readFile(path, 'utf8');
    assert.match(
      text,
      /router\.post\('\/:id\/preview',\s*asyncHandler\(briefingController\.previewBriefing\)\);/,
      'preview route must be registered',
    );
  });
});
