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
 * dropping nav-like lines. Joining with a space keeps the text a single blob
 * (the stored body is plain text, not line-delimited).
 */
function regionToText(region) {
  const lines = String(region)
    .split(BLOCK_SPLIT)
    .map((line) => stripHtml(line))
    .filter((line) => line.length > 0 && !isNavLikeLine(line));
  return lines.join(' ').replace(/\s+/g, ' ').trim();
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
