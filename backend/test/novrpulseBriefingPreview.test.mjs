import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import { previewBriefing } from '../src/controllers/briefingController.js';
import {
  escapeHtml,
  selectStories,
  buildStory,
  collapseStoryBlocks,
  renderBriefingPreview,
  formatBriefingDate,
} from '../src/services/novrpulse/briefingPreview.js';

// Controller + renderer tests for the Briefing Desk rendered-email preview.
//
// The renderer is pure, so most of it is exercised directly. The endpoint is
// exercised through the controller with the shared Prisma singleton's `briefing`
// delegate shadowed by an in-memory fake (the same pattern used by
// novrpulseBriefing.test.mjs). This covers story selection/priority, escaping,
// unused-block collapsing, the empty-briefing path, and the 404.

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
        functionId: 1,
        position: 1,
        items: [
          {
            position: 0,
            publishItem: {
              functionId: 1,
              body: '<script>alert(1)</script> headline\nSummary text here.',
              event: null,
            },
          },
        ],
      },
    ];
    const stories = selectStories(sections);
    assert.equal(stories.length, 1);
    const html = renderBriefingPreview({
      date: '19 November 2026',
      issueLine: 'Daily Intelligence Brief',
      preheader: '',
      intro: '',
      stories,
      readMoreUrl: '',
      unsubscribeUrl: '{{unsubscribeUrl}}',
    });
    assert.ok(!html.includes('<script>alert(1)</script>'), 'no raw script tag');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script is escaped');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Story selection + priority (§07 → §08 → §01 → others).
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing preview: story selection', () => {
  test('orders stories by section priority, not input order', () => {
    const sections = [
      { functionId: 1, position: 1, items: [{ position: 0, publishItem: { body: 'Regulatory story', event: null } }] },
      { functionId: 8, position: 8, items: [{ position: 0, publishItem: { body: 'CyberIntel story', event: null } }] },
      { functionId: 7, position: 7, items: [{ position: 0, publishItem: { body: 'Breaking story', event: null } }] },
    ];
    const stories = selectStories(sections);
    assert.equal(stories.length, 3);
    assert.equal(stories[0].headline, 'Breaking story');
    assert.equal(stories[1].headline, 'CyberIntel story');
    assert.equal(stories[2].headline, 'Regulatory story');
  });

  test('takes at most 5 stories and skips empty bodies', () => {
    const sections = [
      {
        functionId: 7,
        position: 7,
        items: [
          { position: 0, publishItem: { body: '   ', event: null } },
          ...Array.from({ length: 7 }, (_, i) => ({
            position: i + 1,
            publishItem: { body: `Story ${i + 1}`, event: null },
          })),
        ],
      },
    ];
    const stories = selectStories(sections);
    assert.equal(stories.length, 5);
    assert.deepEqual(stories.map((s) => s.headline), ['Story 1', 'Story 2', 'Story 3', 'Story 4', 'Story 5']);
  });

  test('derives source/sourceUrl from the linked event, else NovrPulse', () => {
    const withEvent = buildStory({
      position: 0,
      publishItem: {
        body: 'Body text',
        event: {
          title: 'Event headline',
          publishedAt: new Date('2026-11-18T00:00:00Z'),
          canonicalUrl: 'https://example.gov/notice',
          sources: [{ rawDocument: { source: { name: 'EFCC' } } }],
        },
      },
    });
    assert.equal(withEvent.headline, 'Event headline');
    assert.equal(withEvent.source, 'EFCC · 18 November 2026');
    assert.equal(withEvent.sourceUrl, 'https://example.gov/notice');

    const manual = buildStory({ position: 0, publishItem: { body: 'Just a body\nwith a line', event: null } });
    assert.equal(manual.source, 'NovrPulse');
    assert.equal(manual.sourceUrl, '');
    assert.equal(manual.headline, 'Just a body');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Unused story blocks collapse (no leftover {{story tokens).
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing preview: block collapsing', () => {
  test('fewer than 5 stories leaves no {{story tokens', () => {
    const sections = [
      {
        functionId: 7,
        position: 7,
        items: [
          { position: 0, publishItem: { body: 'Only story', event: null } },
        ],
      },
    ];
    const stories = selectStories(sections);
    assert.equal(stories.length, 1);
    const html = renderBriefingPreview({
      date: '19 November 2026',
      issueLine: 'Daily Intelligence Brief',
      preheader: '',
      intro: '',
      stories,
      readMoreUrl: '',
      unsubscribeUrl: '{{unsubscribeUrl}}',
    });
    assert.ok(!html.includes('{{story'), 'no leftover story tokens');
    assert.ok(html.includes('Only story'), 'the single story is present');
    // The unused story blocks are gone, so the "Story 2" marker comment is too.
    assert.ok(!html.includes('<!-- Story 2'));
  });

  test('collapseStoryBlocks removes optional blocks and keeps the container balanced', () => {
    const template = '<div><!-- Story 1 -->A<!-- Story 2 -->B<!-- CTA -->C</div>';
    const out = collapseStoryBlocks(template, 1);
    assert.equal(out, '<div><!-- Story 1 -->A<!-- CTA -->C</div>');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Endpoint: happy path, empty briefing, 404.
// ─────────────────────────────────────────────────────────────────────────────

describe('briefing preview: endpoint', () => {
  test('builds a preview from briefing sections in priority order', async () => {
    const s1 = sectionWithItem({ functionId: 1, body: 'Regulatory item body', event: null });
    const s7 = sectionWithItem({
      functionId: 7,
      body: 'Breaking item body',
      event: {
        title: 'Breaking headline',
        publishedAt: new Date('2026-11-18T00:00:00Z'),
        canonicalUrl: 'https://news.example/1',
        sources: [{ rawDocument: { source: { name: 'Reuters' } } }],
      },
    });
    const store = makeStore({
      briefings: [{ id: 'br-1', briefingDate: new Date('2026-11-19T00:00:00Z'), title: null }],
      sections: [s1.section, s7.section],
      sectionItems: [s1.item, s7.item],
      publishItems: [s1.publish, s7.publish],
    });

    const { statusCode, payload } = await callPreview({ params: { id: 'br-1' } }, store);
    assert.equal(statusCode, 200);
    assert.equal(typeof payload.html, 'string');
    assert.ok(payload.html.includes('19 November 2026'), 'briefing date is rendered');
    assert.ok(payload.html.includes('Breaking headline'), 'breaking story is rendered');
    assert.ok(!payload.html.includes('{{story'), 'no leftover story tokens');
    assert.ok(payload.html.includes('{{unsubscribeUrl}}'), 'unsubscribe passthrough survives');
  });

  test('an empty briefing renders valid html with 0 stories and no {{ tokens', async () => {
    const store = makeStore({
      briefings: [{ id: 'br-1', briefingDate: new Date('2026-11-19T00:00:00Z'), title: null }],
      sections: [{ id: 'sec-1', briefingId: 'br-1', functionId: 1, position: 1, state: 'empty', note: null }],
      sectionItems: [],
      publishItems: [],
    });

    const { statusCode, payload } = await callPreview({ params: { id: 'br-1' } }, store);
    assert.equal(statusCode, 200);
    assert.ok(payload.html.includes('<!DOCTYPE html>'));
    // No story tokens except the deliberate unsubscribe passthrough.
    assert.ok(!/\{\{story/.test(payload.html));
    assert.ok(!/\{\{date\}\}/.test(payload.html), 'tokens are filled');
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
