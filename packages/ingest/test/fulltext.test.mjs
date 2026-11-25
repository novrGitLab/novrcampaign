import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { collectSource, runPipeline } from '../src/pipeline.js';
import {
  resolveFullTextOptions,
  createFetchBudget,
  enrichItemFullText,
  DEFAULT_FULL_TEXT,
} from '../src/enrich/fullText.js';
import { contentHash, stripHtml } from '../src/parse/item.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toUTCString();

const FEED_URL = 'https://8.8.8.8/feed';
const ARTICLE_URL = 'https://x.example/article';

/** A short teaser item (well under the 500-char floor). */
const teaserFeed = (content) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>A</title><link>${ARTICLE_URL}</link><pubDate>${daysAgo(1)}</pubDate><description><![CDATA[${content}]]></description></item>
</channel></rss>`;

/** A long full-length item (over the floor) — now ALSO fetched, by design. */
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

/** An item shaped like a parser output, with a controllable body length. */
const itemWith = (content) => ({
  title: 'T',
  link: ARTICLE_URL,
  publishedAt: '2026-11-16T00:00:00.000Z',
  content,
  summary: '',
  guid: null,
  contentHash: 'h',
});

describe('fulltext: options', () => {
  test('defaults are enabled with a full-day budget', () => {
    const cfg = resolveFullTextOptions();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.maxPerRun, DEFAULT_FULL_TEXT.maxPerRun);
    assert.equal(cfg.maxPerRun, 400);
    assert.equal(cfg.minFetchedChars, DEFAULT_FULL_TEXT.minFetchedChars);
    assert.equal(cfg.duplicatePrefixChars, DEFAULT_FULL_TEXT.duplicatePrefixChars);
  });
  test('overrides are honoured and disabling works', () => {
    const cfg = resolveFullTextOptions({ enabled: false, maxPerRun: 3, minFetchedChars: 10 });
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.maxPerRun, 3);
    assert.equal(cfg.minFetchedChars, 10);
  });
  test('budget decrements and floors at zero', () => {
    const b = createFetchBudget(2);
    assert.equal(b.remaining, 2);
    b.remaining -= 3;
    const b2 = createFetchBudget(-5);
    assert.equal(b2.remaining, 0);
  });
});

describe('fulltext: enrichItemFullText (always fetch, quality-gated on result)', () => {
  const cfg = resolveFullTextOptions(); // minFetchedChars 500, duplicatePrefixChars 200

  test('short item with a link fetches once and swaps content + recomputes hash', async () => {
    const budget = createFetchBudget(5);
    const item = itemWith('Short teaser.');
    const longText = 'sentence. '.repeat(100); // ~1000 chars
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return { status: 200, body: longText };
    };
    const out = await enrichItemFullText(item, { fetch, cfg, budget });
    assert.equal(calls, 1);
    assert.notEqual(out.content, item.content);
    assert.equal(out.content, longText.trim());
    assert.equal(
      out.contentHash,
      contentHash({ link: item.link, title: item.title, publishedAt: item.publishedAt }),
    );
    assert.equal(budget.remaining, 4);
  });

  test('LONG feed item is still fetched, and a longer page replaces it', async () => {
    // A 2000-char feed body whose article page yields 3000 chars → replaced.
    const feedBody = 'feedword '.repeat(250); // ~2000 chars
    const pageBody = 'articleword '.repeat(250); // ~3000 chars, distinct opening
    const budget = createFetchBudget(1);
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return { status: 200, body: pageBody };
    };
    const out = await enrichItemFullText(itemWith(feedBody), { fetch, cfg, budget });
    assert.equal(calls, 1, 'long item must be fetched (no short-only trigger gate)');
    assert.ok(out.content.length > stripHtml(feedBody).length);
    assert.equal(out.content, stripHtml(pageBody));
    assert.equal(out.contentHash, contentHash({ link: ARTICLE_URL, title: 'T', publishedAt: '2026-11-16T00:00:00.000Z' }));
  });

  test('page shorter than existing content keeps the feed teaser', async () => {
    const feedBody = 'F '.repeat(400); // ~800 chars
    const pageBody = 'P '.repeat(100); // ~200 chars, shorter
    const out = await enrichItemFullText(itemWith(feedBody), {
      fetch: async () => ({ status: 200, body: pageBody }),
      cfg,
      budget: createFetchBudget(1),
    });
    assert.equal(out.content, feedBody, 'unchanged original content, not stripped');
    assert.equal(out.contentHash, 'h');
  });

  test('page at or below the 500-char floor keeps the feed teaser', async () => {
    const item = itemWith('Teaser here.');
    const out = await enrichItemFullText(item, {
      fetch: async () => ({ status: 200, body: 'Slightly longer but still well under the floor.' }),
      cfg,
      budget: createFetchBudget(1),
    });
    assert.equal(out.content, 'Teaser here.');
    assert.equal(out.contentHash, 'h');
  });

  test('near-duplicate page (same first 200 chars) keeps the feed content, no swap', async () => {
    // The feed already carries the article body; the page repeats it with a few
    // extra trailing paragraphs. Swapping would only churn the hash.
    const common = 'the same opening paragraph text that both sources share. '.repeat(5); // > 200 chars
    const feedBody = common + 'Short tail.';
    const pageBody = common + 'A much longer trailing section that is longer overall. '.repeat(40);
    const out = await enrichItemFullText(itemWith(feedBody), {
      fetch: async () => ({ status: 200, body: pageBody }),
      cfg,
      budget: createFetchBudget(1),
    });
    assert.equal(out.content, feedBody, 'near-duplicate page → keep the feed content unchanged');
    assert.equal(out.contentHash, 'h');
  });

  test('fetch failure keeps the feed content, no throw', async () => {
    const item = itemWith('Teaser.');
    const out = await enrichItemFullText(item, {
      fetch: async () => {
        throw new Error('boom');
      },
      cfg,
      budget: createFetchBudget(5),
    });
    assert.equal(out.content, 'Teaser.');
    assert.equal(out.contentHash, 'h');
  });

  test('item without a link is skipped', async () => {
    const budget = createFetchBudget(5);
    const item = { ...itemWith('Teaser.'), link: null };
    let calls = 0;
    const out = await enrichItemFullText(item, {
      fetch: async () => {
        calls += 1;
        return { status: 200, body: 'x' };
      },
      cfg,
      budget,
    });
    assert.equal(calls, 0);
    assert.equal(out.content, 'Teaser.');
    assert.equal(budget.remaining, 5);
  });

  test('exhausted budget does not fetch', async () => {
    let calls = 0;
    const out = await enrichItemFullText(itemWith('Teaser.'), {
      fetch: async () => {
        calls += 1;
        return { status: 200, body: 'x' };
      },
      cfg,
      budget: createFetchBudget(0),
    });
    assert.equal(calls, 0);
    assert.equal(out.content, 'Teaser.');
  });
});

describe('fulltext: article extraction + body cap', () => {
  const cfg = resolveFullTextOptions(); // minFetchedChars 500, maxBodyChars 20000

  test('a 225k boilerplate page stores <= 20000 chars and drops script/nav markers', async () => {
    // A realistic bloated page: a long article wrapped in massive nav/footer
    // boilerplate plus scripts — the exact live failure (1837 → 225358 chars).
    // The article ITSELF is long enough to trip the cap.
    const article = `<p>${'prose word '.repeat(4000)}</p>`; // ~44k chars of prose
    const boilerplate = `<script>var trackingConfig = ${'x'.repeat(5000)};</script>`
      + `<nav>${'<a href="/x">Home</a> '.repeat(2000)}</nav>`
      + `<footer>${'copyright footer boilerplate '.repeat(3000)}</footer>`;
    const html = `<html><body>${boilerplate}<article>${article}</article>`
      + `<div class="sidebar">${'sidebar word '.repeat(5000)}</div>${boilerplate}</body></html>`;
    assert.ok(html.length > 200000, `fixture must be huge (got ${html.length})`);

    const out = await enrichItemFullText(itemWith('Short teaser.'), {
      fetch: async () => ({ status: 200, body: html }),
      cfg,
      budget: createFetchBudget(1),
    });

    assert.ok(out.content.length <= cfg.maxBodyChars, `capped to <= ${cfg.maxBodyChars}, got ${out.content.length}`);
    // The stored body is the article prose, not the page chrome.
    assert.ok(out.content.includes('prose word'), 'article text retained');
    assert.ok(!out.content.includes('<script'), 'no script markup');
    assert.ok(!out.content.includes('Home'), 'nav link text dropped');
    assert.ok(!out.content.includes('copyright footer'), 'footer boilerplate dropped');
    assert.ok(out.content.endsWith('…'), 'a capped body ends with an ellipsis');
  });

  test('a page with <article> stores only the article text (no chrome)', async () => {
    const html = `<html><body>
      <nav>Home About Contact Subscribe</nav>
      <main>
        <article><p>Only the article body here.</p><p>${'sentence. '.repeat(80)}</p></article>
      </main>
      <aside>Related links and adverts</aside>
      <footer>All rights reserved</footer>
    </body></html>`;
    const out = await enrichItemFullText(itemWith('Teaser.'), {
      fetch: async () => ({ status: 200, body: html }),
      cfg,
      budget: createFetchBudget(1),
    });
    assert.ok(out.content.startsWith('Only the article body here.'));
    assert.ok(!out.content.includes('Related links'));
    assert.ok(!out.content.includes('All rights reserved'));
    assert.ok(!out.content.includes('About Contact'));
  });

  test('extraction under minFetchedChars falls back to the full strip (still capped)', async () => {
    // A tiny <article> (well under 500) inside a page with a long main body: the
    // extraction is too thin, so the full strip is used and then capped.
    const html = `<html><body><article><p>Hi.</p></article>`
      + `<section>${'body paragraph text here. '.repeat(2000)}</section></body></html>`;
    const out = await enrichItemFullText(itemWith('short'), {
      fetch: async () => ({ status: 200, body: html }),
      cfg,
      budget: createFetchBudget(1),
    });
    assert.ok(out.content.length <= cfg.maxBodyChars);
    assert.ok(out.content.length > 500, 'fallback strip exceeded the floor');
    assert.ok(out.content.includes('body paragraph text here.'), 'used the full-strip fallback');
  });

  test('capBody truncates at a boundary with a trailing ellipsis, respecting the limit', async () => {
    const { capBody } = await import('../src/enrich/fullText.js');
    const text = `${'Sentence body words here. '.repeat(2000)}`; // ~50k chars
    const capped = capBody(text, 20000);
    assert.ok(capped.length <= 20000, `<= 20000, got ${capped.length}`);
    assert.ok(capped.endsWith('…'));
    // No clipping under the limit.
    assert.equal(capBody('short text', 20000), 'short text');
  });

  test('the cap applies AFTER the gates: a 225k page still beats a teaser and is adopted', async () => {
    const bigPage = `<article><p>${'article word '.repeat(30000)}</p></article>`; // ~360k raw
    const out = await enrichItemFullText(itemWith('Two sentence teaser only.'), {
      fetch: async () => ({ status: 200, body: bigPage }),
      cfg,
      budget: createFetchBudget(1),
    });
    assert.notEqual(out.content, 'Two sentence teaser only.', 'improvement adopted');
    assert.ok(out.content.length > 'Two sentence teaser only.'.length);
    assert.ok(out.content.length <= 20000, 'but bounded by the cap');
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
    assert.equal(
      r.items[0].contentHash,
      contentHash({ link: ARTICLE_URL, title: 'A', publishedAt: r.items[0].publishedAt }),
    );
  });

  test('a long full-content item is now ALSO fetched (the change)', async () => {
    const { fetch, state } = stubFetch(fullFeed, longText);
    const r = await collectSource(src(), { fetch, now: NOW });
    assert.equal(r.ok, true);
    assert.equal(state.articleFetches, 1, 'long item fetched too');
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

  test('default budget of 400 lets a whole day of items all fetch', async () => {
    // 5 distinct items, default cap 400 → every item with a link is fetched.
    const links = Array.from({ length: 5 }, (_, i) => `https://x.example/n${i}`);
    const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
${links
  .map(
    (u) =>
      `<item><title>T${u}</title><link>${u}</link><pubDate>${daysAgo(1)}</pubDate><description><![CDATA[Short teaser ${u}.]]></description></item>`,
  )
  .join('\n')}
</channel></rss>`;
    let articleFetches = 0;
    const fetch = async (url) => {
      if (url === FEED_URL) return { status: 200, body: feed };
      articleFetches += 1;
      return { status: 200, body: 'articlebody '.repeat(80) }; // > 500 chars
    };
    const r = await collectSource(src(), { fetch, now: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 5);
    assert.equal(articleFetches, 5, 'all 5 fetched under a 400 cap');
    for (const it of r.items) assert.equal(it.content, stripHtml('articlebody '.repeat(80)));
  });

  test('a second pass over the same source stores nothing new (dedupe by link hash)', async () => {
    // The contentHash is derived from the canonical link, so a re-run of the
    // same source produces byte-identical hashes → the store dedupes them.
    const { fetch } = stubFetch(teaserFeed('Short teaser only.'), longText);
    const first = await collectSource(src(), { fetch, now: NOW });
    const second = await collectSource(src(), { fetch, now: NOW });
    assert.equal(first.items.length, 1);
    assert.equal(second.items.length, 1);
    assert.equal(
      first.items[0].contentHash,
      second.items[0].contentHash,
      'same link → same hash → the store skips the second pass as a duplicate',
    );
  });
});
