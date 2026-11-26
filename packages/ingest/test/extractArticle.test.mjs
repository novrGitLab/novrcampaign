import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { extractArticle } from '../src/enrich/extractArticle.js';

// Tests for the extraction hardening (the owner still saw "code" in stored
// bodies — legacy data plus imperfect per-line stripping). The extractor must
// drop code/CSS/JS lines, decode HTML entities, strip residual tag fragments,
// and keep only article prose. Pure function — no DOM, no network.

describe('extractArticle: code/CSS/JS is dropped', () => {
  test('CSS blocks survive neither selectors nor declarations', () => {
    const html = `<article>
      <style>.ad-banner { display: none; color: red !important; }</style>
      <p>Real article sentence one goes here.</p>
      <div class="widget">{ "tracking": true, "id": "abc" }</div>
      <p>Real article sentence two is here too.</p>
      <script>var config = { x: 1 }; window.dataLayer = [];</script>
    </article>`;
    const { text } = extractArticle(html);
    assert.ok(text.includes('Real article sentence one goes here.'), 'prose kept');
    assert.ok(text.includes('Real article sentence two is here too.'), 'prose kept');
    assert.ok(!text.includes('!important'), 'no inline-style declaration survives');
    assert.ok(!text.includes('display'), 'no CSS property survives');
    assert.ok(!text.includes('dataLayer'), 'no JS survives');
    assert.ok(!text.includes('tracking'), 'no object literal survives');
    assert.ok(!/[{}]/.test(text), 'no braces survive');
  });

  test('a CSS selector line at line start is dropped', () => {
    const html = `<article><p>Article prose sentence long enough here.</p>
      <div>#main { margin: 0; }</div>
      <div>.post-body { padding: 1em; }</div>
      <div>@media screen { display: block; }</div>
      <p>Second article prose sentence is fine.</p></article>`;
    const { text } = extractArticle(html);
    assert.ok(text.includes('Article prose sentence long enough here.'));
    assert.ok(text.includes('Second article prose sentence is fine.'));
    assert.ok(!text.includes('margin'), 'selector/decl line dropped');
    assert.ok(!text.includes('@media'), '@media block dropped');
  });

  test('JS lines with =>, function(, var, document., cookie are dropped', () => {
    const html = `<article><p>Editorial sentence number one is here.</p>
      <div>const x = () =&gt; window.location</div>
      <div>function track() { return true; }</div>
      <div>var gtag = null;</div>
      <div>document.cookie = "session=abc";</div>
      <p>Editorial sentence number two is here.</p></article>`;
    const { text } = extractArticle(html);
    assert.ok(text.includes('Editorial sentence number one is here.'));
    assert.ok(text.includes('Editorial sentence number two is here.'));
    assert.ok(!text.includes('window.'), 'window. dropped');
    assert.ok(!text.includes('function'), 'function( dropped');
    assert.ok(!text.includes('gtag'), 'var dropped');
    assert.ok(!text.includes('cookie'), 'cookie dropped');
    assert.ok(!text.includes('=>'), 'arrow dropped');
  });
});

describe('extractArticle: entity decoding', () => {
  test('named and numeric entities are decoded in prose', () => {
    const html = `<article><p>The company&rsquo;s data &mdash; leaked by a hacker &amp; sold on the dark&nbsp;web &#8212; affected &#50; million users &quot;officially&quot;.</p></article>`;
    const { text } = extractArticle(html);
    assert.ok(text.includes("company’s data"), 'right single quote decoded');
    assert.ok(text.includes('— leaked'), 'mdash decoded');
    assert.ok(text.includes('hacker & sold'), 'amp decoded');
    assert.ok(text.includes('dark web'), 'nbsp decoded to a space');
    assert.ok(text.includes('affected 2 million'), 'numeric decimal decoded');
    assert.ok(text.includes('"officially"'), 'quot decoded');
    assert.ok(!/&(amp|rsquo|mdash|nbsp|#\d+|#x[0-9a-fA-F]+);/.test(text), 'no entity reference remains');
  });

  test('hex numeric entities are decoded', () => {
    const html = `<article><p>Ransom&nbsp;note used &#x27;double extortion&#x27; tactics today.</p></article>`;
    const { text } = extractArticle(html);
    assert.ok(text.includes("'double extortion'"), 'hex + named decoded');
    assert.ok(!text.includes('&#x27;'));
  });
});

describe('extractArticle: residual tags + boilerplate mix', () => {
  test('residual tag fragments are removed', () => {
    const html = `<article><p>First paragraph of the article is here.</p>
      <div>A leftover &lt;em data-x="1"&gt;inline fragment&lt;/em&gt; from encoding</div>
      <p>Second paragraph of the article is here.</p></article>`;
    const { text } = extractArticle(html);
    assert.ok(!text.includes('<em'), 'residual tag fragment removed');
    assert.ok(text.includes('inline fragment'), 'the text inside was kept');
    assert.ok(text.includes('First paragraph of the article is here.'));
  });

  test('nav/boilerplate mixed with article keeps only article lines', () => {
    const html = `<html><body>
      <nav><a href="/">Home</a><a href="/about">About</a></nav>
      <article>
        <p>A genuine article sentence appears right here.</p>
        <div>Subscribe</div>
        <div>Share</div>
        <div>Related: another story entirely</div>
        <p>And a second genuine article sentence follows.</p>
      </article>
      <footer>Copyright 2026 All rights reserved</footer>
    </body></html>`;
    const { text } = extractArticle(html);
    assert.ok(text.includes('A genuine article sentence appears right here.'));
    assert.ok(text.includes('And a second genuine article sentence follows.'));
    assert.ok(!text.includes('Home'), 'nav dropped');
    assert.ok(!text.includes('Subscribe'), 'short label dropped');
    assert.ok(!text.includes('All rights reserved'), 'footer dropped');
  });
});
