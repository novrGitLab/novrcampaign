import crypto from 'node:crypto';

/**
 * The neutral item contract every parser emits and every consumer stores.
 *
 * @typedef {object} NormalisedItem
 * @property {string} title
 * @property {string|null} link
 * @property {string|null} publishedAt   ISO 8601
 * @property {string} content            raw source text (publisher words)
 * @property {string} summary            always '' at parse time; a consumer's
 *                                       understanding layer fills it later
 * @property {string|null} guid          source-provided id, if any
 * @property {string} contentHash        stable sha256 for exact dedupe
 */

/** Decode the five XML entities plus numeric character references. */
export function decodeXmlEntities(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Strip tags, decode entities, collapse whitespace. */
export function stripHtml(input) {
  if (input === null || input === undefined) return '';
  const withoutCdata = String(input).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const withoutTags = withoutCdata.replace(/<[^>]*>/g, ' ');
  return (
    decodeXmlEntities(withoutTags)
      .replace(/\s+/g, ' ')
      // tidy space the tag-stripping leaves before punctuation ("markup .")
      .replace(/\s+([.,;:!?)\]}])/g, '$1')
      .trim()
  );
}

/** Parse a date string to ISO, or null when unparseable. */
export function parseDate(raw) {
  if (!raw) return null;
  const value = stripHtml(raw);
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Stable content hash for exact dedupe (prefers the canonical link). */
export function contentHash({ link, title, publishedAt }) {
  const basis = (link && link.trim()) || `${title || ''}|${publishedAt || ''}`;
  return crypto.createHash('sha256').update(basis).digest('hex');
}

export default { stripHtml, decodeXmlEntities, parseDate, contentHash };
