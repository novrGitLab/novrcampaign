import { contentHash } from './item.js';

/**
 * WordPress REST (`/wp-json/wp/v2/posts`) parser.
 *
 * Many sites expose no XML feed but do expose the built-in WP REST API. This
 * parser maps the JSON array to the neutral {@link import('./item.js').NormalisedItem}
 * contract. Fetching, canary and freshness are handled by the pipeline, so this
 * module stays a pure function.
 */

/** Decode the common HTML entities WP returns in `title.rendered`. */
function decodeEntities(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8216;/g, '\u2018')
    .replace(/&#8220;/g, '\u201c')
    .replace(/&#8221;/g, '\u201d')
    .replace(/&#8211;/g, '\u2013')
    .replace(/&#8212;/g, '\u2014')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Strip tags, decode entities, collapse whitespace. */
export function cleanText(s) {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Map one WP REST post to a normalised item. */
export function mapPost(post) {
  const title = cleanText(post.title?.rendered ?? '');
  const link = post.link ?? null;
  const publishedAt = post.date_gmt
    ? new Date(`${post.date_gmt}Z`).toISOString()
    : post.date
      ? new Date(post.date).toISOString()
      : null;
  const content = cleanText(post.content?.rendered ?? post.excerpt?.rendered ?? '');
  const guid = post.id !== null && post.id !== undefined ? String(post.id) : null;
  return {
    title,
    link,
    publishedAt,
    content,
    summary: '',
    guid,
    contentHash: contentHash({ link, title, publishedAt }),
  };
}

/**
 * Parse a WP REST JSON body into normalised items. Throws on non-array JSON so
 * the pipeline can classify it as a parse failure.
 *
 * @param {string} body
 * @returns {{ title:string, items:Array<import('./item.js').NormalisedItem> }}
 */
export function parseWpRest(body) {
  let posts;
  try {
    posts = JSON.parse(body);
  } catch {
    throw new Error('WP REST response was not JSON');
  }
  if (!Array.isArray(posts)) throw new Error('WP REST response was not an array');
  return { title: '', items: posts.map(mapPost) };
}

export default { parseWpRest, mapPost, cleanText };
