import { fetchText } from './fetch/index.js';
import { parsers } from './parse/index.js';

/**
 * The generic ingestion pipeline.
 *
 * One source in, one {@link CollectResult} out: fetch → parse → canary →
 * freshness → items. It knows nothing about NovrPulse, events, functions or
 * entities. A consumer supplies:
 *   - `sources`  an array of `{ id, type, feedUrl, enabled, ... }`
 *   - `parsers`  (optional) a parser registry override
 *   - `fetch`    (optional) a fetch implementation override (for tests)
 *   - `logger`   (optional) an injected logger
 *
 * The pipeline never throws for a bad source: every failure becomes a status on
 * the result, so one broken source cannot abort a run.
 *
 * @typedef {object} CollectResult
 * @property {string} sourceId
 * @property {boolean} ok
 * @property {'ok'|'canary_failed'|'fetch_failed'|'parse_failed'|'stale'|'no_parser'|'disabled'} status
 * @property {number} itemCount      items within the freshness window
 * @property {number} totalSeen      items parsed before freshness filtering
 * @property {string|null} newestAt  newest item date before filtering
 * @property {Array<import('../parse/item.js').NormalisedItem>} items
 * @property {string|null} error
 * @property {object|null} canary
 */

export const MIN_ITEMS = 1;
export const DEFAULT_MAX_AGE_DAYS = 7;

/**
 * Keep only items published within `maxAgeDays`. Undated items are dropped:
 * an undated item cannot be shown to be fresh.
 */
export function filterFresh(items, maxAgeDays, now = Date.now()) {
  const cutoff = now - maxAgeDays * 86_400_000;
  return items.filter((i) => {
    if (!i.publishedAt) return false;
    const t = Date.parse(i.publishedAt);
    return !Number.isNaN(t) && t >= cutoff;
  });
}

/**
 * Canary verdict: the expected shape of a healthy source. Passes when there is
 * at least one item, at least half the items carry a link, and at least one has
 * a title. A failure means the source is empty or its layout changed.
 */
export function evaluateCanary(parsed) {
  const items = parsed.items || [];
  const withTitle = items.filter((i) => i.title).length;
  const withLink = items.filter((i) => i.link).length;
  const withDate = items.filter((i) => i.publishedAt).length;
  const hasEnough = items.length >= MIN_ITEMS;
  const linksIntact = items.length === 0 ? false : withLink >= Math.ceil(items.length * 0.5);
  return {
    hasItems: hasEnough,
    hasTitles: withTitle === items.length && items.length > 0,
    linksIntact,
    hasDates: withDate > 0,
    itemCount: items.length,
    passed: hasEnough && linksIntact && withTitle > 0,
  };
}

/**
 * Collect one source.
 *
 * @param {object} source        `{ id, type, feedUrl, enabled }`
 * @param {object} [opts]
 * @param {Record<string,Function>} [opts.parsers]
 * @param {Function} [opts.fetch]
 * @param {object}   [opts.logger]
 * @param {number}   [opts.maxAgeDays]
 * @param {number}   [opts.now]
 * @returns {Promise<CollectResult>}
 */
export async function collectSource(source, opts = {}) {
  const {
    parsers: registry = parsers,
    fetch: fetchImpl = fetchText,
    logger,
    maxAgeDays = DEFAULT_MAX_AGE_DAYS,
    now = Date.now(),
  } = opts;

  const base = {
    sourceId: source.id,
    itemCount: 0,
    totalSeen: 0,
    newestAt: null,
    items: [],
    error: null,
    canary: null,
  };

  if (!source.enabled || !source.feedUrl) return { ...base, ok: false, status: 'disabled' };

  const parser = registry[source.type];
  if (!parser) return { ...base, ok: false, status: 'no_parser', error: `no parser for type ${source.type}` };

  let body;
  try {
    const res = await fetchImpl(source.feedUrl, { logger, label: source.id });
    body = res.body;
  } catch (err) {
    return { ...base, ok: false, status: 'fetch_failed', error: err.message };
  }

  let parsed;
  try {
    parsed = parser(body, source);
  } catch (err) {
    return { ...base, ok: false, status: 'parse_failed', error: err.message };
  }

  const totalSeen = parsed.items.length;
  const dates = parsed.items
    .map((i) => (i.publishedAt ? Date.parse(i.publishedAt) : NaN))
    .filter((t) => !Number.isNaN(t));
  const newestAt = dates.length ? new Date(Math.max(...dates)).toISOString() : null;

  const canary = evaluateCanary(parsed);
  if (!canary.passed) {
    logger?.warn?.({ sourceId: source.id, canary }, 'canary failed');
    return { ...base, ok: false, status: 'canary_failed', itemCount: totalSeen, totalSeen, newestAt, canary };
  }

  const fresh = filterFresh(parsed.items, maxAgeDays, now);
  if (fresh.length < MIN_ITEMS) {
    logger?.warn?.({ sourceId: source.id, totalSeen, newestAt, maxAgeDays }, 'no items within freshness window');
    return { ...base, ok: false, status: 'stale', itemCount: 0, totalSeen, newestAt, canary };
  }

  logger?.info?.({ sourceId: source.id, itemCount: fresh.length, totalSeen, newestAt }, 'source ok');
  return { ...base, ok: true, status: 'ok', itemCount: fresh.length, totalSeen, newestAt, items: fresh, canary };
}

/** Bounded-concurrency map, so a run never hammers every source at once. */
async function mapWithConcurrency(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
    while (next < list.length) {
      const i = next;
      next += 1;
      out[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Run the pipeline over many sources.
 *
 * @param {object} params
 * @param {Array<object>} params.sources
 * @param {string[]} [params.sourceIds]  restrict to these ids
 * @param {number}   [params.concurrency=3]
 * @param {number}   [params.maxAgeDays]
 * @param {object}   [params.logger]
 * @param {Record<string,Function>} [params.parsers]
 * @param {Function} [params.fetch]
 * @returns {Promise<{ ranAt:string, sources:Array<object>, items:Array<object>, ok:boolean }>}
 */
export async function runPipeline({
  sources,
  sourceIds,
  concurrency = 3,
  maxAgeDays,
  logger,
  parsers: registry,
  fetch: fetchImpl,
  now,
} = {}) {
  let list = sources ?? [];
  if (sourceIds?.length) list = list.filter((s) => sourceIds.includes(s.id));

  const ranAt = new Date().toISOString();
  const results = await mapWithConcurrency(list, concurrency, (s) =>
    collectSource(s, { logger, parsers: registry, fetch: fetchImpl, maxAgeDays, now }),
  );

  const health = [];
  const items = [];
  for (const r of results) {
    health.push({
      sourceId: r.sourceId,
      ok: r.ok,
      status: r.status,
      itemCount: r.itemCount,
      totalSeen: r.totalSeen,
      newestAt: r.newestAt,
      error: r.error,
    });
    for (const item of r.items) items.push({ sourceId: r.sourceId, ...item });
  }

  const report = { ranAt, sources: health, items, ok: health.every((h) => h.ok) };
  logger?.info?.({ ranAt, sources: health.length, items: items.length, ok: report.ok }, 'pipeline run complete');
  return report;
}

export default { collectSource, runPipeline, filterFresh, evaluateCanary };
