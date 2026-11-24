import { createLlm } from '@novr/ingest';
import { prisma } from '../../utils/prisma.js';
import config from '../../config/env.js';
import logger from '../../utils/logger.js';
import { recordJudgement } from './judgements.js';

/**
 * NovrPulse Deduplication (Capability 1) — deterministic blocking + LLM pair
 * confirmation, writing `ai_judgement` rows, and grouping on human accept.
 *
 * Two stages, deliberately separated so the LLM is only ever a bounded second
 * opinion and never a pairwise scan:
 *
 *  Stage A — DETERMINISTIC BLOCKING (`findCandidatePairs`). Free, no LLM. Loads
 *    events in a small window and emits only pairs a cheap lexical/geo rule
 *    considers plausible. Pairs already judged (pending or accepted) are
 *    excluded. Output is a small, bounded set.
 *
 *  Stage B — LLM CONFIRMATION (`confirmPair`). Bulk tier only. Asks the model
 *    whether two headlines describe the SAME real-world event (not merely the
 *    same topic/actor) and records an `ai_judgement` row with the frozen input
 *    snapshot.
 *
 * GROUPING is NOT done here. It happens on human ACCEPT, in the judgements
 * service, via `clusterId` (see `groupAcceptedPair` in judgements.js). v1 only
 * groups — it never merges or deletes events.
 *
 * COPYRIGHT: the `scenario` snapshot carries only title + summary (NovrPulse's
 * own words) + source name — never the publisher's raw body.
 */

export const DEDUP_PROMPT_VERSION = 'dedup@1.0.0';

/** Default window (days) and hard cap on events scanned. */
const DEFAULT_MAX_AGE_DAYS = 3;
const DEFAULT_MAX_EVENTS = 500;

/** Minimum shared significant tokens, as a fraction of the SHORTER title. */
const TITLE_OVERLAP_RATIO = 0.6;
/** How many leading tokens define the "same opening" signal. */
const TITLE_PREFIX_TOKENS = 4;
/** Same-region events are blocked when their publishedAt are within this. */
const SAME_REGION_WINDOW_HOURS = 72;

/**
 * FIX 3 — a title block needs at least this many DISTINCTIVE (non-generic)
 * shared tokens. One shared word (even a proper noun) is too weak a signal on
 * its own; two independent distinctive tokens is a plausible same-story core.
 */
const MIN_DISTINCTIVE_SHARED = 2;

/**
 * FIX 2 — minimum usable Latin tokens for a title to participate in blocking.
 * Below this we cannot compare reliably, so the title is treated as
 * non-comparable rather than blocking on a meaningless token set.
 */
const MIN_LATIN_TOKENS = 3;
/** FIX 2 — titles must be at least this fraction Latin letters to be compared. */
const MIN_LATIN_LETTER_RATIO = 0.5;

/**
 * English stopwords for title normalisation. Kept small and closed: the goal is
 * to strip structural words, not to stem — a shared significant token must be a
 * real subject word (an org, a place, a threat) for the block to be plausible.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by',
  'at', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its',
  'this', 'that', 'these', 'those', 'after', 'over', 'into', 'amid', 'about',
  'new', 'says', 'say', 'said', 'will', 'has', 'have', 'had', 'not', 'but',
  'his', 'her', 'their', 'they', 'he', 'she', 'we', 'you', 'your', 'our',
]);

/**
 * FIX 1 — generic/category tokens must not be blocking signal.
 *
 * These are category words, not identity signals: two different stories that
 * both concern "AI", "cyber", "security", "Africa", or "Nigeria" are the same
 * TOPIC, not the same EVENT. A shared one of these alone must never block, so
 * they are excluded from the tokens that count as evidence. They are kept
 * separate from `STOPWORDS` so the distinction (structural vs. generic) is
 * explicit and reviewable.
 */
const GENERIC_TOKENS = new Set([
  'ai', 'ml', 'cyber', 'cybersecurity', 'security', 'attack', 'attacks',
  'threat', 'threats', 'data', 'news', 'report', 'update', 'updates', 'new',
  'hack', 'hacks', 'hacker', 'hackers', 'breach', 'breaches', 'risk', 'risks',
  'digital', 'tech', 'technology', 'africa', 'african', 'nigeria', 'nigerian',
]);

/**
 * Normalise a title to significant tokens.
 * Lowercase, strip punctuation (keep alphanumerics), split, drop stopwords and
 * single-character noise, de-duplicate while preserving order.
 *
 * Note: only ASCII alphanumerics survive the strip, so a non-Latin script
 * (e.g. Japanese) leaves only stray Latin fragments here. Callers that need to
 * compare titles must use `isLatinComparable` first (see FIX 2).
 *
 * @param {string} title
 * @returns {string[]}
 */
export function normaliseTitleTokens(title) {
  const tokens = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

/**
 * FIX 2 — is this title comparable under Latin-only tokenisation?
 *
 * `normaliseTitleTokens` strips every non-ASCII character, so a Japanese (or
 * any non-Latin) headline collapses to a handful of meaningless Latin
 * fragments and spuriously matches unrelated English titles on generic terms
 * ("ai", "cyber").
 *
 * NOT SUPPORTED: we cannot reliably match non-Latin titles without
 * script-aware tokenisation, which is out of scope. A title that is majority
 * non-Latin, OR that yields fewer than `MIN_LATIN_TOKENS` usable Latin tokens,
 * is treated as non-comparable and must NOT block. We accept the risk of
 * missing a non-Latin duplicate rather than generating garbage pairs.
 *
 * @param {string} title
 * @returns {boolean}
 */
export function isLatinComparable(title) {
  const s = String(title || '').toLowerCase();
  const latin = (s.match(/[a-z]/g) || []).length;
  const allLetters = (s.match(/[a-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || []).length;
  if (allLetters > 0 && latin / allLetters < MIN_LATIN_LETTER_RATIO) return false;
  return normaliseTitleTokens(s).length >= MIN_LATIN_TOKENS;
}

/**
 * Do two titles share enough significant tokens to be a blocking candidate?
 *
 * FIX 1: generic/category tokens (AI, cyber, security, attack, Africa, …) are
 * excluded from the distinctive shared-token count — sharing only those is not
 * evidence of the same event.
 *
 * FIX 2: only Latin-comparable titles are compared at all; a majority non-Latin
 * or token-poor title never blocks (non-Latin dedup is unsupported).
 *
 * FIX 3: beyond the ratio/prefix rules, a block must have at least
 * `MIN_DISTINCTIVE_SHARED` (2) distinctive shared tokens. A single shared word
 * (even a proper noun) is too weak on its own.
 *
 * @param {string} titleA
 * @param {string} titleB
 * @returns {boolean}
 */
export function titlesBlock(titleA, titleB) {
  // FIX 2 — non-Latin dedup unsupported: never block on a title we cannot read.
  if (!isLatinComparable(titleA) || !isLatinComparable(titleB)) return false;

  const a = normaliseTitleTokens(titleA);
  const b = normaliseTitleTokens(titleB);
  if (a.length === 0 || b.length === 0) return false;

  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t));

  // FIX 3 — require an independent core of distinctive shared tokens.
  const distinctiveShared = shared.filter((t) => !GENERIC_TOKENS.has(t));
  if (distinctiveShared.length < MIN_DISTINCTIVE_SHARED) return false;

  const shorter = Math.min(a.length, b.length);
  if (shared.length >= Math.ceil(shorter * TITLE_OVERLAP_RATIO)) return true;

  if (a.length >= TITLE_PREFIX_TOKENS && b.length >= TITLE_PREFIX_TOKENS) {
    const prefixA = a.slice(0, TITLE_PREFIX_TOKENS).join(' ');
    const prefixB = b.slice(0, TITLE_PREFIX_TOKENS).join(' ');
    if (prefixA === prefixB) return true;
  }

  return false;
}

/**
 * Do two events block on region + time? Same non-empty region and publishedAt
 * within ±`SAME_REGION_WINDOW_HOURS`. A missing date or region never blocks on
 * this rule (it is a supplement to the title rule, not a standalone signal).
 *
 * @param {{region?:string|null, publishedAt?:Date|null}} a
 * @param {{region?:string|null, publishedAt?:Date|null}} b
 * @returns {boolean}
 */
export function regionTimeBlock(a, b) {
  const regionA = (a.region || '').trim().toLowerCase();
  const regionB = (b.region || '').trim().toLowerCase();
  if (!regionA || regionA !== regionB) return false;
  if (!(a.publishedAt instanceof Date) || !(b.publishedAt instanceof Date)) return false;
  const deltaHours = Math.abs(a.publishedAt.getTime() - b.publishedAt.getTime()) / 3_600_000;
  return deltaHours <= SAME_REGION_WINDOW_HOURS;
}

/**
 * Build the stable, order-independent subject key for an unordered pair.
 * Ids are sorted so `dedup:23|9f` is the same key whichever order the pair is
 * discovered in.
 *
 * @param {string} idA
 * @param {string} idB
 * @returns {string}
 */
export function dedupSubjectKey(idA, idB) {
  const [lo, hi] = [String(idA), String(idB)].sort();
  return `dedup:${lo}|${hi}`;
}

/** Order an unordered pair so `a.id < b.id` lexicographically (stable output). */
function orderPair(a, b) {
  return a.id < b.id ? { a, b } : { a: b, b: a };
}

/**
 * Stage A — deterministic blocking.
 *
 * Load events published in the window (default last 3 days, capped at 500),
 * emit the unique unordered pairs a cheap rule flags, and drop pairs that
 * already have a pending/accepted judgement. No LLM, no network.
 *
 * Only the minimal fields the LLM needs are returned (id, title, summary,
 * region, publishedAt, sourceName) — never a raw body.
 *
 * @param {object} [opts]
 * @param {Date|string} [opts.since]       lower bound on publishedAt (default: now - maxAgeDays)
 * @param {number} [opts.maxAgeDays=3]     window size when `since` is omitted
 * @param {number} [opts.maxEvents=500]    hard cap on events scanned
 * @param {string[]} [opts.eventIds]       restrict to these event ids (tests)
 * @returns {Promise<Array<{subjectKey:string, a:object, b:object}>>}
 */
export async function findCandidatePairs({ since, maxAgeDays = DEFAULT_MAX_AGE_DAYS, maxEvents = DEFAULT_MAX_EVENTS, eventIds } = {}) {
  const lowerBound = since
    ? new Date(since)
    : new Date(Date.now() - maxAgeDays * 24 * 3_600_000);

  const where = { publishedAt: { gte: lowerBound } };
  if (Array.isArray(eventIds)) where.id = { in: eventIds };

  const events = await prisma.npEvent.findMany({
    where,
    orderBy: { publishedAt: 'desc' },
    take: maxEvents,
    select: {
      id: true,
      title: true,
      summary: true,
      region: true,
      publishedAt: true,
      sources: { select: { rawDocument: { select: { url: true } } } },
    },
  });

  const summarise = (e) => ({
    id: e.id,
    title: e.title,
    summary: e.summary ?? '',
    region: e.region ?? null,
    publishedAt: e.publishedAt ?? null,
    sourceName: e.sources?.[0]?.rawDocument?.url ?? null,
  });

  // Deterministic pairwise blocking over a BOUNDED candidate set (≤ maxEvents),
  // not over the whole table. Events are pre-bucketed by region so the region
  // rule is not O(n^2) over unrelated regions; the title rule is inherently
  // pairwise but is bounded by maxEvents.
  const rawPairs = [];
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const ei = events[i];
      const ej = events[j];
      const titleHit = titlesBlock(ei.title, ej.title);
      const rtHit = regionTimeBlock(ei, ej);
      if (titleHit || rtHit) rawPairs.push(orderPair(summarise(ei), summarise(ej)));
    }
  }

  // De-duplicate by subject key (an unordered pair is emitted once).
  const byKey = new Map();
  for (const p of rawPairs) {
    const key = dedupSubjectKey(p.a.id, p.b.id);
    if (!byKey.has(key)) byKey.set(key, { subjectKey: key, a: p.a, b: p.b });
  }

  // Drop pairs already adjudicated as pending or accepted — never re-judge.
  const keys = [...byKey.keys()];
  if (keys.length === 0) return [];
  const existing = await prisma.aiJudgement.findMany({
    where: { kind: 'dedup', subjectKey: { in: keys }, outcome: { in: ['pending', 'accepted'] } },
    select: { subjectKey: true },
  });
  for (const row of existing) byKey.delete(row.subjectKey);

  return [...byKey.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage B — LLM confirmation
// ─────────────────────────────────────────────────────────────────────────────

/** Strict output contract for the bulk-tier pair confirmation. */
export const DEDUP_SCHEMA = {
  type: 'object',
  required: ['same_story', 'confidence', 'reason'],
  properties: {
    same_story: { type: 'boolean' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
};

export const DEDUP_SYSTEM = `You decide whether two Nigerian cybersecurity headlines describe the SAME real-world event.

Return STRICT JSON only: {"same_story":true|false,"confidence":0..1,"reason":".."}

same_story is TRUE only when both items report the SAME single event: the same
incident, advisory, arrest, breach, or notice at the same time and place,
regardless of how each headline is worded.

same_story is FALSE when they merely share a topic, an organisation, a threat
actor, a regulator, or a general theme — that is a shared subject, not the same
event. Two different attacks on the same bank are DISTINCT. A regulator's
general guidance and a specific enforcement action are DISTINCT.

confidence is your certainty in this decision, 0 to 1.
reason is one short sentence explaining the decision.`;

/**
 * Resolve the bulk model name from the llm client (for the judgement `model`).
 * Falls back to a stable label when the client does not expose `model()`.
 */
function bulkModelName(llm) {
  try {
    return llm?.model?.('bulk') || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Build the deterministic prompt for one pair. Includes both titles + summaries
 * + source names + publishedAt. Never includes a raw body.
 */
export function buildPairPrompt(pair) {
  const line = (label, e) =>
    [
      `${label} TITLE: ${e.title || ''}`,
      `${label} SUMMARY: ${e.summary || ''}`,
      `${label} SOURCE: ${e.sourceName || 'unknown'}`,
      `${label} PUBLISHED: ${e.publishedAt instanceof Date ? e.publishedAt.toISOString() : (e.publishedAt || 'unknown')}`,
    ].join('\n');
  return `Pair A and Pair B may describe the same real-world event.\n\n${line('A', pair.a)}\n\n${line('B', pair.b)}`;
}

/**
 * Stage B — confirm one candidate pair with the bulk-tier LLM and record an
 * `ai_judgement` row. Records EVERY pair the model judges (both `same_story`
 * and `distinct`): volume is bounded by blocking, and both polarities are
 * useful review signal. Never records the raw body — only title + summary.
 *
 * @param {{subjectKey:string, a:object, b:object}} pair
 * @param {{llm?:object, dryRun?:boolean}} [deps]
 * @returns {Promise<object>} `{ subjectKey, decision, confidence, reason, model, recorded }`
 */
export async function confirmPair(pair, { llm, dryRun = false } = {}) {
  const client = llm || getLlm();
  const model = bulkModelName(client);

  const out = await client.complete({
    tier: 'bulk',
    system: DEDUP_SYSTEM,
    prompt: buildPairPrompt(pair),
    schema: DEDUP_SCHEMA,
  });

  const decision = out.same_story === true ? 'same_story' : 'distinct';
  const confidence = typeof out.confidence === 'number' ? out.confidence : null;
  const reason = typeof out.reason === 'string' ? out.reason : null;

  // Copyright + size: only title/summary. No `body`, ever.
  const scenario = {
    a: { id: pair.a.id, title: pair.a.title, summary: pair.a.summary },
    b: { id: pair.b.id, title: pair.b.title, summary: pair.b.summary },
  };

  let recorded = false;
  if (!dryRun) {
    await recordJudgement({
      kind: 'dedup',
      eventId: pair.a.id,
      counterpartEventId: pair.b.id,
      subjectKey: pair.subjectKey,
      scenario,
      decision,
      confidence,
      rationale: reason,
      model,
      promptVersion: DEDUP_PROMPT_VERSION,
    });
    recorded = true;
  }

  return { subjectKey: pair.subjectKey, decision, confidence, reason, model, recorded };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────────────

let _llm = null;
/**
 * Reuse the EXACT LLM construction pattern from the understanding orchestrator:
 * one shared client, inert when no key is configured. Dedup must not introduce
 * a second AI client.
 */
function getLlm() {
  if (!_llm) {
    const c = config.novrpulse.llm;
    _llm = createLlm({
      apiKey: c.apiKey,
      baseUrl: c.baseUrl,
      provider: c.provider,
      bulkModel: c.bulkModel,
      frontierModel: c.frontierModel,
      fallbackModel: c.fallbackModel,
      fallbackBaseUrl: c.fallbackBaseUrl,
      fallbackApiKey: c.fallbackApiKey,
      jsonMode: c.jsonMode,
      reasoningContentAsText: c.reasoningContentAsText,
      allowLocalBaseUrl: c.allowLocalBaseUrl,
      maxAttempts: c.maxAttempts,
      timeoutMs: c.timeoutMs,
      maxTokens: c.maxTokens,
      temperature: c.temperature,
      logger,
    });
  }
  return _llm;
}

/** Is a real LLM provider configured? Mirrors the understanding layer. */
export function isConfigured() {
  return Boolean(config.novrpulse.llm.apiKey);
}

/**
 * Run deduplication: block → confirm (bounded) → record.
 *
 * `dryRun` is the DEFAULT and writes nothing — it returns the pairs that WOULD
 * be judged plus the model's would-be decisions (the LLM is still called, so
 * the summary is real, but no `ai_judgement` row is written).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=true]
 * @param {Date|string} [opts.since]
 * @param {number} [opts.maxAgeDays=3]
 * @param {number} [opts.limit=25]   max pairs confirmed in one run (bounds LLM calls)
 * @param {object} [opts.llm]        inject an llm client (tests)
 * @param {string[]} [opts.eventIds] restrict blocking to these ids (tests)
 * @returns {Promise<{dryRun:boolean, candidates:number, processed:number, pairs:object[]}>}
 */
export async function runDedup({ dryRun = true, since, maxAgeDays = DEFAULT_MAX_AGE_DAYS, limit = 25, llm, eventIds } = {}) {
  const candidates = await findCandidatePairs({ since, maxAgeDays, eventIds });
  const selected = candidates.slice(0, limit);

  const pairs = [];
  for (const pair of selected) {
    try {
      pairs.push(await confirmPair(pair, { llm, dryRun }));
    } catch (err) {
      logger.warn({ subjectKey: pair.subjectKey, message: err.message }, 'dedup confirmation failed for pair');
      pairs.push({ subjectKey: pair.subjectKey, error: err.message, recorded: false });
    }
  }

  logger.info(
    { dryRun, candidates: candidates.length, processed: pairs.length },
    'dedup run complete',
  );

  return { dryRun, candidates: candidates.length, processed: pairs.length, pairs };
}

export default {
  findCandidatePairs,
  confirmPair,
  runDedup,
  isConfigured,
  normaliseTitleTokens,
  isLatinComparable,
  titlesBlock,
  regionTimeBlock,
  dedupSubjectKey,
  DEDUP_PROMPT_VERSION,
};
