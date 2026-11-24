/**
 * The Writer's pillar scaffold contracts — the DATA behind the Editorial Canvas.
 *
 * One engine, eight pre-shaped documents, ported from the prototype's SCAFFOLDS
 * map (docs/novrpulse/design/pulse-redesign-prototype.html) and aligned to our
 * slot contracts. A `prose` pillar renders a labelled SLOT OUTLINE the writer
 * fills; a `fields` pillar (05/06) renders a labelled FIELD FORM. `guidance` is
 * the editorial checklist shown in the "Shape" rail.
 *
 * This module is pure data + pure string helpers — no React, no I/O — so the
 * compose/parse round-trip is unit-testable and the page stays presentational.
 * The keys are the pillar `functionId` as a two-digit string ('01'..'08') to
 * mirror the prototype and read cleanly next to the section numbers.
 */
import { pillarLabel, PILLARS } from './pillars';
import { NEWS_DERIVED_PILLARS } from '../components/pulse/pulseNewsletter';

/** Two-digit section number for a pillar id, e.g. 1 → "01". */
export function sectionNumber(functionId) {
  return String(functionId).padStart(2, '0');
}

/**
 * The eight scaffold contracts, keyed by two-digit section number.
 *
 * prose:  `slots` are the labelled placeholder blocks (the writing aid).
 * fields: `fields` is the labelled form; each entry is { label, multiline }.
 */
export const SCAFFOLDS = {
  '01': {
    kind: 'prose',
    slots: [
      'Regulator',
      'What was issued (and date)',
      'Who is affected',
      'What it means for organisations',
      'Action to consider',
      // A DEDICATED field bound to `publish_item.regulatoryImpact` (owner spec
      // 2026-11-24). It is saved as its own column, NOT composed into `body`;
      // approval of a 01 item is refused until it is filled. See `bindings`.
      'Regulatory impact for the reader’s business',
      'Source & page ref',
    ],
    // Slot index → dedicated publish_item column. The slot is part of the writer
    // outline but is persisted separately (composeBody skips bound slots).
    bindings: { 5: 'regulatoryImpact' },
    guidance: [
      'Distinguish legal obligations from editorial interpretation.',
      'Verify provisions against the primary notice before stating them.',
      'Convert the notice into "what this means for you".',
      'Complete the regulatory-impact field — approval is blocked without it.',
      'Cite the regulator, the date and the page reference.',
    ],
  },
  '02': {
    kind: 'prose',
    slots: ['Discussion prompt', 'Why it matters now', 'Link to forum thread'],
    guidance: [
      'One topic a day — never more.',
      'Invite participation; ask a genuine question, not a restated headline.',
      'Do not introduce a claim absent from the item you select from.',
    ],
  },
  '03': {
    kind: 'prose',
    slots: [
      'Explain in plain terms',
      'Institution/body (NPF-CCC, ngCERT, DefenseCERT, NCC-CSIRT)',
      'What readers should do',
    ],
    guidance: [
      'Use simple language anyone can understand.',
      'Verify institutional claims before publishing them.',
      'Prefer a concrete, Nigeria-relevant example.',
      'Give the reader 1–2 clear actions.',
    ],
  },
  // fn 4 — the daily case study, aligned to the original newsletter's "Attack
  // Scenario" format (owner spec 2026-11-24): a real incident walked through
  // entry point → attacker actions → final impact → key lesson. "Source" stays
  // an ordinary prose slot composed into the body (no dedicated column).
  '04': {
    kind: 'prose',
    slots: [
      'Incident',
      'Entry point',
      'What the attacker did',
      'Final impact',
      'Key lesson',
      'Source',
    ],
    guidance: [
      'Teach how attacks work through real, verifiable cases.',
      'Keep the lesson practical: MFA, verify senders, report phishing.',
      'Explain the chain of actions, not just the outcome.',
      'One case per piece — two cases is two pieces.',
      'Attribute the case to its source; never reuse the source’s wording.',
    ],
  },
  '05': {
    kind: 'fields',
    fields: [
      { label: 'Event title', multiline: false },
      { label: 'Organiser', multiline: false },
      // Bound to `publish_item.eventDate` (owner spec 2026-11-24): saved as its
      // own column and used for the 7-day notice gate at approval. See `bindings`.
      { label: 'Date & time', multiline: false, bound: 'eventDate' },
      { label: 'Venue or online link', multiline: false },
      { label: 'Registration link', multiline: false },
      { label: 'Notes', multiline: true },
    ],
    bindings: { 2: 'eventDate' },
    guidance: [
      'Publish only verified events.',
      "Give at least 7 days' notice before the event.",
      'Confirm the date and venue, not just report them.',
      'Group Nigeria and International listings separately in the edition.',
      'Approval is blocked until the date is at least 7 days ahead.',
      'An expired event is archived, not deleted.',
    ],
  },
  '06': {
    kind: 'fields',
    fields: [
      { label: 'Opportunity title', multiline: false },
      { label: 'Kind (scholarship/course/programme)', multiline: false },
      { label: 'Provider', multiline: false },
      { label: 'Deadline', multiline: false },
      { label: 'Eligibility', multiline: false },
      { label: 'Link', multiline: false },
    ],
    guidance: [
      'Verified, charity-based opportunities only.',
      'Confirm the deadline against the primary page.',
      'Reject any host that cannot be confirmed legitimate.',
      "State eligibility clearly — a wrong deadline wastes a reader's chance.",
    ],
  },
  '07': {
    kind: 'prose',
    slots: ['What happened', 'Who is affected', 'Where', 'Source'],
    guidance: [
      'Attribute every allegation to the agency or outlet that made it.',
      'No names of arrestees in public pieces.',
      'No pre-conviction labels (fraudster, culprit, scammer).',
      'A charge is not a conviction.',
    ],
  },
  // fn 8 — the edition's deep-dive lead, aligned to the original newsletter's
  // signature format (owner spec 2026-11-24): Summary–Impact–Affected–Mitigation
  // –Why it matters, plus Source. "Source" stays an ordinary prose slot composed
  // into the body (no dedicated column).
  '08': {
    kind: 'prose',
    slots: [
      'Summary',
      'Impact',
      'Affected',
      'Mitigation',
      'Why it matters',
      'Source',
    ],
    guidance: [
      'This is the edition’s lead — write it as the signature piece.',
      'Answer what happened, whether it affects the reader, and what to do.',
      'Give deeper context than breaking news; keep analysis separate from fact.',
      'Original wording only — never reuse the source’s text.',
      'Every claim carries its provenance; "unknown" is a valid actor.',
    ],
  },
};

/** Two-digit key for a pillar id, clamped into the 01..08 contract range. */
export function scaffoldFor(functionId) {
  return SCAFFOLDS[sectionNumber(functionId)] ?? null;
}

/**
 * The set of slot/field indices on a scaffold that are bound to a DEDICATED
 * publish_item column (not composed into the text `body`). For 01 that is the
 * regulatory-impact slot; for 05 the event-date field. Returns an empty set for
 * every other scaffold.
 *
 * @param {number} functionId
 * @returns {Set<number>}
 */
export function boundIndexes(functionId) {
  const def = scaffoldFor(functionId);
  return new Set(Object.keys(def?.bindings ?? {}).map(Number));
}

/** The publish_item column a slot/field index binds to, or null. */
export function bindingFor(functionId, index) {
  const def = scaffoldFor(functionId);
  return def?.bindings?.[index] ?? null;
}

/**
 * Empty state for a scaffold's editable slots/fields: an array of strings, one
 * per slot (prose) or field (fields). The shape is uniform so the page can hold
 * a single `values` array regardless of kind.
 */
export function blankSlotValues(functionId) {
  const def = scaffoldFor(functionId);
  if (!def) return [];
  if (def.kind === 'fields') return def.fields.map(() => '');
  return def.slots.map(() => '');
}

/** The label for slot/field index `i` of a scaffold. */
export function slotLabel(functionId, i) {
  const def = scaffoldFor(functionId);
  if (!def) return '';
  return def.kind === 'fields' ? (def.fields[i]?.label ?? '') : (def.slots[i] ?? '');
}

/** Human label for the scaffold kind, shown as the "Shape" badge. */
export function scaffoldKindLabel(functionId) {
  const def = scaffoldFor(functionId);
  if (!def) return 'prose';
  return def.kind === 'fields' ? 'structured form' : 'prose outline';
}

/**
 * Split a stored body into `{ headline, paragraph }`.
 *
 * The backend seeds a body as "<headline>\n\n<paragraph>". The Writer keeps the
 * headline in its OWN empty field and the paragraph as the first slot's starting
 * text; the rest of the body is rebuilt from the scaffold on save. So on load we
 * take line 1 as the (drop-in) seeded headline and everything after the first
 * blank line as the starting paragraph.
 */
export function parseSeedBody(body) {
  const text = String(body ?? '');
  const split = text.indexOf('\n\n');
  if (split === -1) return { headline: text.trim(), paragraph: '' };
  return {
    headline: text.slice(0, split).trim(),
    paragraph: text.slice(split + 2).trim(),
  };
}

/**
 * Compose the stored text body from the writer's fields. The format is the same
 * "<headline>\n\n<blocks>" contract the backend seeds and the Front Page tray /
 * section preview already read (plain text, headline first, `line-clamp-2`
 * friendly).
 *
 * Prose scaffolds join non-empty slots under an UPPERCASE label line (a light
 * heading that reads cleanly as plain text — no markdown `##`, which the tray
 * would show literally). Field scaffolds join non-empty fields as "Label: value".
 *
 * The headline falls back to the seeded headline when the writer has not typed
 * one yet, so the item always round-trips with a usable first line.
 */
export function composeBody({ functionId, headline, seededHeadline = '', values }) {
  const def = scaffoldFor(functionId);
  const head = (headline ?? '').trim() || (seededHeadline ?? '').trim();
  const clean = (values ?? []).map((v) => String(v ?? '').trim());
  // Slots/fields bound to a dedicated publish_item column are persisted
  // separately (regulatoryImpact / eventDate) and are NOT part of the text body.
  const bound = boundIndexes(functionId);

  let blocks;
  if (def?.kind === 'fields') {
    blocks = clean
      .map((v, i) => (v && !bound.has(i) ? `${def.fields[i].label}: ${v}` : null))
      .filter(Boolean);
  } else {
    blocks = clean
      .map((v, i) => (v && !bound.has(i) ? `${slotLabel(functionId, i).toUpperCase()}\n${v}` : null))
      .filter(Boolean);
  }

  return [head, ...blocks].filter(Boolean).join('\n\n');
}

/**
 * Read the dedicated-column values out of the writer's `values` array by their
 * scaffold bindings. Returns `{ regulatoryImpact?, eventDate? }` with only the
 * bound columns present; a blank value is returned as `null`.
 *
 * @param {number} functionId
 * @param {string[]} values
 * @returns {{ regulatoryImpact?: string|null, eventDate?: string|null }}
 */
export function readBoundValues(functionId, values) {
  const def = scaffoldFor(functionId);
  const out = {};
  for (const [idx, column] of Object.entries(def?.bindings ?? {})) {
    const raw = String(values?.[Number(idx)] ?? '').trim();
    out[column] = raw === '' ? null : raw;
  }
  return out;
}

/**
 * Hydrate the writer's `values` array from a stored publish_item, seeding the
 * bound slots/fields (regulatory-impact, event date) from their own columns.
 * The non-bound slots stay blank (they are rebuilt from the composed body).
 *
 * @param {object} item  A serialized publish item.
 * @returns {string[]}
 */
export function slotValuesFromItem(item) {
  const blanks = blankSlotValues(item.functionId);
  const def = scaffoldFor(item.functionId);
  for (const [idx, column] of Object.entries(def?.bindings ?? {})) {
    const value = item?.[column];
    if (value === null || value === undefined) continue;
    // `eventDate` is an ISO string; a datetime-local input wants `YYYY-MM-DDTHH:mm`.
    blanks[Number(idx)] = column === 'eventDate' ? toDatetimeLocal(value) : String(value);
  }
  return blanks;
}

/** Convert an ISO date/datetime to the `YYYY-MM-DDTHH:mm` a datetime-local input expects. */
export function toDatetimeLocal(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whether the pillar is one of the four a wire story can feed. */
export function isNewsDerived(functionId) {
  return NEWS_DERIVED_PILLARS.includes(functionId);
}

/**
 * Eligibility for the Writer's pillar chips. When the Writer is opened FROM a
 * story, the news-derived pillars (01/04/07/08) are enabled ONLY for that
 * story's eligible set; the manual/cadence pillars (02/03/05/06) stay always
 * available. A story that fits none of the four still lets the writer author a
 * manual pillar — matching the Inbox behaviour.
 *
 * @param {number} functionId
 * @param {number[]} eligibleFunctions the event's own `functions`
 * @returns {boolean}
 */
export function isPillarEnabled(functionId, eligibleFunctions) {
  if (!isNewsDerived(functionId)) return true;
  return (eligibleFunctions ?? []).includes(functionId);
}

/** The label for a two-digit section number, e.g. "07" → "07 Breaking News of the Day". */
export function sectionNumberedLabel(number) {
  const p = PILLARS.find((x) => sectionNumber(x.functionId) === number);
  return p ? `${number} ${p.label}` : number;
}

export { pillarLabel };
