/**
 * The NovrPulse pillar SHAPES — the single backend source of truth for the
 * per-pillar slot contract and the per-section purposes the AI layers use.
 *
 * This mirrors the writer's scaffold data in
 * `frontend/src/lib/canvasScaffolds.js` (the Editorial Canvas). The frontend
 * copy stays the presentation contract; this module is the authoritative shape
 * the AI rewrite prompt, the recommend prompt, and the tests all read, so the
 * slot labels the model is asked to fill never drift from the labels the canvas
 * renders.
 *
 * Four things live here, keyed by the pillar `functionId` (1..8):
 *   - `kind`      — 'prose' (a labelled slot outline) or 'fields' (a field form).
 *   - `slots`     — the ORDERED slot labels for a prose pillar. These are the
 *                   exact block headings the composed body uses. A field-form
 *                   pillar (05/06) has no prose slots and is EXCLUDED from AI
 *                   rewrite (a form is data, not prose).
 *   - `purpose`   — a one-line statement of what the section is FOR, used by the
 *                   recommend layer to pick candidate events for it.
 *   - `depthNote` — the DEPTH/verbosity instruction for the rewrite layer (per
 *                   slot, in full sentences vs. a terse roll). This is the single
 *                   source of truth shared by the rewrite prompt builder and the
 *                   prompt-depth tests, so the two can never drift.
 *
 * PILLAR 01 NOTE: the frontend scaffold carries an EXTRA bound slot
 * ("Regulatory impact for the reader's business") that persists to its own
 * `publish_item.regulatoryImpact` column and is NOT composed into the body. The
 * AI rewrite composes prose only, so that bound slot is deliberately NOT listed
 * here — the composed body must match `composeBody`'s non-bound output.
 */

/**
 * The eight pillar shapes. `slots` order is significant: the composed body
 * emits them in this order, uppercase, each followed by its text.
 */
export const PILLAR_SHAPES = {
  1: {
    kind: 'prose',
    slots: [
      'Regulator',
      'What was issued (and date)',
      'Who is affected',
      'What it means for organisations',
      'Action to consider',
      'Source & page ref',
    ],
    purpose: 'Turn a regulator notice or directive into "what this means for your organisation".',
    depthNote:
      'Write each slot as 2\u20134 full sentences in a complete paragraph \u2014 not a fragment or a one-liner. Synthesise the ENTIRE source article (it is provided in full \u2014 use its detail), not just the title.',
  },
  2: {
    kind: 'prose',
    slots: ['Discussion prompt', 'Why it matters now', 'Link to forum thread'],
    purpose: 'One genuine question drawn from the day\u2019s strongest story, to spark discussion.',
    depthNote:
      'Write each slot as 2\u20134 full sentences in a complete paragraph \u2014 not a fragment or a one-liner. Synthesise the ENTIRE source article (it is provided in full \u2014 use its detail), not just the title.',
  },
  3: {
    kind: 'prose',
    slots: [
      'Explain in plain terms',
      'Institution/body (NPF-CCC, ngCERT, DefenseCERT, NCC-CSIRT)',
      'What readers should do',
    ],
    purpose: 'Public-awareness content explaining a cyber topic in plain terms with clear reader actions.',
    depthNote:
      'Write each slot as 2\u20134 full sentences in a complete paragraph \u2014 not a fragment or a one-liner. Synthesise the ENTIRE source article (it is provided in full \u2014 use its detail), not just the title.',
  },
  4: {
    kind: 'prose',
    slots: ['Incident', 'Entry point', 'What the attacker did', 'Final impact', 'Key lesson', 'Source'],
    purpose: 'A real incident walked through as a cyber-hygiene case study (attack chain and lesson).',
    depthNote:
      'This is a full case study. Write EACH of Incident, Entry point, What the attacker did, Final impact, and Key lesson as 2\u20134 full sentences in a complete paragraph \u2014 never a one-liner or a bare fragment. Walk the attack chain step by step and synthesise the ENTIRE source article (it is provided in full \u2014 use its detail). The Source slot stays a short attribution line.',
  },
  5: {
    kind: 'fields',
    slots: [],
    purpose: 'A cybersecurity event listing (Nigerian and international) with date, venue and registration.',
    depthNote: null,
  },
  6: {
    kind: 'fields',
    slots: [],
    purpose: 'A verified opportunity (scholarship, training, grant) with provider, deadline and eligibility.',
    depthNote: null,
  },
  7: {
    kind: 'prose',
    slots: ['What happened', 'Who is affected', 'Where', 'Source'],
    purpose: 'The day\u2019s breaking cybersecurity news: advisories and incidents, fast and attributed.',
    depthNote:
      'SHORT IS CORRECT here. This is a fast news roll: write each slot as 1\u20132 sentences \u2014 do NOT pad it into a long paragraph. Be crisp and attributed.',
  },
  8: {
    kind: 'prose',
    slots: ['Summary', 'Impact', 'Affected', 'Mitigation', 'Why it matters', 'Source'],
    purpose: 'The edition\u2019s deep-dive lead: actor, vector, context and assessment on one major story.',
    depthNote:
      'This is the edition\u2019s DEEP-DIVE LEAD; it must carry real depth, never one-liners. Write Summary as 4\u20136 full sentences synthesising the FULL source story. Write EACH of Impact, Affected, Mitigation, and Why it matters as 3\u20135 full sentences in a complete paragraph. Draw out the actors, the attack vector, the numbers, and the assessment \u2014 synthesise the ENTIRE source article (it is provided in full \u2014 use its detail). The Source slot stays a short attribution line.',
  },
};

/** The pillars a wire story can feed (mirrors the frontend news-derived set). */
export const NEWS_DERIVED_PILLARS = [1, 4, 7, 8];

/**
 * The pillar ids a field form, not prose, governs. These are EXCLUDED from the
 * AI rewrite (a form cannot be rewritten as prose) but remain eligible for the
 * recommend layer (an event story fits the section).
 */
export const FIELD_FORM_PILLARS = [5, 6];

/**
 * The shape for a pillar id, or null when the id is not one of the eight.
 * @param {number} functionId
 * @returns {{kind:string, slots:string[], purpose:string}|null}
 */
export function pillarShape(functionId) {
  return PILLAR_SHAPES[functionId] ?? null;
}

/**
 * The ORDERED prose slot labels for a pillar. Returns an empty array for a
 * field-form pillar (05/06) or an unknown id.
 * @param {number} functionId
 * @returns {string[]}
 */
export function pillarSlots(functionId) {
  const shape = pillarShape(functionId);
  if (!shape || shape.kind !== 'prose') return [];
  return shape.slots;
}

/**
 * The one-line purpose for a section, or null for an unknown id.
 * @param {number} functionId
 * @returns {string|null}
 */
export function pillarPurpose(functionId) {
  return pillarShape(functionId)?.purpose ?? null;
}

/**
 * The DEPTH instruction for a pillar's rewrite prompt, or null when the pillar
 * has none (field forms, unknown ids). A field form is never rewritten, so it
 * carries no depth note. This is the shared source of truth the rewrite prompt
 * and the prompt-depth tests both read.
 * @param {number} functionId
 * @returns {string|null}
 */
export function pillarDepthNote(functionId) {
  return pillarShape(functionId)?.depthNote ?? null;
}

/**
 * Whether the AI rewrite is available for a pillar. Field-form pillars (05/06)
 * are refused; every prose pillar is eligible.
 * @param {number} functionId
 * @returns {boolean}
 */
export function isRewritePillar(functionId) {
  return pillarShape(functionId)?.kind === 'prose';
}

export default { PILLAR_SHAPES, NEWS_DERIVED_PILLARS, FIELD_FORM_PILLARS, pillarShape, pillarSlots, pillarPurpose, pillarDepthNote, isRewritePillar };
