import { stripHtml, contentHash } from '../parse/item.js';

/**
 * Full-text enrichment for short feed items.
 *
 * Many feeds only deliver a two-to-three sentence teaser (often truncated with
 * "[...]"), which is unusably short for downstream rewriting. This module
 * upgrades a teaser to the article's own text by fetching the item's link and
 * extracting its readable text.
 *
 * It is deliberately conservative and consumer-agnostic:
 *   - only items whose stripped content is shorter than `minTeaserChars` are
 *     considered (a full-content item is never fetched);
 *   - a fetch is only used when the fetched text is *substantially* longer
 *     (>= `minFetchedChars` and >= `minRatio` × the teaser), so a paywall or
 *     boilerplate page cannot replace a good teaser with worse text;
 *   - any failure (fetch error, too-short result) leaves the teaser untouched;
 *   - the number of fetches per run is bounded by a shared, mutable budget.
 *
 * Fetching uses the caller-supplied `fetchText`, so the SSRF guard, redirect
 * re-validation, timeout, size cap and retries all apply automatically. We do
 * NOT consult robots.txt; the SSRF guard and the per-run cap are the controls.
 */

/** Sane defaults; callers may override any field via `runPipeline` options. */
export const DEFAULT_FULL_TEXT = {
  enabled: true,
  maxPerRun: 25,
  minTeaserChars: 500,
  minFetchedChars: 500,
  minRatio: 2,
};

/**
 * Normalise user-supplied options into a complete, clamped config.
 *
 * @param {object} [opts]
 * @returns {{ enabled:boolean, maxPerRun:number, minTeaserChars:number, minFetchedChars:number, minRatio:number }}
 */
export function resolveFullTextOptions(opts = {}) {
  const merged = { ...DEFAULT_FULL_TEXT, ...(opts || {}) };
  const toPositiveInt = (v, fallback) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback);
  return {
    enabled: merged.enabled !== false,
    maxPerRun: toPositiveInt(merged.maxPerRun, DEFAULT_FULL_TEXT.maxPerRun),
    minTeaserChars: toPositiveInt(merged.minTeaserChars, DEFAULT_FULL_TEXT.minTeaserChars),
    minFetchedChars: toPositiveInt(merged.minFetchedChars, DEFAULT_FULL_TEXT.minFetchedChars),
    minRatio:
      Number.isFinite(merged.minRatio) && merged.minRatio > 0
        ? merged.minRatio
        : DEFAULT_FULL_TEXT.minRatio,
  };
}

/** Create the shared per-run fetch budget. One budget is shared by every source. */
export function createFetchBudget(maxPerRun) {
  return { remaining: Math.max(0, Math.floor(maxPerRun)) };
}

/**
 * Decide whether a fetched text should replace the teaser.
 *
 * @param {string} teaser   stripped current content
 * @param {string} fetched  stripped candidate content
 * @param {{ minFetchedChars:number, minRatio:number }} cfg
 */
function isSubstantiallyLonger(teaser, fetched, cfg) {
  if (!fetched) return false;
  if (fetched.length < cfg.minFetchedChars) return false;
  if (fetched.length < teaser.length * cfg.minRatio) return false;
  return true;
}

/**
 * Enrich one normalised item's `content` from its link when it is a teaser.
 *
 * Mutates and returns a (possibly new) item. On any failure or insufficient
 * gain the original item is returned unchanged, so the run is never broken by
 * an unreachable article.
 *
 * @param {import('../parse/item.js').NormalisedItem} item
 * @param {object} params
 * @param {Function} params.fetch        fetch implementation `fetchText(url, opts)`
 * @param {object} [params.logger]
 * @param {{ minTeaserChars:number, minFetchedChars:number, minRatio:number }} params.cfg
 * @param {{ remaining:number }} params.budget   shared per-run fetch budget
 * @returns {Promise<import('../parse/item.js').NormalisedItem>}
 */
export async function enrichItemFullText(item, { fetch, logger, cfg, budget }) {
  const teaser = stripHtml(item.content);
  if (!item.link || teaser.length >= cfg.minTeaserChars) return item;
  if (!budget || budget.remaining <= 0) return item;

  budget.remaining -= 1;
  let fetched;
  try {
    const res = await fetch(item.link, { logger, label: 'full-text' });
    fetched = stripHtml(res.body);
  } catch (err) {
    logger?.debug?.({ link: item.link, message: err?.message }, 'full-text fetch failed');
    return item;
  }

  if (!isSubstantiallyLonger(teaser, fetched, cfg)) {
    logger?.debug?.(
      { link: item.link, teaserChars: teaser.length, fetchedChars: fetched.length },
      'full-text not longer; keeping teaser',
    );
    return item;
  }

  logger?.debug?.({ link: item.link, fromChars: teaser.length, toChars: fetched.length }, 'full-text applied');
  return {
    ...item,
    content: fetched,
    // Recompute after the swap: the stored body and the hash must stay in step.
    contentHash: contentHash({ link: item.link, title: item.title, publishedAt: item.publishedAt }),
  };
}

/**
 * Enrich a list of items, sharing one per-run fetch budget.
 *
 * @param {Array<import('../parse/item.js').NormalisedItem>} items
 * @param {object} params
 * @param {Function} params.fetch
 * @param {object} [params.logger]
 * @param {object} params.options  raw full-text options (see {@link resolveFullTextOptions})
 * @param {{ remaining:number }} params.budget
 */
export async function enrichItemsFullText(items, { fetch, logger, options, budget }) {
  const cfg = resolveFullTextOptions(options);
  if (!cfg.enabled || !fetch) return items;
  const out = [];
  for (const item of items) {
    out.push(await enrichItemFullText(item, { fetch, logger, cfg, budget }));
  }
  return out;
}

export default { DEFAULT_FULL_TEXT, resolveFullTextOptions, createFetchBudget, enrichItemFullText, enrichItemsFullText };
