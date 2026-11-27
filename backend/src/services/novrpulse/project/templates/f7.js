/**
 * F7 — Breaking News of the Day: projection renderer.
 *
 * PURE and deterministic. No LLM, no I/O, no clock. Takes a stored event plus its
 * source list and returns the template-filled body string.
 *
 * Frozen template (docs/novrpulse/03-function-templates.md, F7):
 *   {What happened} — {who} — {where} — {source}.
 *
 * Template rules honoured here (03-function-templates.md F7 + 01-policies.md §2):
 *  - `{who}` for a named individual in an arrest/accusation item is OMITTED in the
 *    public tier, replaced by sector/organisation ("a Lagos fintech executive");
 *    the named version may go to the analyst tier (§2.5).
 *  - Every allegation is attributed to the agency/outlet that made it (§2.2).
 *  - The source link (canonicalUrl) is included (copyright §3.7: no link, no publish).
 *  - Forbidden pre-conviction words are scrubbed to neutral phrasing (§2.3).
 *  - A standard "A charge is not a conviction." line is added on any item that
 *    names a person charged (§2.4). In the public tier the name is omitted and the
 *    charge is reported against the sector/org, so the line is added only when a
 *    person is actually named in the rendered body.
 *  - Editor sign-off is required for every arrest item (never auto-published) —
 *    enforced downstream by the projection service and the approval API (§2.7).
 */

import { SOURCES } from '../../sources.js';
import {
  NON_PERSON_TOKENS,
  GEOGRAPHIC_TOKENS,
  TRUSTED_ACRONYMS,
  URL_TLDS,
} from './allowlists.js';

export const F7_TEMPLATE_VERSION = 'f7@1.0.0';

/** Event types that trigger the defamation (arrest/accusation) handling. */
export const ARREST_EVENT_TYPES = new Set(['arrest', 'fraud']);

/**
 * Secondary, deterministic arrest/accusation signal (defence in depth).
 *
 * Classification of an item as arrest-like must not depend solely on the LLM's
 * `eventType` label: a mislabelled or missing `eventType` would silently bypass
 * every defamation control. We therefore ALSO treat an item as arrest-like when
 * its text contains an arrest/accusation verb. Word-boundary, case-insensitive.
 */
const ARREST_VERB_RE = /\b(arrested|arrests|arraigned|charged|detained)\b/i;

/**
 * Pre-conviction words forbidden in output about a named person
 * (01-policies.md §2.3). Mapped to neutral replacements; keys are matched
 * case-insensitively on word boundaries.
 */
const FORBIDDEN_WORDS = {
  fraudster: 'suspect',
  fraudsters: 'suspects',
  culprit: 'suspect',
  culprits: 'suspects',
  scammer: 'suspect',
  scammers: 'suspects',
  criminal: 'suspect',
  criminals: 'suspects',
  hacker: 'suspect',
  hackers: 'suspects',
  thief: 'suspect',
  thieves: 'suspects',
  guilty: 'charged',
  mastermind: 'suspect',
  masterminds: 'suspects',
};

const FORBIDDEN_RE = new RegExp(`\\b(${Object.keys(FORBIDDEN_WORDS).join('|')})\\b`, 'gi');

/**
 * Deterministic scrub of forbidden pre-conviction words. Neutral replacement,
 * never a stronger restatement. Also collapses whitespace introduced by edits.
 *
 * @param {string} text
 * @returns {string}
 */
export function scrubPreConvictionWords(text) {
  if (!text) return '';
  return String(text)
    .replace(FORBIDDEN_RE, (m) => {
      const replacement = FORBIDDEN_WORDS[m.toLowerCase()] ?? 'suspect';
      return m[0] === m[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether an item is an arrest/accusation category (defamation controls apply).
 *
 * Two deterministic signals, OR'd:
 *  1. `eventType` is a known arrest/fraud type (ARREST_EVENT_TYPES).
 *  2. ANY prose field (summary/whatItMeans/title/body) contains an
 *     arrest/accusation verb. This is a deliberate, fail-closed backstop for a
 *     mislabelled event: a false positive only means the item waits for the
 *     human editor, which is acceptable; a false negative would leak a name to
 *     the public tier.
 */
export function isArrestItem(event) {
  if (!event || typeof event !== 'object') return false;
  if (ARREST_EVENT_TYPES.has(String(event.eventType || '').toLowerCase())) return true;
  // D8 (fail-closed): test the verb against EVERY prose field, not just the first
  // non-empty one. Testing only `firstNonEmpty` let a name sit in `summary`
  // (verb-free, and the slot the renderer favours) while the arrest verb lived in
  // a later field, so the item never classified as arrest-like and the name
  // control was skipped. Concatenating mirrors how gate 3 already joins fields.
  return ARREST_VERB_RE.test(joinProse(event));
}

/**
 * Join every prose field that may carry an arrest signal. Kept in one place so
 * `isArrestItem` and the redaction scan agree on what "the item's text" means.
 *
 * @param {object} event
 * @returns {string}
 */
function joinProse(event) {
  return [event?.summary, event?.whatItMeans, event?.title, event?.body]
    .filter((v) => typeof v === 'string' && v)
    .join(' \n ');
}

/**
 * Pick the person-entity names to withhold in the public tier. Only `person_role`
 * entities are treated as named individuals; org/agency/sector/location entities
 * are never withheld.
 *
 * @param {Array<{type?:string,name?:string}>} entities
 * @returns {string[]}
 */
export function personEntityNames(entities) {
  return (entities ?? [])
    .filter((e) => String(e?.type || '').toLowerCase() === 'person_role')
    .map((e) => String(e?.name || '').trim())
    .filter(Boolean);
}

/** First non-empty trimmed string from the arguments. */
function firstNonEmpty(...values) {
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

/**
 * Token set built once from the reviewed source registry (trusted code data).
 * Registry NAMES supply ordinary word tokens; registry IDS supply acronyms
 * (`efcc`, `ncc`, `nitda`, `cbn`, `ndpc`, …) that are reviewed code data, not
 * model output, so they are safe to allow-list as trusted acronyms.
 */
const TRUSTED_SOURCE_TOKENS = new Set();
const SOURCE_IDS = [];
for (const s of SOURCES) {
  for (const part of String(s?.name ?? '').toLowerCase().split(/[^\p{L}\p{N}'-]+/u)) {
    if (part) TRUSTED_SOURCE_TOKENS.add(part);
  }
  const id = String(s?.id ?? '').toLowerCase();
  if (id) SOURCE_IDS.push(id);
}

/**
 * Trusted acronyms are the reviewed constant in `./allowlists.js`, augmented
 * below with the reviewed source-registry ids (code data). An all-caps token off
 * these lists is a possible name (fail-closed).
 */
// Registry ids are reviewed code data (sources.js) — trust them as acronyms.
for (const id of SOURCE_IDS) {
  if (id.length >= 2) TRUSTED_ACRONYMS.add(id);
  for (const part of id.split(/[^a-z0-9]+/)) {
    if (part.length >= 2) TRUSTED_ACRONYMS.add(part);
  }
}

/**
 * Collect the set of lower-cased tokens that are KNOWN non-person names.
 *
 * TRUST MODEL (defect R2, strengthened by R3): this allow-list is the ONLY
 * thing that can mark a token as "safe, not a person". It must therefore NEVER
 * be seeded from untrusted input. It is derived ONLY from:
 *   - the trusted source registry (`sources.js`), which is reviewed code data,
 *     not model output; and
 *   - the vetted `event.publicDescriptor` (an explicitly safe, name-free string
 *     a caller supplies).
 *
 * SECURITY (defect R3 #2): `event.region`/`event.location` are NO LONGER
 * trusted. The previous implementation added every token of `region` to the
 * allow-list, so a name placed in `region` was simultaneously self-allow-listed
 * AND echoed verbatim into the `{where}` slot (the L3 leak). Geography is now
 * trusted ONLY via `GEOGRAPHIC_TOKENS`/the registry, so `region:'Chinedu'` is
 * treated as a possible name and the gate denies it.
 *
 * `event.organisation`/`event.agency`, entity names, and source *names supplied
 * on the event* are deliberately NOT trusted here. When unsure, we deny.
 *
 * @param {object} event
 * @returns {Set<string>}
 */
export function knownNonPersonTokens(event) {
  const tokens = new Set();
  const add = (value) => {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) return;
    for (const part of s.split(/[^\p{L}\p{N}'-]+/u)) {
      if (part) tokens.add(part);
    }
  };
  // Trusted: reviewed source-registry names (agencies, outlets). Code data, not model output.
  for (const source of TRUSTED_SOURCE_TOKENS) add(source);
  // Trusted: reviewed geographic/demonym constant (never a person name).
  for (const geo of GEOGRAPHIC_TOKENS) tokens.add(geo);
  // Trusted: the vetted, name-free descriptor a caller may supply.
  add(event?.publicDescriptor);
  return tokens;
}

/**
 * Detect possible person names in `text` that are not explained by a known
 * non-person token (trusted agency/outlet names, trusted acronyms, geography,
 * function/common words, or the vetted descriptor).
 *
 * FAIL-CLOSED DESIGN (defects R2 + R3). Earlier revisions matched only an
 * uppercase-leading token and rejected all-caps as acronyms; both were
 * bypassable, so names reached the public body:
 *   1. Non-ASCII names — the ASCII-only regex split `Chinédu` into `Chin`+`du`.
 *   2. Mononyms / single-token names — never flagged.
 *   3. Mislabeled entities — the ignore-list was seeded from untrusted labels.
 *   4. L1: ALL-LOWERCASE names — the `\p{Lu}`-anchored regex never matched them.
 *   5. L2: ALL-CAPS names — rejected wholesale as "presumed acronyms".
 *   6. L3: a name in `event.region` — both echoed into the body AND
 *      self-allow-listed (now fixed in `knownNonPersonTokens`).
 *
 * The detector is now:
 *   - Case-insensitive: it tokenises EVERY letter word (lowercase, Titlecase,
 *     ALL-CAPS, non-ASCII) and compares against the allow-list in lower case, so
 *     a name is caught regardless of case.
 *   - Acronym-correct: a real acronym is trusted only via the reviewed
 *     `TRUSTED_ACRONYMS` constant and registry ids — NOT via a blanket
 *     "all-caps is safe" rule. An all-caps token off those lists is a possible
 *     name (fail-closed).
 *   - Single-token sensitive: ONE unknown, non-common word is enough.
 *   - URL-blind: hyperlinks (which contain host tokens like `gov`, `ng`) are
 *     stripped first so a link never reads as a name nor forces a false deny.
 *   - Structurally fail-closed: the allow-list (`knownTokens`) is derived only
 *     from trusted data (see `knownNonPersonTokens`), never untrusted labels.
 *
 * Trade-off: this OVER-blocks. A legitimate unknown word (e.g. a two-word org
 * that is not in the source registry) is denied. That is the intended, preferred
 * failure direction: a false DENY is reviewed by a human; a leak is not
 * recoverable.
 *
 * @param {string} text
 * @param {Set<string>} knownTokens  Trusted non-person tokens (lower-cased).
 * @returns {string[]} offending tokens, exactly as they appeared, de-duplicated.
 */
export function findPersonLikeNames(text, knownTokens = new Set()) {
  const copy = stripUrls(String(text ?? '')).replace(
    /(?<![\p{L}\p{M}\p{N}'’-])(?:Associated Press|World Health Organization|African Union|Union of European Football Associations|Fédération Internationale de Football Association)(?![\p{L}\p{M}\p{N}'’-])/giu,
    ' ',
  );
  const words = copy.match(PERSON_TOKEN_RE) ?? [];
  const out = [];
  const seen = new Set();
  for (const word of words) {
    // A hyphen/apostrophe compound is a possible name if ANY of its parts is
    // untrusted (e.g. `Chinédu-Okafor`); split so `SIM-swap` does not over-block.
    const parts = word.toLowerCase().split(/['\u2019-]+/u).filter(Boolean);
    if (parts.length === 0) continue;
    const offender = parts.some((p) => !isTrustedToken(p, knownTokens));
    if (!offender) continue;
    const w = word.toLowerCase();
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(word);
  }
  return out;
}

/**
 * Whether a lower-cased token is safe (not a possible person name).
 *
 * @param {string} w
 * @param {Set<string>} knownTokens
 * @returns {boolean}
 */
function isTrustedToken(w, knownTokens) {
  // Single letters are initials / articles, never a full name on their own.
  if (w.length < 2) return true;
  if (NON_PERSON_TOKENS.has(w)) return true;
  if (TRUSTED_ACRONYMS.has(w)) return true;
  if (TRUSTED_SOURCE_TOKENS.has(w)) return true;
  if (GEOGRAPHIC_TOKENS.has(w)) return true;
  if (knownTokens.has(w)) return true;
  return false;
}

/**
 * Recognised top-level domains (trusted, reviewed constant) live in
 * `./allowlists.js` and are used to decide whether a dot-delimited token is a
 * real URL host rather than a person name.
 *
 * SECURITY (defect R4): a bare dotted token is NOT sufficient evidence of a URL.
 * The previous second alternative, `\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+\S*`,
 * treated `first.last` (e.g. `chinedu.okafor`) as a URL-like token and DELETED it
 * BEFORE tokenisation, so a dotted person name was neither redacted nor denied —
 * it leaked verbatim into the public F7 body, defeating the fail-closed contract.
 * A token is now stripped only when it is a genuine URL: it carries a scheme
 * (`://`), a `www.` prefix, or ends in a recognised TLD. A bare `first.last`
 * therefore survives to the tokenizer and is detected as a person name.
 *
 * `URL_TLDS` is a small, explicit, code-reviewed constant (not model output), so
 * it is safe to trust for the narrow purpose of URL recognition.
 */

/** `www.<host>` — an explicit web prefix, never a person name. */
const WWW_URL_RE = /\bwww\.[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+\S*/giu;

/**
 * Host-ish token ending in a recognised TLD. To avoid stripping a bare dotted
 * pair that could be a name (`first.last` where `last` happens to equal a TLD,
 * e.g. `Grace.Ng`), a scheme-less match must carry a genuine URL tail — a
 * path/query/fragment or a port — so `ncc.gov.ng/advisory/1` is stripped while a
 * bare `word.tld` is left for detection. Anchored on the TLD so `chinedu.okafor`
 * (not a TLD) is never matched at all.
 */
const TLD_URL_RE = new RegExp(
  String.raw`\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:${URL_TLDS.join('|')})\b(?::\d+/|[/?#])`,
  'giu',
);

/**
 * Remove only GENUINE URLs so host/path tokens (`https`, `gov`, `ng`, `example`)
 * are not treated as prose, while a bare dotted person name (`first.last`) is
 * preserved for detection. A token is stripped when it is:
 *   - a scheme URL (`scheme://…`), or
 *   - a `www.…` URL, or
 *   - a host-like token ending in a recognised TLD AND carrying a genuine URL
 *     tail (a path/query/fragment or a port).
 */
function stripUrls(text) {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/giu, ' ')
    .replace(WWW_URL_RE, ' ')
    .replace(TLD_URL_RE, ' ');
}

/**
 * Unicode-aware token pattern: any letter word, including accents/combining
 * marks and apostrophes/hyphens, regardless of case. The `u` flag lets `\p{L}`
 * match é, ọ, ș, ǎ, etc. as real letters, so `Chinédu` is ONE token.
 */
const PERSON_TOKEN_RE = /\p{L}[\p{L}'\u2019-]*/gu;

/**
 * Derive a name-free public descriptor for a public-tier arrest.
 *
 * FAIL-CLOSED (defect R2 #4): the descriptor must NEVER interpolate a raw
 * org/person name taken from untrusted input. Specifically we do NOT build
 * `an employee of <entity-or-event name>`: a person mislabelled `organisation`
 * or `agency` would be re-emitted verbatim as "an employee of <person>", which
 * is exactly the leak the name control exists to prevent.
 *
 * We use the vetted `event.publicDescriptor` when a caller supplies one (it is
 * expected to be a name-free sector phrase such as "a Lagos fintech executive"),
 * and otherwise a fixed, generic, name-free phrase.
 *
 * SCHEMA LIMITATION (defect D7): there is no `publicDescriptor`/`sectorDescriptor`
 * column on `np_event`, so production rows fall back to the generic phrase until
 * the understanding layer is extended to produce a richer, vetted sector form.
 *
 * @returns {string}
 */
export function derivePublicDescriptor(event) {
  const explicit = firstNonEmpty(event?.publicDescriptor, event?.sectorDescriptor);
  if (explicit) return explicit;
  return 'an unnamed individual';
}

/**
 * Compose the `{who}` slot.
 *
 * - If the event has a named individual AND this is an arrest/accusation item:
 *   - public tier: omit the person name; use a name-free descriptor.
 *   - non-public tier: name the individual.
 * - Otherwise: use the relevant org/agency, else the person entities.
 *
 * The non-arrest org fallback is display-only context (no defamation control is
 * being bypassed: the item is not arrest-like), so it may echo the org name.
 *
 * @returns {{ who:string, namedPerson:boolean }}
 */
export function composeWho(event, entities, tier) {
  const arrest = isArrestItem(event);
  const persons = personEntityNames(entities);

  if (arrest && tier === 'public') {
    // Public-tier arrest: ALWAYS name-free. The name is withheld even when the
    // understanding layer did not emit a `person_role` entity, because gate 3
    // independently denies any surviving person-like token.
    return { who: derivePublicDescriptor(event), namedPerson: false };
  }

  if (arrest && persons.length > 0) {
    return { who: persons.join(', '), namedPerson: true };
  }

  const orgEntities = (entities ?? []).filter((e) => {
    const t = String(e?.type || '').toLowerCase();
    return t !== 'person_role' && String(e?.name || '').trim();
  });
  const orgName = firstNonEmpty(orgEntities[0]?.name, event?.organisation, event?.agency);
  if (orgName) return { who: orgName, namedPerson: false };
  if (persons.length > 0) return { who: persons.join(', '), namedPerson: true };
  return { who: '', namedPerson: false };
}

/**
 * Compose the `{source}` slot: attribute to the outlet/agency and link it.
 *
 * @returns {string}
 */
export function composeSource(event, sources) {
  const link = firstNonEmpty(event?.canonicalUrl);
  const sourceName = firstNonEmpty(sources?.[0]?.name, event?.sourceName);
  if (sourceName && link) return `${sourceName} (${link})`;
  if (link) return link;
  return sourceName;
}

/**
 * Render the F7 body for an event.
 *
 * @param {object} event              Stored event (title, summary, whatItMeans,
 *                                    canonicalUrl, eventType, functions).
 * @param {object} [opts]
 * @param {Array<{name?:string,url?:string}>} [opts.sources] Event sources.
 * @param {Array<{type?:string,name?:string}>} [opts.entities] Linked entities.
 * @param {'public'|'paid'} [opts.tier='public']
 * @returns {{ body:string, templateVersion:string, namedPerson:boolean }}
 */
export function renderF7(event, { sources = [], entities = [], tier = 'public' } = {}) {
  if (!event || typeof event !== 'object') throw new TypeError('renderF7: event is required');

  const arrest = isArrestItem(event);
  const isPublicArrest = arrest && tier === 'public';

  let what = scrubPreConvictionWords(firstNonEmpty(event.summary, event.whatItMeans, event.title));
  let where = scrubPreConvictionWords(firstNonEmpty(event.region, event.location));
  const { who, namedPerson } = composeWho(event, entities, tier);
  const source = composeSource(event, sources);

  // DEFECT D1/R3 — public-tier arrest name control.
  //
  // The `{what}` slot is built verbatim from the stored summary/title and the
  // `{where}` slot from `region`/`location`, so an individual's name embedded in
  // either (but never emitted as a `person_role` entity by the understanding
  // layer) would leak to the highest-reach surface. We deterministically replace
  // any surviving person-like token (ANY case — lowercase, Titlecase, ALL-CAPS)
  // with the name-free public descriptor, in BOTH slots. This is best-effort
  // redaction; the fail-closed backstop is gate 3 (`assertPublicArrestNameless`),
  // which DENIES the item if any person-like token survives, regardless of tags.
  if (isPublicArrest) {
    const known = knownNonPersonTokens(event);
    const descriptor = derivePublicDescriptor(event);
    const redact = (text) => {
      let out = text;
      for (const token of findPersonLikeNames(out, known)) {
        // Replace each possible name with the name-free descriptor. The descriptor
        // itself is vetted/name-free (see derivePublicDescriptor), so it cannot
        // re-introduce a name.
        out = out.replaceAll(token, descriptor);
      }
      // A dotted name (`first.last`) tokenises to two offenders, so after the
      // replacements the run reads `<descriptor>.<descriptor>`; collapse such a
      // run (joined by dots and/or whitespace) back to a single descriptor.
      const escaped = descriptor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(
        new RegExp(`${escaped}(?:[.\\s]+${escaped})+`, 'gu'),
        descriptor,
      );
      return out.replace(/\s+/g, ' ').trim();
    };
    what = redact(what);
    where = redact(where);
  }

  const parts = [what, who, where, source].filter((p) => p);
  let body = `${parts.join(' — ')}.`;

  // "A charge is not a conviction." on any item naming a person charged (§2.4).
  if (arrest && namedPerson) {
    body += ' A charge is not a conviction.';
  }

  return { body, templateVersion: F7_TEMPLATE_VERSION, namedPerson };
}

export default { renderF7, scrubPreConvictionWords, isArrestItem, personEntityNames, composeWho, composeSource, derivePublicDescriptor, findPersonLikeNames, knownNonPersonTokens, F7_TEMPLATE_VERSION };
