import { pillarLabel } from '../../lib/pillars';

/**
 * Presentation metadata for the eight briefing sections, keyed by pillar
 * (functionId 1..8). The prototype (docs/novrpulse/design/pulse-redesign-
 * prototype.html) supplies the glyph and the one-line "job" copy; the label is
 * left to the backend (serialized on every section) so the two never drift.
 */
const SECTION_META = {
  1: { glyph: '§', job: 'Regulator notice, turned into "what this means for you".' },
  2: { glyph: '✦', job: 'One genuine question drawn from the day’s strongest item.' },
  3: { glyph: '◎', job: 'Awareness content: scam patterns and safety basics.' },
  4: { glyph: '⛨', job: 'Campaign-led messaging and cyber-hygiene content.' },
  5: { glyph: '▤', job: 'Cybersecurity events across Nigeria and Africa.' },
  6: { glyph: '↗', job: 'Scholarships, training, grants and opportunities.' },
  7: { glyph: '✦', job: 'Advisories and incidents, fast and attributed.' },
  8: { glyph: '⛨', job: 'Deeper analysis: actor, vector, context, assessment.' },
};

/** The four news-derived pillars — the only sections a wire item can feed. */
export const NEWS_DERIVED_PILLARS = [1, 4, 7, 8];

/** Two-digit section number, e.g. 1 → "01". */
export function sectionNumber(functionId) {
  return String(functionId).padStart(2, '0');
}

/** The glyph for a pillar (fallback ◇ for an unknown id). */
export function sectionGlyph(functionId) {
  return SECTION_META[functionId]?.glyph ?? '◇';
}

/** The one-line job description for a pillar. */
export function sectionJob(functionId) {
  return SECTION_META[functionId]?.job ?? '';
}

export function sectionLabel(functionId) {
  return pillarLabel(functionId);
}

/** Section state → newsletter status pill {label, tone}. */
const STATE_PILLS = {
  ready: { label: 'Ready', tone: 'ready' },
  empty: { label: 'Empty', tone: 'empty' },
  no_updates: { label: 'No updates', tone: 'none' },
  awaiting: { label: 'Awaiting', tone: 'empty' },
};

export function sectionStatePill(state) {
  return STATE_PILLS[state] ?? { label: state || 'Empty', tone: 'empty' };
}

/**
 * Publish-item status → a dot tone for a tray chip. Draft/approved/published
 * map to the newsletter palette's none/ready accents so a chip reads at a glance.
 */
export function itemStatusTone(status) {
  if (status === 'approved' || status === 'published') return 'ready';
  if (status === 'rejected' || status === 'withdrawn') return 'none';
  return 'empty';
}
