/**
 * The eight NovrPulse pillars (functionId 1..8).
 *
 * A frontend mirror of `backend/src/services/novrpulse/pillars.js` labels. The
 * backend stays the source of truth for the ids/labels; this constant exists so
 * the Editorial Canvas can render the eight pillar-choice cards without a
 * second round-trip. Keep the order and labels in step with the backend.
 *
 * `purpose` is a one-line, name-free description of what the pillar is for,
 * used as the helper text under each choice card.
 */
export const PILLARS = [
  { functionId: 1, key: 'regulatory_impact', label: 'Regulatory Impact', purpose: 'How a rule, directive or regulator action affects the sector.' },
  { functionId: 2, key: 'forum_topic', label: 'Forum Topic of the Day', purpose: 'A discussion prompt for the community forum.' },
  { functionId: 3, key: 'public_education', label: 'Public Education & Advocacy', purpose: 'Plain-language guidance the audience can act on.' },
  { functionId: 4, key: 'cybersecurity_awareness', label: 'Cybersecurity Awareness', purpose: 'CAC / cyber-hygiene advice and threat awareness.' },
  { functionId: 5, key: 'events', label: 'Events', purpose: 'Upcoming events the audience should know about.' },
  { functionId: 6, key: 'outreach', label: 'Outreach Initiatives', purpose: 'Programmes, scholarships and community outreach.' },
  { functionId: 7, key: 'breaking_news', label: 'Breaking News of the Day', purpose: 'The day’s headline news (public-arrest items are name-checked).' },
  { functionId: 8, key: 'cyberintel', label: 'CyberIntel', purpose: 'Technical threat intelligence and analysis.' },
];

const LABEL_BY_ID = new Map(PILLARS.map((p) => [p.functionId, p.label]));

/**
 * The label for a pillar id, or a generic fallback when the id is unknown.
 * @param {number} functionId
 * @returns {string}
 */
export function pillarLabel(functionId) {
  return LABEL_BY_ID.get(functionId) ?? `Pillar ${functionId}`;
}

export default { PILLARS, pillarLabel };
