import { parseRss } from './rss.js';
import { parseWpRest } from './wpRest.js';

/**
 * Parser registry, keyed by a source `type`. A consumer maps its source types to
 * one of these. Adding a new format (Atom-only, JSON-LD, Sitemap, CSV) is a new
 * entry here and nothing else changes.
 *
 * Every parser takes `(body, source)` and returns `{ title, items }` where each
 * item is a normalised item. A parser may throw on malformed input; the pipeline
 * converts that into a `parse_failed` status.
 */
export const parsers = {
  rss: (body) => parseRss(body),
  atom: (body) => parseRss(body),
  api: (body) => parseWpRest(body),
  wpRest: (body) => parseWpRest(body),
  json: (body) => parseWpRest(body),
};

export { parseRss, parseWpRest };
export default { parsers, parseRss, parseWpRest };
