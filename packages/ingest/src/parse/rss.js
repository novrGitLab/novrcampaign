import { stripHtml, decodeXmlEntities, parseDate, contentHash } from './item.js';

/**
 * Minimal, dependency-free RSS 2.0 / Atom feed parser.
 *
 * Pure and side-effect free: takes feed text, returns normalised items. Scope is
 * deliberately narrow — the fields a consumer's event needs: title, link,
 * published date, content, and a stable content hash. Anything the feed omits is
 * left null rather than guessed.
 */

const MAX_ITEMS = 100;

/** Extract the text of the first `<tag>` inside a fragment. */
function tagText(fragment, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'i');
  const m = fragment.match(re);
  return m ? m[1] : '';
}

/** Extract an Atom `<link href="...">`, preferring rel="alternate". */
function atomLink(fragment) {
  const links = [...fragment.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  let fallback = '';
  for (const attrs of links) {
    const href = attrs.match(/href\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/href\s*=\s*'([^']*)'/i)?.[1];
    if (!href) continue;
    const rel = attrs.match(/rel\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/rel\s*=\s*'([^']*)'/i)?.[1] ?? 'alternate';
    if (rel === 'alternate') return decodeXmlEntities(href).trim();
    if (!fallback) fallback = decodeXmlEntities(href).trim();
  }
  return fallback;
}

/** Detect the feed flavour: 'rss' | 'atom' | null. */
export function detectFlavor(text) {
  if (/<rss\b/i.test(text)) return 'rss';
  if (/<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(text)) return 'atom';
  if (/<feed\b/i.test(text)) return 'atom';
  return null;
}

/**
 * Parse feed text into normalised items.
 *
 * @param {string} text
 * @returns {{ flavor:'rss'|'atom'|null, title:string, items:Array<import('./item.js').NormalisedItem> }}
 */
export function parseRss(text) {
  const raw = text === null || text === undefined ? '' : String(text);
  const flavor = detectFlavor(raw);
  const feedTitle = stripHtml(tagText(raw, 'title'));

  const itemFragments =
    flavor === 'atom'
      ? [...raw.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((m) => m[1])
      : [...raw.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);

  const items = [];
  for (const frag of itemFragments.slice(0, MAX_ITEMS)) {
    const title = stripHtml(tagText(frag, 'title'));

    let link;
    if (flavor === 'atom') link = atomLink(frag) || null;
    else link = stripHtml(tagText(frag, 'link')) || stripHtml(tagText(frag, 'guid')) || null;

    const rawDate =
      tagText(frag, 'pubDate') ||
      tagText(frag, 'published') ||
      tagText(frag, 'updated') ||
      tagText(frag, 'dc:date');
    const publishedAt = parseDate(rawDate);

    // `content` is the raw feed text for the item — usually the full article.
    // Publisher's words, never projected as consumer copy.
    const content = stripHtml(
      tagText(frag, 'content:encoded') ||
        tagText(frag, 'content') ||
        tagText(frag, 'description') ||
        tagText(frag, 'summary'),
    );

    const guid = stripHtml(tagText(frag, 'guid') || tagText(frag, 'id')) || null;
    if (!title && !link) continue;

    items.push({ title, link, publishedAt, content, summary: '', guid, contentHash: contentHash({ link, title, publishedAt }) });
  }

  return { flavor, title: feedTitle, items };
}

export default { parseRss, detectFlavor };
