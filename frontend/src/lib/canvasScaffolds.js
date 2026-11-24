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
      'Source & page ref',
    ],
    guidance: [
      'Distinguish legal obligations from editorial interpretation.',
      'Verify provisions against the primary notice before stating them.',
      'Convert the notice into "what this means for you".',
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
  '04': {
    kind: 'prose',
    slots: ['How the attack works', 'How to stay protected', 'Common mistake to avoid'],
    guidance: [
      'Keep it practical, technical but accessible.',
      'Explain the pattern, not one news event.',
      'One message per piece — two messages is two pieces.',
    ],
  },
  '05': {
    kind: 'fields',
    fields: [
      { label: 'Event title', multiline: false },
      { label: 'Organiser', multiline: false },
      { label: 'Date & time', multiline: false },
      { label: 'Venue or online link', multiline: false },
      { label: 'Registration link', multiline: false },
      { label: 'Notes', multiline: true },
    ],
    guidance: [
      'Publish only verified events.',
      "Give at least 7 days' notice before the event.",
      'Confirm the date and venue, not just report them.',
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
  '08': {
    kind: 'prose',
    slots: [
      'What happened',
      'Who/what is affected',
      'The threat or actor',
      'Does it affect the reader',
      'Recommended action',
    ],
    guidance: [
      'Give deeper context than breaking news.',
      'Keep analysis visibly separate from fact.',
      'Every claim carries its provenance and confidence.',
      '"unknown" is a valid actor — do not manufacture attribution.',
    ],
  },
};

/** Two-digit key for a pillar id, clamped into the 01..08 contract range. */
export function scaffoldFor(functionId) {
  return SCAFFOLDS[sectionNumber(functionId)] ?? null;
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

  let blocks;
  if (def?.kind === 'fields') {
    blocks = clean
      .map((v, i) => (v ? `${def.fields[i].label}: ${v}` : null))
      .filter(Boolean);
  } else {
    blocks = clean
      .map((v, i) => (v ? `${slotLabel(functionId, i).toUpperCase()}\n${v}` : null))
      .filter(Boolean);
  }

  return [head, ...blocks].filter(Boolean).join('\n\n');
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
