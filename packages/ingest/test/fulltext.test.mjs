import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { collectSource, runPipeline } from '../src/pipeline.js';
import {
  resolveFullTextOptions,
  createFetchBudget,
  enrichItemFullText,
  DEFAULT_FULL_TEXT,
} from '../src/enrich/fullText.js';
import { contentHash } from '../src/parse/item.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toUTCString();

const FEED_URL = 'https://8.8.8.8/feed';
const ARTICLE_URL = 'https://x.example/article';

/** A teaser-length item (well under the 500-char default threshold). */
const teaserFeed = (content) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>A</title><link>${ARTICLE_URL}</link><pubDate>${daysAgo(1)}</pubDate><description><![CDATA[${content}]]></description></item>
</channel></rss>`;

/** A full-length item (over the threshold) — must never trigger a fetch. */
const fullFeed = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>B</title><link>${ARTICLE_URL}</link><pubDate>${daysAgo(1)}</pubDate><description><![CDATA[${'word '.repeat(200)}]]></description></item>
</channel></rss>`;

const src = (over = {}) => ({ id: 'test', enabled: true, type: 'rss', feedUrl: FEED_URL, ...over });

/** Build a fetch stub that serves the feed, counts article fetches, and can fail them. */
function stubFetch(feedBody, articleBody, { failArticles = false } = {}) {
  const state = { calls: [], articleFetches: 0 };
  const fetch = async (url) => {
    state.calls.push(url);
    if (url === FEED_URL) return { status: 200, body: feedBody };
    if (url === ARTICLE_URL) {
      state.articleFetches += 1;
      if (failArticles) throw new Error('article unreachable');
      return { status: 200, body: articleBody };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetch, state };
}

describe('fulltext: options', () => {
  test('defaults are enabled with sane bounds', () => {
    const cfg = resolveFullTextOptions();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.maxPerRun, DEFAULT_FULL_TEXT.maxPerRun);
    assert.equal(cfg.minTeaserChars, DEFAULT_FULL_TEXT.minTeaserChars);
  });
  test('overrides are honoured and disabling works', () => {
    const cfg = resolveFullTextOptions({ enabled: false, maxPerRun: 3, minTeaserChars: 10 });
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.maxPerRun, 3);
    assert.equal(cfg.minTeaserChars, 10);
  });
  test('budget decrements and floors at zero', () => {
    const b = createFetchBudget(2);
    assert.equal(b.remaining, 2);
    b.remaining -= 3;
    const b2 = createFetchBudget(-5);
    assert.equal(b2.remaining, 0);
  });
});

describe('fulltext: enrichItemFullText', () => {
  const cfg = resolveFullTextOptions({ minTeaserChars: 500, minFetchedChars: 500, minRatio: 2 });
  const longText = 'sentence. '.repeat(100); // ~1000 chars

  test('short item with a link fetches once and swaps content + recomputes hash', async () => {
    const budget = createFetchBudget(5);
    const item = { title: 'A', link: ARTICLE_URL, publishedAt: '2026-11-16T00:00:00.000Z', content: 'Short teaser.', summary: '', guid: null, contentHash: 'old' };
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return { status: 200, body: longText };
    };
    const out = await enrichItemFullText(item, { fetch, cfg, budget });
    assert.equal(calls, 1);
    assert.notEqual(out.content, item.content);
    assert.equal(out.content, longText.trim());
    assert.equal(out.contentHash, contentHash({ link: item.link, title: item.title, publishedAt: item.publishedAt }));
    assert.equal(budget.remaining, 4);
  });

  test('full-content item never fetches', async () => {
    const budget = createFetchBudget(5);
    const item = { title: 'B', link: ARTICLE_URL, publishedAt: null, content: longText, summary: '', guid: null, contentHash: 'h' };
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return { status: 200, body: longText };
    };
    const out = await enrichItemFullText(item, { fetch, cfg, budget });
    assert.equal(calls, 0);
    assert.equal(out.content, item.content);
    assert.equal(budget.remaining, 5);
  });

  test('insufficiently-longer fetch result keeps the teaser', async () => {
    const budget = createFetchBudget(5);
    const item = { title: 'C', link: ARTICLE_URL, publishedAt: null, content: 'Teaser here.', summary: '', guid: null, contentHash: 'h' };
    const fetch = async () => ({ status: 200, body: 'Slightly longer but still short.' });
    const out = await enrichItemFullText(item, { fetch, cfg, budget });
    assert.equal(out.content, 'Teaser here.');
    assert.equal(out.contentHash, 'h');
  });

  test('fetch failure keeps the teaser, no throw', async () => {
    const budget = createFetchBudget(5);
    const item = { title: 'D', link: ARTICLE_URL, publishedAt: null, content: 'Teaser.', summary: '', guid: null, contentHash: 'h' };
    const fetch = async () => {
      throw new Error('boom');
    };
    const out = await enrichItemFullText(item, { fetch, cfg, budget });
    assert.equal(out.content, 'Teaser.');
    assert.equal(out.contentHash, 'h');
  });

  test('item without a link is skipped', async () => {
    const budget = createFetchBudget(5);
    const item = { title: 'E', link: null, publishedAt: null, content: 'Teaser.', summary: '', guid: null, contentHash: 'h' };
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return { status: 200, body: longText };
    };
    const out = await enrichItemFullText(item, { fetch, cfg, budget });
    assert.equal(calls, 0);
    assert.equal(out.content, 'Teaser.');
  });
});

describe('fulltext: through collectSource', () => {
  const longText = 'article. '.repeat(120); // ~1080 chars

  test('a teaser item is upgraded end to end', async () => {
    const { fetch, state } = stubFetch(teaserFeed('Short teaser only.'), longText);
    const r = await collectSource(src(), { fetch, now: NOW });
    assert.equal(r.ok, true);
    assert.equal(state.articleFetches, 1);
    assert.equal(r.items[0].content, longText.trim());
    assert.equal(r.items[0].contentHash, contentHash({ link: ARTICLE_URL, title: 'A', publishedAt: r.items[0].publishedAt }));
  });

  test('a full-content item triggers no article fetch', async () => {
    const { fetch, state } = stubFetch(fullFeed, longText);
    const r = await collectSource(src(), { fetch, now: NOW });
    assert.equal(r.ok, true);
    assert.equal(state.articleFetches, 0);
  });

  test('fetch failure keeps the teaser and the run still succeeds', async () => {
    const { fetch, state } = stubFetch(teaserFeed('Short teaser only.'), longText, { failArticles: true });
    const r = await collectSource(src(), { fetch, now: NOW });
    assert.equal(r.ok, true);
    assert.equal(state.articleFetches, 1);
    assert.equal(r.items[0].content, 'Short teaser only.');
  });

  test('disabled option skips full-text entirely', async () => {
    const { fetch, state } = stubFetch(teaserFeed('Short teaser only.'), longText);
    const r = await collectSource(src(), { fetch, now: NOW, fullTextFetch: { enabled: false } });
    assert.equal(r.ok, true);
    assert.equal(state.articleFetches, 0);
    assert.equal(r.items[0].content, 'Short teaser only.');
  });

  test('per-run cap stops article fetches after N (shared across sources)', async () => {
    // Two sources, two links each. A shared cap of 2 must allow exactly two
    // article fetches for the whole run, regardless of source count.
    const feedWith = (a, b) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>T</title><link>${a}</link><pubDate>${daysAgo(1)}</pubDate><description><![CDATA[Short teaser at ${a}.]]></description></item>
<item><title>U</title><link>${b}</link><pubDate>${daysAgo(1)}</pubDate><description><![CDATA[Short teaser at ${b}.]]></description></item>
</channel></rss>`;
    const feedA = feedWith('https://x.example/a1', 'https://x.example/a2');
    const feedB = feedWith('https://x.example/b1', 'https://x.example/b2');
    const feeds = { [FEED_URL]: feedB, 'https://8.8.4.4/feed': feedA };
    assert.ok(Object.keys(feeds).length >= 1);

    let articleFetches = 0;
    const fetch = async (url) => {
      if (feeds[url]) return { status: 200, body: feeds[url] };
      articleFetches += 1;
      return { status: 200, body: longText };
    };
    // Concurrency 1 keeps ordering deterministic for the cap assertion.
    const report = await runPipeline({
      sources: [src({ id: 'a', feedUrl: 'https://8.8.4.4/feed' }), src({ id: 'b', feedUrl: FEED_URL })],
      concurrency: 1,
      now: NOW,
      fetch,
      fullTextFetch: { maxPerRun: 2 },
    });
    assert.equal(report.ok, true);
    assert.equal(articleFetches, 2);
  });
});
