/**
 * The eight NovrPulse pillars (functionId 1..8).
 *
 * A single source of truth for the human-readable labels of the eight functions
 * the briefing desk is organised around. Exported here so the briefing
 * controller, section seeding, and any future renderers all agree on the same
 * labels instead of each carrying its own copy.
 *
 * The order is significant: `position` for a seeded section is the `functionId`,
 * so a briefing's sections read 1..8 in pillar order.
 */

export const PILLARS = [
  { functionId: 1, key: 'regulatory_impact', label: 'Regulatory Impact' },
  { functionId: 2, key: 'forum_topic', label: 'Forum Topic of the Day' },
  { functionId: 3, key: 'public_education', label: 'Public Education & Advocacy' },
  { functionId: 4, key: 'cybersecurity_awareness', label: 'Cybersecurity Awareness (CAC/Cyber Hygiene)' },
  { functionId: 5, key: 'events', label: 'Events' },
  { functionId: 6, key: 'outreach', label: 'Outreach Initiatives' },
  { functionId: 7, key: 'breaking_news', label: 'Breaking News of the Day' },
  { functionId: 8, key: 'cyberintel', label: 'CyberIntel' },
];

const LABEL_BY_ID = new Map(PILLARS.map((p) => [p.functionId, p.label]));

/**
 * The label for a pillar id, or null when the id is not one of the eight.
 * @param {number} functionId
 * @returns {string|null}
 */
export function pillarLabel(functionId) {
  return LABEL_BY_ID.get(functionId) ?? null;
}

export default { PILLARS, pillarLabel };
