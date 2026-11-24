/**
 * Per-section story suggestions — the isolated recommender seam.
 *
 * THE ISOLATION CONTRACT
 * ----------------------
 * This module is the SINGLE source of "which wire stories might fill a section".
 * Today it is DETERMINISTIC v1: a wire event "fits" a section when the event's
 * `functions` array includes that section's pillar id. The Front Page and its
 * `PulseSuggestRow` component consume ONLY this function — they never re-derive
 * eligibility themselves.
 *
 * When the LLM recommender lands (a `kind: 'recommend'` call that writes to the
 * `ai_judgement` ledger), that becomes the backing data source, but the UI
 * contract does NOT change: `suggestForSection(sectionFunctionId, wireEvents,
 * opts)` still returns an array of `{ id, title, source, functions, ... }`
 * suggestion objects. The seam is this one function's internals — swap the
 * deterministic filter for a recommender fetch and no component is rewritten.
 * (The future API can simply return the same event-shaped objects, or map its
 * candidates onto them; either way the props stay put.)
 *
 * DETERMINISTIC v1 RULE
 * ---------------------
 * Candidate = a wire event whose `functions` includes `sectionFunctionId`.
 * Excluded = events that already have a publish item bound to them
 * (`publishItemId`) — a story already written up is no longer a "raw material"
 * suggestion, so the bound-item check is the sole exclusion mechanism.
 *
 * Priority (strongest first):
 *   1. accepted   — the reviewer already triaged it in ("use this today").
 *   2. reviewed   — a `new` event is untriaged; anything else (dismissed) is
 *                   explicitly triaged out.
 *   3. newest     — most recently published wins ties.
 *
 * A dismissed event is deliberately NOT a candidate: the reviewer said no.
 */

/** Reviewer triage → priority rank (lower is stronger). Accepted first. */
const REVIEW_RANK = { accepted: 0, new: 1, dismissed: 2 };

/** Milliseconds for an ISO instant, or 0 when absent/invalid (sorts last). */
function publishedMs(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Triage rank of an event (unknown statuses rank with `new`). */
function reviewRank(reviewStatus) {
  return REVIEW_RANK[reviewStatus] ?? REVIEW_RANK.new;
}

/**
 * Does this event fit the given section? A fit is membership of the section's
 * pillar (functionId) in the event's `functions`.
 *
 * @param {number} sectionFunctionId
 * @param {unknown} event
 * @returns {boolean}
 */
export function eventFitsSection(sectionFunctionId, event) {
  const fns = event?.functions;
  return Array.isArray(fns) && fns.includes(sectionFunctionId);
}

/**
 * Rank candidates in place order: priority class, then newest published.
 * Pure comparator — does not mutate.
 */
function byPriorityThenRecency(a, b) {
  const rank = reviewRank(a.reviewStatus) - reviewRank(b.reviewStatus);
  if (rank !== 0) return rank;
  return publishedMs(b.publishedAt) - publishedMs(a.publishedAt);
}

/**
 * The suggestions for one section, ready to render as chips.
 *
 * @param {number} sectionFunctionId  the section's pillar id (1..8)
 * @param {Array<object>} wireEvents  the wire-event DTOs the Wire already loads
 *        (`{ id, title, sourceName, functions, reviewStatus, publishedItemId?,
 *          publishItemId?, publishedAt }`)
 * @param {{ limit?: number }} [opts]
 *        `limit` — max suggestions to return (default 2).
 * @returns {Array<object>} up to `limit` events, strongest suggestion first
 */
export function suggestForSection(sectionFunctionId, wireEvents, { limit = 2 } = {}) {
  if (!Array.isArray(wireEvents) || wireEvents.length === 0) return [];

  return wireEvents
    .filter((event) => {
      if (!event || !eventFitsSection(sectionFunctionId, event)) return false;
      // Already written up — a publish item is bound to the event, so it is no
      // longer raw material to suggest (rule (b), the sole exclusion).
      if (event.publishItemId) return false;
      // Explicitly triaged out by a reviewer.
      if (event.reviewStatus === 'dismissed') return false;
      return true;
    })
    .sort(byPriorityThenRecency)
    .slice(0, Math.max(0, limit));
}

export default { suggestForSection, eventFitsSection };
