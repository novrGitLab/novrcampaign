import { stripHtml, contentHash } from '../parse/item.js';
import { extractArticle } from './extractArticle.js';

/**
 * Full-text enrichment for feed items.
 *
 * The goal is that EVERY pulled item is stored with the article's own full
 * body, so a downstream consumer (the AI rewrite/recommendation) reads the whole
 * article rather than a two-to-three sentence teaser. Many feeds only deliver a
 * teaser (often truncated with "[...]"); others deliver most or all of the body.
 * This module fetches the item's link and extracts its readable text, replacing
 * the feed content only when the fetch materially improves it.
 *
 * It is deliberately consumer-agnostic:
 *   - EVERY item with a `link` is fetched — there is no "short teaser only"
 *     trigger gate; a full-content feed item is fetched too, because the feed
 *     body is often still truncated relative to the article;
 *   - the RESULT gates decide whether the fetch replaces the feed content:
 *     the fetched text must be at least `minFetchedChars` long, strictly longer
 *     than the existing stripped content, and not a near-duplicate of it (see
 *     {@link isMaterialImprovement}) — so a paywall or boilerplate page cannot
 *     replace good feed text with worse, and near-identical text does not churn
 *     the content hash;
 *   - any failure (fetch error, too-short/duplicate result) leaves the feed
 *     content untouched;
 *   - the number of fetches per run is bounded by a shared, mutable budget
 *     (`maxPerRun`, sized to a full day of news).
 *
 * Fetching uses the caller-supplied `fetchText`, so the SSRF guard, redirect
 * re-validation, timeout, size cap and retries all apply automatically. We do
 * NOT consult robots.txt; the SSRF guard and the per-run cap are the controls.
 */

/** Sane defaults; callers may override any field via `runPipeline` options. */
export const DEFAULT_FULL_TEXT = {
  enabled: true,
  // A full day of news across all sources must be able to enrich in one run.
  maxPerRun: 400,
  minFetchedChars: 500,
  // Length of the leading window compared to detect a near-duplicate page.
  duplicatePrefixChars: 200,
  // Upper bound (characters) on the STORED extracted body. Article extraction
  // already strips the page chrome; this is the second guard against a
  // pathological page (or a noisy extractor miss) bloating the stored body and
  // what the downstream AI reads. The cap is applied AFTER the improvement gates
  // (a 225k article that becomes 20k is still an improvement → adopted, capped).
  maxBodyChars: 20000,
};

/**
 * Normalise user-supplied options into a complete, clamped config.
 *
 * @param {object} [opts]
 * @returns {{ enabled:boolean, maxPerRun:number, minFetchedChars:number, duplicatePrefixChars:number, maxBodyChars:number }}
 */
export function resolveFullTextOptions(opts = {}) {
  const merged = { ...DEFAULT_FULL_TEXT, ...(opts || {}) };
  const toPositiveInt = (v, fallback) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback);
  return {
    enabled: merged.enabled !== false,
    maxPerRun: toPositiveInt(merged.maxPerRun, DEFAULT_FULL_TEXT.maxPerRun),
    minFetchedChars: toPositiveInt(merged.minFetchedChars, DEFAULT_FULL_TEXT.minFetchedChars),
    duplicatePrefixChars: toPositiveInt(
      merged.duplicatePrefixChars,
      DEFAULT_FULL_TEXT.duplicatePrefixChars,
    ),
    maxBodyChars: toPositiveInt(merged.maxBodyChars, DEFAULT_FULL_TEXT.maxBodyChars),
  };
}

/** Create the shared per-run fetch budget. One budget is shared by every source. */
export function createFetchBudget(maxPerRun) {
  return { remaining: Math.max(0, Math.floor(maxPerRun)) };
}

/**
 * Decide whether a fetched text should replace the existing feed content.
 *
 * The result gates (all must hold):
 *   1. the fetched text is non-empty and at least `minFetchedChars` long, so a
 *      stub/error page cannot replace real content;
 *   2. it is strictly longer than the existing stripped content — fetching a
 *      shorter page is never an improvement;
 *   3. it is NOT a near-duplicate of the existing content. A feed that already
 *      carries the full body yields a page whose opening matches the feed text;
 *      a matching prefix with only a small length gain would churn the `contentHash` for no gain. The cheap check
 *      compares the first `duplicatePrefixChars` characters, lowercased.
 *
 * @param {string} existing stripped current content
 * @param {string} fetched  stripped candidate content
 * @param {{ minFetchedChars:number, duplicatePrefixChars:number }} cfg
 */
function isMaterialImprovement(existing, fetched, cfg) {
  if (!fetched) return false;
  if (fetched.length < cfg.minFetchedChars) return false;
  if (fetched.length <= existing.length) return false;
  const gain = fetched.length - existing.length;
  if (gain < Math.max(120, existing.length * 0.08) && isNearDuplicate(existing, fetched, cfg.duplicatePrefixChars)) return false;
  return true;
}

/** True when `a` and `b` share an identical lowercased leading window. */
function isNearDuplicate(a, b, prefixChars) {
  const n = Math.min(prefixChars, a.length, b.length);
  if (n <= 0) return false;
  return a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
}

/**
 * Choose the readable body from a fetched page: the article extraction when it
 * yields at least `minFetchedChars`, otherwise the full stripped page (the
 * pre-extraction behaviour — a page with little structure must still be able to
 * upgrade a thin teaser). Either way the result is a candidate for the gates.
 *
 * @param {string} html      raw fetched body
 * @param {number} minFetchedChars
 * @returns {{ text:string, strategy:string }}
 */
function readableBodyOf(html, minFetchedChars) {
  const { text, strategy } = extractArticle(html);
  if (text.length >= minFetchedChars) return { text, strategy };
  return { text: stripHtml(html), strategy: 'fallback' };
}

/**
 * Truncate `text` to at most `maxChars`, preferring a sentence boundary and
 * then a paragraph/word boundary, and appending a trailing "…" when clipped.
 * Returns the text unchanged when it already fits.
 */
export function capBody(text, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;
  // Leave room for the ellipsis so the final string is <= maxChars.
  const budget = Math.max(0, maxChars - 1);
  const window = text.slice(0, budget);
  // Prefer the last sentence end, then the last paragraph break, then a space.
  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  );
  const paragraph = window.lastIndexOf('\n\n');
  const space = window.lastIndexOf(' ');
  let cut = sentence;
  if (cut < budget * 0.5) cut = paragraph;
  if (cut < budget * 0.5) cut = space;
  if (cut <= 0) cut = budget;
  return `${window.slice(0, cut).trimEnd()}…`;
}

/**
 * Enrich one normalised item's `content` from its link.
 *
 * Every item with a `link` is fetched; the result is adopted only when it
 * materially improves on the existing content (see {@link isMaterialImprovement}).
 * Mutates and returns a (possibly new) item. On any failure or insufficient
 * gain the original item is returned unchanged, so the run is never broken by an
 * unreachable article.
 *
 * @param {import('../parse/item.js').NormalisedItem} item
 * @param {object} params
 * @param {Function} params.fetch        fetch implementation `fetchText(url, opts)`
 * @param {object} [params.logger]
 * @param {{ minFetchedChars:number, duplicatePrefixChars:number }} params.cfg
 * @param {{ remaining:number }} params.budget   shared per-run fetch budget
 * @returns {Promise<import('../parse/item.js').NormalisedItem>}
 */
export async function enrichItemFullText(item, { fetch, logger, cfg, budget, publisherUrl }) {
  // Tolerate a partial `cfg` from direct callers: fill any missing gate from
  // the defaults so a caller that does not know the current option names still
  // gets the documented behaviour.
  const gates = resolveFullTextOptions(cfg);
  if (!item.link) return item;
  if (!budget || budget.remaining <= 0) return item;

  const existing = stripHtml(item.content);
  budget.remaining -= 1;
  let candidate;
  try {
    const allowedHost = publisherUrl ? new URL(publisherUrl).hostname.toLowerCase().replace(/^www\./,'') : undefined;
    if (allowedHost && new URL(item.link).hostname.toLowerCase().replace(/^www\./,'') !== allowedHost) return item;
    const res = await fetch(item.link, { logger, label: 'full-text', allowedHost, maxAttempts: 1 });
    candidate = readableBodyOf(res.body, gates.minFetchedChars);
  } catch (err) {
    logger?.debug?.({ link: item.link, message: err?.message }, 'full-text fetch failed');
    return item;
  }

  const fetched = candidate.text;
  if (!isMaterialImprovement(existing, fetched, gates)) {
    logger?.debug?.(
      { link: item.link, existingChars: existing.length, fetchedChars: fetched.length, strategy: candidate.strategy },
      'full-text not a material improvement; keeping feed content',
    );
    return item;
  }

  // Cap AFTER the gates: an improvement that is enormous is still adopted, just
  // bounded, so the stored body (and what the AI reads) stays reasonable.
  const stored = capBody(fetched, gates.maxBodyChars);

  logger?.debug?.(
    { link: item.link, fromChars: existing.length, toChars: stored.length, rawChars: fetched.length, strategy: candidate.strategy },
    'full-text applied',
  );
  return {
    ...item,
    content: stored,
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
export async function enrichItemsFullText(items, { fetch, logger, options, budget, publisherUrl }) {
  const cfg = resolveFullTextOptions(options);
  if (!cfg.enabled || !fetch) return items;
  const out = [];
  for (const item of items) {
    out.push(await enrichItemFullText(item, { fetch, logger, cfg, budget, publisherUrl }));
  }
  return out;
}

export default { DEFAULT_FULL_TEXT, resolveFullTextOptions, createFetchBudget, enrichItemFullText, enrichItemsFullText, capBody };
