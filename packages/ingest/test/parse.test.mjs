import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseRss } from '../src/parse/rss.js';
import { parseWpRest, mapPost, cleanText } from '../src/parse/wpRest.js';
import { parseJsonMap, getPath } from '../src/parse/jsonMap.js';
import { parsers } from '../src/parse/index.js';
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

// Offline fixture modelled on the CISA KEV JSON feed (no network).
const CISA_KEV = JSON.stringify({
  title: 'CISA Known Exploited Vulnerabilities',
  count: 2,
  vulnerabilities: [
    {
      cveID: 'CVE-2026-0001',
      vulnerabilityName: 'Example RCE in Acme Gateway',
      dateAdded: '2026-11-10',
      shortDescription: '<p>Acme &amp; Co gateway allows <b>remote</b> code execution.</p>',
      notes: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
    },
    {
      cveID: 'CVE-2026-0002',
      vulnerabilityName: 'Example privilege escalation',
      dateAdded: '2026-11-12',
      shortDescription: 'Local privilege escalation.',
    },
  ],
});

const KEV_SOURCE = {
  id: 'cisa-kev',
  type: 'json',
  parser: 'jsonMap',
  map: {
    itemPath: 'vulnerabilities',
    fields: {
      title: 'vulnerabilityName',
      link: 'notes',
      publishedAt: 'dateAdded',
      content: 'shortDescription',
    },
  },
};

describe('parse/jsonMap', () => {
  test('getPath resolves dotted paths and tolerates missing segments', () => {
    assert.equal(getPath({ a: { b: { c: 7 } } }, 'a.b.c'), 7);
    assert.equal(getPath({ a: {} }, 'a.b.c'), undefined);
    assert.equal(getPath(JSON.parse(CISA_KEV), 'vulnerabilities.0.cveID'), 'CVE-2026-0001');
  });

  test('getPath refuses prototype-chain segments (no inherited-property read)', () => {
    assert.equal(getPath({}, '__proto__'), undefined);
    assert.equal(getPath({}, 'constructor'), undefined);
    assert.equal(getPath({}, 'toString'), undefined);
    assert.equal(getPath({ a: {} }, 'a.__proto__.polluted'), undefined);
    assert.equal(getPath({ a: {} }, 'a.constructor.name'), undefined);
    // prototype pollution via a crafted path must not mutate Object.prototype
    getPath(JSON.parse('{"__proto__":{"polluted":1}}'), '__proto__.polluted');
    assert.equal(/** @type {Record<string, unknown>} */ ({}).polluted, undefined);
  });

  test('parses a CISA-KEV-like payload into neutral items', () => {
    const parsed = parseJsonMap(CISA_KEV, KEV_SOURCE);
    assert.equal(parsed.title, '');
    assert.equal(parsed.items.length, 2);

    const [first, second] = parsed.items;
    assert.equal(first.title, 'Example RCE in Acme Gateway');
    assert.equal(first.link, 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog');
    assert.equal(first.publishedAt, '2026-11-10T00:00:00.000Z');
    assert.equal(first.content, 'Acme & Co gateway allows remote code execution.');
    assert.equal(first.summary, '');
    assert.equal(first.guid, null);
    assert.equal(first.contentHash.length, 64);

    // Missing `notes` -> null link; hash still stable via title|publishedAt.
    assert.equal(second.link, null);
    assert.equal(second.contentHash.length, 64);
  });

  test('missing fields degrade to null, not a crash', () => {
    const body = JSON.stringify([{ vulnerabilityName: 'Only a title' }]);
    const parsed = parseJsonMap(body, { map: { fields: { title: 'vulnerabilityName' } } });
    assert.equal(parsed.items[0].title, 'Only a title');
    assert.equal(parsed.items[0].link, null);
    assert.equal(parsed.items[0].publishedAt, null);
    assert.equal(parsed.items[0].content, '');
  });

  test('itemPath may be omitted (body is the array)', () => {
    const body = JSON.stringify([{ name: 'x', url: 'https://x.example/1' }]);
    const parsed = parseJsonMap(body, { map: { fields: { title: 'name', link: 'url' } } });
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].link, 'https://x.example/1');
  });

  test('throws on non-JSON / non-array / missing map (pipeline -> parse_failed)', () => {
    assert.throws(() => parseJsonMap('not json', KEV_SOURCE));
    assert.throws(() => parseJsonMap('{"message":"nope"}', { map: {} }));
    assert.throws(() => parseJsonMap(CISA_KEV, {}));
    assert.throws(() => parseJsonMap(CISA_KEV, { map: { itemPath: 'count' } }));
  });

  test('registry: json and jsonMap both dispatch to jsonMap; api/wpRest stay WP-REST', () => {
    // `json` was a WP-REST alias (latent bug for generic JSON APIs); it now
    // serves the declarative jsonMap parser, and no source used it before.
    assert.equal(parsers.json(CISA_KEV, KEV_SOURCE).items.length, 2);
    assert.equal(parsers.jsonMap(CISA_KEV, KEV_SOURCE).items.length, 2);
    // api/wpRest keep the WP-REST contract: a bare object is rejected like parseWpRest.
    assert.throws(() => parsers.api(JSON.stringify({ title: 'x' })));
    assert.throws(() => parsers.wpRest(JSON.stringify({ title: 'x' })));
    assert.deepEqual(parsers.api(JSON.stringify([])), parseWpRest('[]'));
  });
});
