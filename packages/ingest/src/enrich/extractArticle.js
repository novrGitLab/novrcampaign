import { stripHtml } from '../parse/item.js';

/**
 * Dependency-free readable-article extraction.
 *
 * The full-text enrichment used to run the whole fetched page through
 * {@link stripHtml}, which yields the ENTIRE document text: navigation menus,
 * cookie banners, scripts, footers, sidebars — 200KB+ of boilerplate around a
 * few KB of article. This module narrows the HTML to the article region before
 * stripping, so a downstream consumer reads the story, not the page chrome.
 *
 * Strategy (cheap, no DOM, no dependencies — regex + heuristics):
 *   1. Strip the non-content blocks entirely: `<script>`, `<style>`, `<nav>`,
 *      `<header>`, `<footer>`, `<aside>`, `<form>`, `<noscript>`, comments.
 *   2. Prefer a semantic container: the FIRST `<article>`, else `<main>`.
 *   3. Otherwise, use the paragraph-dense core (first `<p>` through the last
 *      `</p>`), the classic "this is the body" heuristic.
 *   4. Split the chosen region into block-level lines, strip tags per line,
 *      decode entities and collapse whitespace.
 *   5. Drop clearly nav-like lines: fewer than 3 words.
 *
 * The result is a CANDIDATE. The caller decides whether it beats the feed body
 * (see `fullText.js`) and whether to fall back to the full strip when this
 * yields too little (`< minFetchedChars`).
 *
 * @typedef {object} ArticleExtraction
 * @property {string} text              Extracted readable text (may be empty).
 * @property {'article'|'main'|'densest'|'fallback'} strategy  How text was found.
 */

/** Tags whose entire contents are never article text. */
const DROP_TAGS = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'noscript', 'svg', 'template'];

/** Block-level boundaries used to split a region into candidate lines. */
const BLOCK_SPLIT = /<\/(p|div|li|h[1-6]|section|tr|blockquote|figcaption|td)\s*>|<br\s*\/?>/gi;

/** Minimum words for a retained line (nav/label lines are typically 1–2 words). */
const MIN_LINE_WORDS = 3;

/**
 * Named HTML entities that show up in article prose. A small curated map is
 * enough: the numeric form (`&#NN;` / `&#xHH;`) is decoded generically below.
 */
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  pound: '£',
  times: '×',
  '#39': "'",
  '#x27': "'",
  '#x2F': '/',
  '#8217': '\u2019',
  '#8216': '\u2018',
  '#8220': '\u201c',
  '#8221': '\u201d',
};

/**
 * Decode HTML entities: a curated named map plus generic numeric references
 * (`&#39;`, `&#x27;`). Unknown named entities are left untouched.
 */
function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** Remove any residual tag fragments (`<[^>]{1,80}>`), repeating until stable. */
function stripResidualTags(text) {
  let out = String(text);
  let prev;
  do {
    prev = out;
    out = out.replace(/<[^>]{1,80}>/g, ' ');
  } while (out !== prev);
  return out;
}

/**
 * A line that looks like code / CSS / JS rather than article prose. Legacy and
 * imperfect extraction still leaked "code" into stored bodies (the owner's
 * report), so drop these lines outright. Heuristics:
 *   - braces ({ or }) — object literals / CSS rule blocks;
 *   - a CSS selector at line start (`@media`, `.class {`, `#id {`);
 *   - JS keywords/operators: `function(`, `var `, `=>`, `window.`, `document.`;
 *   - `cookie` (banner scripts) and `!important` (inline styles).
 */
function isCodeLikeLine(line) {
  const s = String(line);
  if (s.includes('{') || s.includes('}')) return true;
  if (/^\s*[@.#][\w-]+\s*\{/.test(s)) return true;
  if (/function\s*\(/.test(s)) return true;
  if (/\bvar\s+\w/.test(s)) return true;
  if (s.includes('=>')) return true;
  if (s.includes('window.')) return true;
  if (s.includes('document.')) return true;
  if (/cookie/i.test(s)) return true;
  if (s.includes('!important')) return true;
  return false;
}

/** Remove a whole element (open to close, non-greedy) for each dropped tag. */
function dropBlocks(html) {
  let out = String(html).replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of DROP_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    out = out.replace(re, ' ');
    // Also drop a stray/self-closing opener of the same tag.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), ' ');
  }
  return out;
}

/**
 * Extract the inner HTML of the first element with the given tag.
 * Returns null when the tag is absent.
 */
function firstElementInner(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(html);
  return m ? m[1] : null;
}

/**
 * The paragraph-dense core: from the first `<p>` through the last `</p>`.
 * Returns null when the document has no paragraphs.
 */
function densestParagraphRegion(html) {
  const lastEnd = html.toLowerCase().lastIndexOf('</p>');
  if (lastEnd === -1) return null;
  const firstOpen = html.search(/<p\b/i);
  const start = firstOpen === -1 ? 0 : firstOpen;
  return html.slice(start, lastEnd + '</p>'.length);
}

/**
 * A prose line carries a reasonable number of words; nav/label lines are short
 * (1–2 words like "Home", "Subscribe", "Contact"). Drop the short ones.
 */
function isNavLikeLine(line) {
  return line.split(/\s+/).filter(Boolean).length < MIN_LINE_WORDS;
}

/**
 * Split a region into lines on block boundaries and strip/normalise each line,
 * dropping nav-like and code-like lines. Each line is tag-stripped, residual tag
 * fragments are removed, entities are decoded, and whitespace is collapsed.
 * Joining with a space keeps the text a single blob (the stored body is plain
 * text, not line-delimited).
 */
function regionToText(region) {
  const lines = String(region)
    .split(BLOCK_SPLIT)
    // Decode entities FIRST so an encoded tag fragment (`&lt;em&gt;`) is seen as
    // a tag and can be stripped, then strip leftover tag fragments, then tidy.
    .map((line) => stripResidualTags(decodeEntities(stripHtml(line))))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && !isNavLikeLine(line) && !isCodeLikeLine(line));
  // Collapse runs of 3+ blank lines (a no-op after the join, but kept explicit
  // so the contract holds if a caller ever re-splits on newlines).
  return lines.join(' ').replace(/\n{3,}/g, '\n\n').replace(/\s+/g, ' ').trim();
}

/**
 * Extract readable article text from a fetched HTML document.
 *
 * @param {string} html  Raw fetched HTML (or plain text).
 * @returns {ArticleExtraction}
 */
export function extractArticle(html) {
  if (html === null || html === undefined) return { text: '', strategy: 'fallback' };
  const cleaned = dropBlocks(html);

  let region = firstElementInner(cleaned, 'article');
  let strategy = 'article';
  if (region === null) {
    region = firstElementInner(cleaned, 'main');
    strategy = 'main';
  }
  if (region === null) {
    region = densestParagraphRegion(cleaned);
    strategy = 'densest';
  }
  if (region === null) {
    // No structure at all (e.g. a JSON/plain-text body): let the caller fall
    // back to the full strip, which is what it did before extraction existed.
    return { text: '', strategy: 'fallback' };
  }

  return { text: regionToText(region), strategy };
}

export default { extractArticle };
