/**
 * Publication gates — deterministic, fail-closed checks run at `PublishItem`
 * creation.
 *
 * No LLM, no I/O, no clock. Given a candidate (event + rendered body + licence
 * inputs), `assertPublishable` either returns cleanly or throws a
 * `GateError` describing the first failing gate.
 */

import { isArrestItem, personEntityNames, findPersonLikeNames, knownNonPersonTokens } from './templates/f7.js';

/** Deterministic gate failure. `code` is stable for callers and tests. */
export class GateError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'GateError';
    this.code = code;
    this.details = details;
  }
}

/** Licence statuses that block publication entirely (01-policies.md §1.2). */
const DENIED_LICENCE_STATUSES = new Set(['denied']);

/**
 * Gate 1 — licence not denied (01-policies.md §1.2, §3.4).
 *
 * `denied` blocks publication entirely, for every tier, for EVERY source. An
 * event commonly has more than one source; a `denied` status on any one of them
 * forbids publishing the event (defect D4: the original gate only looked at
 * `sources[0]`, so a denied source at index ≥ 1 bypassed the gate).
 *
 * `restricted`/`unknown` are recorded on the source and do not block this gate;
 * they are handled by editorial policy (paywalled sources are quote-limited,
 * not blocked).
 *
 * @param {object} opts
 * @param {string} [opts.licenceStatus]           Single-source convenience.
 * @param {Array<string|undefined>} [opts.licenceStatuses] All source statuses.
 * @throws {GateError} code 'licence_denied'
 */
export function assertLicence({ licenceStatus, licenceStatuses } = {}) {
  const statuses = [
    ...(Array.isArray(licenceStatuses) ? licenceStatuses : []),
    ...(licenceStatus === undefined ? [] : [licenceStatus]),
  ];
  for (const status of statuses) {
    if (status && DENIED_LICENCE_STATUSES.has(String(status).toLowerCase())) {
      throw new GateError('licence_denied', `Source licence status "${status}" forbids publication`, {
        licenceStatus: status,
      });
    }
  }
}

/**
 * Gate 2 — F7 public-tier namelessness for arrest/accusation items
 * (01-policies.md §2.5). FAIL-CLOSED (defects D1 + R3).
 *
 * The renderer omits known names and redacts person-like tokens, but the gate
 * must not rely on entity tags or on perfect redaction: the understanding layer
 * may not have emitted a `person_role` entity for the individual, and prose
 * redaction is inherently best-effort. This gate therefore denies the item if
 * EITHER:
 *   - the body contains a known `person_role` entity name, OR
 *   - the *stored prose* (summary/whatItMeans/title/body) or the rendered body
 *     contains any possible person name not explained by a TRUSTED non-person
 *     token (source-registry agency/outlet names, trusted acronyms, geography,
 *     function/common words, or the vetted public descriptor). Detection is
 *     CASE-INSENSITIVE (defect R3): an all-lowercase or ALL-CAPS name is caught
 *     just like a Titlecase one, and an all-caps token off the trusted-acronym
 *     list is a possible name. Untrusted entity/org labels and the event's own
 *     `region`/`location` are deliberately NOT trusted (defects R2/R3).
 *
 * Scanning the stored prose (not just the rendered body) is what makes the
 * control robust: a name smuggled into the summary (or placed in `region`) is
 * caught before it can be redacted away and published.
 *
 * A false DENY is acceptable (the editor can review); a leak is not.
 *
 * @param {object} event
 * @param {number} functionId
 * @param {string} tier
 * @param {string} body
 * @param {Array<{type?:string,name?:string}>} entities
 * @throws {GateError} code 'named_individual_in_public_arrest'
 */
export function assertPublicArrestNameless(event, functionId, tier, body, entities) {
  if (functionId !== 7 || tier !== 'public') return;
  if (!isArrestItem(event)) return;

  const text = String(body || '');
  const haystack = text.toLowerCase();
  const leaked = personEntityNames(entities).filter((n) => haystack.includes(n.toLowerCase()));
  if (leaked.length > 0) {
    throw new GateError(
      'named_individual_in_public_arrest',
      'Public-tier arrest item must not name an individual',
      { leaked, reason: 'person_entity' },
    );
  }

  const known = knownNonPersonTokens(event);
  // Scan the rendered body AND the stored prose it was built from, joining EVERY
  // prose field (not just the {what} winner) so a name in any field is caught.
  const prose = [text, joinProseFields(event)].filter(Boolean).join(' \n ');
  const personLike = findPersonLikeNames(prose, known);
  if (personLike.length > 0) {
    throw new GateError(
      'named_individual_in_public_arrest',
      'Public-tier arrest item must not contain an individual name',
      { leaked: personLike, reason: 'person_like_token' },
    );
  }
}

/** Join every stored prose field that may carry a name, for the gate's scan. */
function joinProseFields(event) {
  return [event?.summary, event?.whatItMeans, event?.title, event?.body]
    .filter((v) => typeof v === 'string' && v)
    .join(' \n ');
}

/**
 * Gate 3 — "no link, no publish" (copyright policy §3.7; defect D5).
 *
 * A publishable item MUST have a resolvable source link so the reader can reach
 * the original. The link may be the event's `canonicalUrl` or any source URL.
 * This gate is fail-closed: a linkless item is DENIED.
 *
 * It is only applicable when the caller supplies source context (the projection
 * always does). A bare unit call with no `sources` is not a real candidate and
 * skips the gate, matching the licence gate's "only fires when supplied" shape.
 *
 * @param {object} event
 * @param {Array<{url?:string}>} sources
 * @throws {GateError} code 'missing_source_link'
 */
export function assertSourceLink(event, sources) {
  if (!Array.isArray(sources) || sources.length === 0) return; // no source context — n/a
  const canonical = String(event?.canonicalUrl ?? '').trim();
  if (canonical) return;
  const anySourceUrl = sources.some((s) => String(s?.url ?? '').trim());
  if (anySourceUrl) return;
  throw new GateError('missing_source_link', 'Publish item must carry a resolvable source link', {
    canonicalUrl: event?.canonicalUrl ?? null,
    sourceCount: sources.length,
  });
}

/**
 * Run every gate for a candidate publish item. Returns cleanly when all pass;
 * throws the first `GateError` otherwise (fail-closed).
 *
 * @param {object} event                    Stored event.
 * @param {number} functionId               1..8.
 * @param {'public'|'paid'} tier
 * @param {object} [opts]
 * @param {string} [opts.body]              Rendered body (for gate 2).
 * @param {string} [opts.licenceStatus]     Single source licence status (legacy).
 * @param {Array<string>} [opts.licenceStatuses] Licence status of EVERY source.
 * @param {Array<{name?:string,url?:string}>} [opts.sources] Event sources.
 * @param {Array<{type?:string,name?:string}>} [opts.entities]
 * @returns {void}
 *
 * NOTE ON `paywall` (defect D6): paywalled sources are quote-limited, not
 * blocked, so paywall is intentionally NOT a blocking input and is therefore
 * not accepted here. The flag is still read for provenance in `projectF7`; it
 * must not be threaded into this gate as if it changed the outcome.
 */
export function assertPublishable(
  event,
  functionId,
  tier,
  { body = '', licenceStatus, licenceStatuses, sources = [], entities = [] } = {},
) {
  assertLicence({ licenceStatus, licenceStatuses });
  assertSourceLink(event, sources);
  assertPublicArrestNameless(event, functionId, tier, body, entities);
}

export default { assertPublishable, GateError };

export { personEntityNames };
