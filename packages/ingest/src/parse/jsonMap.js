import { stripHtml, parseDate, contentHash } from './item.js';

/**
 * Declarative JSON parser.
 *
 * Maps an arbitrary JSON API (CISA KEV, NIST NVD, any vendor feed) onto the
 * neutral {@link import('./item.js').NormalisedItem} contract using a
 * declarative `source.map` config, so a new JSON source is data, not code:
 *
 *   map: {
 *     itemPath: 'vulnerabilities',
 *     fields: {
 *       title: 'vulnerabilityName',
 *       link: 'notes',
 *       publishedAt: 'dateAdded',
 *       content: 'shortDescription',
 *     },
 *   }
 *
 * Fetching, canary and freshness are the pipeline's job; this module stays a
 * pure function. Like `parseWpRest`, it throws on malformed input so the
 * pipeline can classify it as `parse_failed`.
 */

/**
 * Resolve a dotted path against a JSON value.
 *
 * Returns `undefined` when any segment is missing, so a missing field becomes a
 * sensible null rather than a crash. A blank path returns the value itself.
 *
 * @param {unknown} value
 * @param {string} path
 * @returns {unknown}
 */
export function getPath(value, path) {
  if (typeof path !== 'string' || path.length === 0) return value;
  let current = value;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    // Resolve own properties only, and never prototype-chain members: a crafted
    // path segment ("__proto__", "constructor", "prototype") must resolve to
    // `undefined`, not to an inherited object.
    if (!Object.hasOwn(current, segment)) return undefined;
    current = /** @type {Record<string, unknown>} */ (current)[segment];
  }
  return current;
}

/** Coerce a resolved value to a trimmed string, or null when absent/empty. */
function asString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Read one mapped field: a missing/blank field name yields no value. */
function fieldValue(record, path) {
  if (typeof path !== 'string' || path.length === 0) return undefined;
  return getPath(record, path);
}

/**
 * Map one JSON record to a normalised item using the declarative field map.
 *
 * @param {unknown} record
 * @param {Record<string, string>} fields
 * @returns {import('./item.js').NormalisedItem}
 */
function mapRecord(record, fields) {
  const title = stripHtml(asString(fieldValue(record, fields.title)) ?? '');
  const link = asString(fieldValue(record, fields.link));
  const publishedAt = parseDate(fieldValue(record, fields.publishedAt));
  const content = stripHtml(asString(fieldValue(record, fields.content)) ?? '');
  return {
    title,
    link,
    publishedAt,
    content,
    summary: '',
    guid: null,
    contentHash: contentHash({ link, title, publishedAt }),
  };
}

/**
 * Parse a JSON body into normalised items using `source.map`.
 *
 * `source.map.itemPath` selects the array to iterate (a dotted path, or the
 * whole body when omitted). When the resolved value is not an array the body is
 * treated as malformed and this throws, matching `parseWpRest`'s contract.
 *
 * @param {string} body
 * @param {object} source        must carry `map`
 * @param {object} source.map
 * @param {string} [source.map.itemPath]
 * @param {Record<string,string>} [source.map.fields]
 * @returns {{ title:string, items:Array<import('./item.js').NormalisedItem> }}
 */
export function parseJsonMap(body, source = {}) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('JSON map response was not JSON');
  }

  const map = source.map;
  if (!map || typeof map !== 'object') throw new Error('JSON map source has no map config');

  const root = map.itemPath ? getPath(payload, map.itemPath) : payload;
  if (!Array.isArray(root)) throw new Error(`JSON map itemPath "${map.itemPath ?? ''}" did not resolve to an array`);

  const fields = map.fields ?? {};
  return { title: '', items: root.map((record) => mapRecord(record, fields)) };
}

export default { parseJsonMap, getPath };
