import { parseRss } from './rss.js';
import { parseWpRest } from './wpRest.js';
import { parseJsonMap } from './jsonMap.js';

/**
 * Parser registry, keyed by a source `parser` (falling back to `type`). A
 * consumer names a parser explicitly with `source.parser`, or lets `type` select
 * one. Adding a new format is a new entry here and nothing else changes.
 *
 * Every parser takes `(body, source)` and returns `{ title, items }` where each
 * item is a normalised item. A parser may throw on malformed input; the pipeline
 * converts that into a `parse_failed` status.
 *
 * `api`/`wpRest` stay on the WordPress REST parser. `json` maps to the
 * declarative {@link parseJsonMap}, which needs a `source.map` config; the old
 * `json` -> WP-REST alias was a latent bug for generic JSON APIs and no source
 * used it (verified by grep), so repointing it is safe.
 */
export const parsers = {
  rss: (body) => parseRss(body),
  atom: (body) => parseRss(body),
  api: (body) => parseWpRest(body),
  wpRest: (body) => parseWpRest(body),
  json: (body, source) => parseJsonMap(body, source),
  jsonMap: (body, source) => parseJsonMap(body, source),
};

export { parseRss, parseWpRest, parseJsonMap };
export default { parsers, parseRss, parseWpRest, parseJsonMap };
