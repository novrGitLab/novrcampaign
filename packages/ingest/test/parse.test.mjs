import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseRss } from '../src/parse/rss.js';
import { parseWpRest, mapPost, cleanText } from '../src/parse/wpRest.js';
import { stripHtml, parseDate, contentHash } from '../src/parse/item.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Feed</title>
  <item>
    <title>First item</title>
    <link>https://x.example/1</link>
    <pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Body with <b>markup</b>.</p>]]></description>
  </item>
  <item><title>Second</title><link>https://x.example/2</link><pubDate>Sun, 08 Nov 2026 09:00:00 GMT</pubDate><description>Plain.</description></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title>
  <entry><title>Entry one</title><link rel="alternate" href="https://a.example/1"/><updated>2026-11-09T12:00:00Z</updated><summary>Sum.</summary><id>tag:1</id></entry>
</feed>`;

describe('parse/item: helpers', () => {
  test('stripHtml strips tags and decodes', () => {
    assert.equal(stripHtml('<![CDATA[<p>a &amp; b</p>]]>'), 'a & b');
  });
  test('parseDate normalises to ISO and rejects garbage', () => {
    assert.equal(parseDate('Mon, 09 Nov 2026 10:00:00 GMT'), '2026-11-09T10:00:00.000Z');
    assert.equal(parseDate('nope'), null);
  });
  test('contentHash is stable per link', () => {
    const a = contentHash({ link: 'https://x/1' });
    assert.equal(a.length, 64);
    assert.equal(a, contentHash({ link: 'https://x/1' }));
    assert.notEqual(a, contentHash({ link: 'https://x/2' }));
  });
});

describe('parse/rss', () => {
  const parsed = parseRss(RSS);
  test('reads feed title and both items', () => {
    assert.equal(parsed.title, 'Test Feed');
    assert.equal(parsed.items.length, 2);
  });
  test('items carry the neutral contract', () => {
    const [first] = parsed.items;
    assert.equal(first.title, 'First item');
    assert.equal(first.link, 'https://x.example/1');
    assert.equal(first.publishedAt, '2026-11-09T10:00:00.000Z');
    assert.equal(first.content, 'Body with markup.');
    assert.equal(first.summary, '');
    assert.equal(first.contentHash.length, 64);
  });
  test('parses Atom', () => {
    const a = parseRss(ATOM);
    assert.equal(a.items.length, 1);
    assert.equal(a.items[0].link, 'https://a.example/1');
    assert.equal(a.items[0].publishedAt, '2026-11-09T12:00:00.000Z');
  });
  test('garbage yields no items, no throw', () => {
    assert.deepEqual(parseRss('<html>no</html>').items, []);
    assert.deepEqual(parseRss('').items, []);
  });
});

describe('parse/wpRest', () => {
  test('cleanText decodes and strips', () => {
    assert.equal(cleanText('<p>Nigeria&#8217;s breach &amp; more</p>'), 'Nigeria\u2019s breach & more');
  });
  test('maps a post to the neutral contract', () => {
    const it = mapPost({
      id: 7,
      date_gmt: '2026-11-17T10:00:00',
      link: 'https://w.example/a',
      title: { rendered: 'A &#8217;title&#8217;' },
      content: { rendered: '<p>Body</p>' },
    });
    assert.equal(it.title, 'A \u2019title\u2019');
    assert.equal(it.link, 'https://w.example/a');
    assert.equal(it.content, 'Body');
    assert.equal(it.summary, '');
    assert.ok(it.contentHash.length === 64);
  });
  test('throws on non-array JSON (pipeline classifies as parse_failed)', () => {
    assert.throws(() => parseWpRest('{"message":"nope"}'));
    assert.throws(() => parseWpRest('not json'));
  });
});
