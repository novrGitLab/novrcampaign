/**
 * The AI-draft SLOT body contract — pure parse/compose helpers.
 *
 * The AI draft endpoint (`POST /api/publish/ai-draft`) writes a body as:
 *
 *     <headline>\n\nUPPER_LABEL\n<slot text>\n\nUPPER_LABEL\n<slot text>…
 *
 * i.e. line 1 is the headline and each remaining block is an ALL-CAPS label line
 * followed by its (possibly multi-line) slot text, blocks joined by a blank line.
 * The headline is held in its own field by callers (see `parseSeedBody`), so these
 * helpers operate on the body AFTER the headline — the slot region only.
 *
 * This module is pure data + pure string helpers (no React, no I/O) so the
 * round-trip is unit-testable and the page stays presentational.
 */

// A slot label is a whole line of ALL-CAPS: at least 3 characters, and only
// letters, digits, spaces and the punctuation the scaffold labels use — so
// "WHAT HAPPENED", "WHO'S AFFECTED", "SOURCE & PAGE REF", "R&D / M&A".
const LABEL_RE = /^[A-Z0-9][A-Z0-9 &/'’.\-]*$/;
const MIN_LABEL_LEN = 3;

/** Whether a single line reads as a slot label (ALL-CAPS, ≥3 chars). */
export function isSlotLabel(line) {
  const s = String(line ?? '').trim();
  if (s.length < MIN_LABEL_LEN) return false;
  // Require at least one letter so a bare number or "12:30" is not a label.
  if (!/[A-Z]/.test(s)) return false;
  return LABEL_RE.test(s);
}

/**
 * Parse a slot-format body (headline already removed) into
 * `{ label, text }` blocks, in order. Returns `null` when the text does NOT
 * follow the slot format, so callers fall back to a single textarea.
 *
 * Rules:
 *  - Blocks are separated by blank lines; each block's FIRST line must be a
 *    slot label.
 *  - Within a block, the label is line 1 and every following line is that
 *    slot's text (kept verbatim, joined by "\n").
 *  - A label line immediately followed by a blank line is treated as the start
 *    of the next block ONLY when the next non-empty line is itself a label;
 *    otherwise the blank joins the current block's text. This keeps a blank
 *    line inside a slot's copy from splitting it.
 *  - Any non-blank, non-label leading line means "not slot format" → null.
 */
export function parseSlots(text) {
  const body = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!body) return null;

  const lines = body.split('\n');
  // Find the first non-empty line — it must be a label.
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i >= lines.length || !isSlotLabel(lines[i])) return null;

  const blocks = [];
  let current = null;

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      // Blank line: start a new block only if the next non-blank line is a
      // label; otherwise keep it as an in-text blank within the current slot.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      const closesBlock = j >= lines.length || isSlotLabel(lines[j]);
      if (closesBlock) {
        if (current) { blocks.push(current); current = null; }
      } else if (current) {
        current.textLines.push('');
      }
      continue;
    }
    if (isSlotLabel(line)) {
      if (current) blocks.push(current);
      current = { label: line.trim(), textLines: [] };
    } else {
      // A non-label line without an open block is only reachable at the very
      // start (already guarded) — defensively treat it as not-slot.
      if (!current) return null;
      current.textLines.push(line);
    }
  }
  if (current) blocks.push(current);

  if (blocks.length === 0) return null;

  return blocks.map((b) => ({ label: b.label, text: b.textLines.join('\n').replace(/\s+$/, '') }));
}

/**
 * Compose a slot-format body (headline already removed) from `{ label, text }`
 * blocks, byte-compatible with the AI-draft server contract:
 *
 *     UPPER_LABEL\n<slot text>\n\nUPPER_LABEL\n<slot text>…
 *
 * Empty slot texts are dropped so an emptied block disappears from the body
 * (matching the scaffold `composeBody` behaviour). Labels are uppercased.
 */
export function composeSlots(blocks) {
  return (blocks ?? [])
    .map((b) => {
      const label = String(b?.label ?? '').trim().toUpperCase();
      const text = String(b?.text ?? '').replace(/\s+$/, '');
      if (!label || text === '') return null;
      return `${label}\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Split a full stored body — `"<headline>\n\n<slot region>"` — into its
 * headline and its parsed slot blocks, or `null` when the slot region does not
 * follow the slot format. Used by the Drafts step to decide between the
 * per-slot editor and the single-textarea fallback.
 */
export function parseDraftBody(body) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n');
  const split = text.indexOf('\n\n');
  const headline = (split === -1 ? text : text.slice(0, split)).trim();
  const region = split === -1 ? '' : text.slice(split + 2);
  const slots = parseSlots(region);
  if (!slots) return null;
  return { headline, slots };
}

/**
 * Rebuild the full stored body from a headline and slot blocks, exactly as the
 * server contract expects (headline first, blank line, then the slot region).
 * When there are no non-empty blocks the headline alone is returned.
 */
export function composeDraftBody(headline, blocks) {
  const head = String(headline ?? '').trim();
  const region = composeSlots(blocks);
  return [head, region].filter(Boolean).join('\n\n');
}
