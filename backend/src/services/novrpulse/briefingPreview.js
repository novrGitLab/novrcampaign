/**
 * Briefing preview renderer.
 *
 * Renders an assembled Daily Briefing through the `pulse-daily-brief.html`
 * email template and returns the full HTML, for a server-side preview shown in a
 * sandboxed iframe on the Briefing Desk.
 *
 * Design:
 *  - PURE and deterministic. No I/O except reading the template file once (cached)
 *    and no clock: the caller supplies the briefing row. Trivially unit-testable.
 *  - The template is OWNED by the backend (a copy lives under
 *    `backend/src/templates/pulse-daily-brief.html`, read relative to THIS module,
 *    not the cwd, so it is stable regardless of where Node is launched). The
 *    frontend copy under `frontend/src/templates/` is the design source the rest
 *    of the app renders from; the two must be kept in sync deliberately (see the
 *    header comment in `backend/src/templates/pulse-daily-brief.html`).
 *  - SECURITY: article/event text is UNTRUSTED. Every injected value is
 *    HTML-escaped here before it touches the template, so a body containing
 *    `<script>` cannot break out. Rendering is server-side; the client only
 *    displays the returned string in a `sandbox=""` iframe.
 *
 * MAPPING (briefing section functionId → template block):
 *   fn 8 → 📰 lead (parses Summary/Impact/Affected/Mitigation/Why it matters)
 *   fn 7 → 📋 More news today (up to 3 compact blocks)
 *   fn 4 → ⚔️ Attack Scenario (parses Incident/Entry point/What the attacker did/
 *          Final impact/Key lesson)
 *   fn 1 → 🏛️ Regulatory Impact
 *   fn 5 → 📅 Events (Nigeria vs International by event region, else Nigeria)
 *   fn 6 → 📦 Product Corner / outreach
 *   fn 3 → 📖 Glossary
 *   Tool / Career / Glossary / Quiz curated blocks → clearly-marked placeholder
 *   text (manual in v1).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { pillarSlots } from './pillarShapes.js';

/** Path to the backend-owned template, resolved relative to this module. */
const TEMPLATE_PATH = fileURLToPath(
  new URL('../../templates/pulse-daily-brief.html', import.meta.url),
);

/** The maximum number of compact news-roll blocks the template supports. */
export const MAX_NEWS = 3;

/** The maximum number of events per region group the template supports. */
export const MAX_EVENTS_PER_REGION = 2;

/** Characters escaped for HTML-text/attribute contexts. */
const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * The clearly-marked default text for a curated block with no content, so an
 * unfilled edition still renders cleanly (these blocks are manual in v1).
 */
export const CURATED_PLACEHOLDER = '— This week the team takes a break from this section —';

/**
 * Escape a value for safe injection into the template. Coerces to string, then
 * replaces every HTML-significant character. This is the ONLY path by which
 * untrusted text reaches the output.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** Collapse all runs of whitespace to a single space and trim. */
function collapseWhitespace(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** Format a Date (or ISO string) as "D Month YYYY", e.g. "19 November 2026". */
export function formatBriefingDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Parse a composed publish-item body into a headline + slot map.
 *
 * The composed body is `"<headline>\n\nUPPER_LABEL\n<text>"...` (see
 * `composeRewriteBody` / the frontend `composeBody`). A slot's text runs until
 * the next recognised UPPER_LABEL heading, so multi-line paragraphs are joined.
 *
 * @param {string} body
 * @param {number} functionId
 * @returns {{headline:string, slots:Record<string,string>}}
 */
export function parseComposedBody(body, functionId) {
  const raw = String(body ?? '');
  const lines = raw.split(/\r?\n/);
  const headline = collapseWhitespace(lines.find((l) => l.trim().length > 0) ?? '');

  // Slot labels for THIS pillar, uppercased, plus a general fallback so an
  // unknown-shape body still splits on any ALL-CAPS heading line.
  const labels = new Set(pillarSlots(functionId).map((s) => s.toUpperCase()));
  const isLabel = (line) => {
    const t = line.trim();
    if (!t) return false;
    if (labels.has(t)) return true;
    return /^[A-Z][A-Z0-9 &/()'-]{2,}$/.test(t);
  };

  const slots = {};
  let current = null;
  const buf = [];
  const flush = () => {
    if (current) slots[current] = collapseWhitespace(buf.join(' '));
    buf.length = 0;
  };

  for (const line of lines) {
    if (isLabel(line)) {
      flush();
      current = line.trim();
      continue;
    }
    if (current) buf.push(line.trim());
  }
  flush();

  return { headline, slots };
}

/** Case-insensitive slot lookup from a parsed slot map. */
function slotValue(slots, label) {
  const target = String(label).toUpperCase();
  for (const [k, v] of Object.entries(slots ?? {})) {
    if (k.toUpperCase() === target) return collapseWhitespace(v);
  }
  return '';
}

/**
 * Derive a story's display fields from a briefing section item (any pillar).
 *
 *  - headline: linked event title, else the first line of the item body.
 *  - source: the linked event's source name, else 'NovrPulse'.
 *  - sourceUrl: the linked event's canonical URL, else ''.
 *
 * @param {object} link  A briefing section item with an included `publishItem`.
 * @returns {{functionId:number, headline:string,source:string,sourceUrl:string,slots:Record<string,string>,body:string}|null}
 */
export function buildStory(link) {
  const item = link?.publishItem;
  const body = typeof item?.body === 'string' ? item.body : '';
  if (!body.trim()) return null;

  const functionId = item?.functionId ?? link?.functionId ?? null;
  const event = item?.event ?? null;
  const sourceName = event?.sources?.[0]?.rawDocument?.source?.name ?? null;

  const parsed = parseComposedBody(body, functionId);
  const headline = collapseWhitespace(event?.title) || parsed.headline || 'Untitled';
  const sourceUrl = event?.canonicalUrl ?? '';

  return {
    functionId,
    headline,
    source: sourceName || 'NovrPulse',
    sourceUrl,
    slots: parsed.slots,
    body,
    // Carry the linked event so the 📅 Events mapping can read its region/venue.
    event,
  };
}

/**
 * Group a briefing's section items by functionId, each list ordered by position
 * and mapped through `buildStory` (empty bodies skipped).
 *
 * @param {Array<object>} sections
 * @returns {Map<number, Array<object>>}
 */
export function groupStories(sections) {
  const byFunction = new Map();
  for (const s of sections ?? []) {
    const items = [...(s.items ?? [])]
      .sort((a, b) => a.position - b.position)
      .map(buildStory)
      .filter(Boolean);
    if (items.length) byFunction.set(s.functionId, items);
  }
  return byFunction;
}

/**
 * Flatten a briefing's sections into stories, in section-priority order, taking
 * the first items with non-empty bodies. Retained for compatibility; the new
 * token map uses `groupStories`.
 *
 * @param {Array<object>} sections
 * @param {number} [max]
 * @returns {Array<object>}
 */
export function selectStories(sections, max = Number.MAX_SAFE_INTEGER) {
  const byFunction = groupStories(sections);
  const stories = [];
  for (const items of byFunction.values()) {
    for (const story of items) {
      stories.push(story);
      if (stories.length >= max) return stories;
    }
  }
  return stories;
}

/** Build the 📰 lead tokens from the fn 8 story (or '' when absent). */
function leadTokens(story) {
  if (!story) return {};
  const s = story.slots;
  return {
    'lead.headline': story.headline,
    'lead.imageAlt': story.headline,
    'lead.summary': slotValue(s, 'Summary'),
    'lead.impact': slotValue(s, 'Impact'),
    'lead.affected': slotValue(s, 'Affected'),
    'lead.mitigation': slotValue(s, 'Mitigation'),
    'lead.whyItMatters': slotValue(s, 'Why it matters'),
    'lead.sourceName': story.source,
    'lead.sourceUrl': story.sourceUrl,
  };
}

/**
 * Build the compact news-roll tokens (news1..newsN) from the fn 7 stories.
 * The summary is capped to a compact two-sentence-ish line (the roll is SHORT
 * by design — the depth instruction for fn 7 says so).
 */
function newsTokens(stories) {
  const out = {};
  for (let i = 0; i < MAX_NEWS; i += 1) {
    const n = i + 1;
    const story = stories[i];
    out[`news${n}.headline`] = story ? story.headline : '';
    out[`news${n}.summary`] = story
      ? slotValue(story.slots, 'What happened') || story.body
      : '';
    out[`news${n}.sourceName`] = story ? story.source : '';
    out[`news${n}.sourceUrl`] = story ? story.sourceUrl : '';
  }
  return out;
}

/** Build the ⚔️ Attack Scenario tokens from the fn 4 story (or '' when absent). */
function attackTokens(story) {
  if (!story) return {};
  const s = story.slots;
  return {
    'attack.headline': story.headline,
    'attack.incident': slotValue(s, 'Incident'),
    'attack.entryPoint': slotValue(s, 'Entry point'),
    'attack.attackerDid': slotValue(s, 'What the attacker did'),
    'attack.finalImpact': slotValue(s, 'Final impact'),
    'attack.keyLesson': slotValue(s, 'Key lesson'),
    'attack.sourceName': story.source,
    'attack.sourceUrl': story.sourceUrl,
  };
}

/** Build the 🏛️ Regulatory Impact tokens from the fn 1 story (or '' when absent). */
function regulatoryTokens(story) {
  if (!story) return {};
  const s = story.slots;
  return {
    'regulatory.headline': story.headline,
    'regulatory.body': slotValue(s, 'What it means for organisations') || story.body,
  };
}

/**
 * Build the 📦 Product Corner / outreach tokens from the fn 6 opportunity-style
 * story (or '' when absent).
 */
function productTokens(story) {
  if (!story) return {};
  return {
    'product.headline': story.headline,
    'product.body': story.body,
    'product.linkUrl': story.sourceUrl,
  };
}

/** Whether an event's region string denotes Nigeria (default group). */
function isNigeria(event) {
  const region = String(event?.region ?? '').toLowerCase();
  return region === '' || region.includes('nigeria') || region === 'ng' || region === '🇳🇬';
}

/**
 * Build the 📅 Events tokens from the fn 5 items, split into Nigeria (default
 * for a missing/unknown region) and International, up to two each.
 *
 * Each `event` is a briefing section item whose linked record carries
 * title/description/venue/startsAt and — when available — a `region`.
 */
function eventTokens(stories) {
  const out = {};
  const groups = { ng: [], intl: [] };
  for (const story of stories) {
    const event = story.event ?? {};
    (isNigeria(event) ? groups.ng : groups.intl).push(story);
  }

  const emit = (prefix, list) => {
    for (let i = 0; i < MAX_EVENTS_PER_REGION; i += 1) {
      const n = i + 1;
      const story = list[i];
      const event = story?.event ?? {};
      out[`${prefix}${n}.title`] = story ? story.headline : '';
      out[`${prefix}${n}.location`] = collapseWhitespace(event.venue ?? '');
      out[`${prefix}${n}.date`] = event.startsAt ? formatBriefingDate(event.startsAt) : '';
      out[`${prefix}${n}.focus`] = story ? story.body : '';
      out[`${prefix}${n}.sourceName`] = story ? story.source : '';
      out[`${prefix}${n}.sourceUrl`] = story ? story.sourceUrl : '';
    }
  };
  emit('ngEvent', groups.ng);
  emit('intlEvent', groups.intl);
  return out;
}

/** Build the 📖 Glossary tokens from the fn 3 story (or '' when absent). */
function glossaryTokens(story) {
  if (!story) return {};
  const s = story.slots;
  return {
    'glossary.term': slotValue(s, 'Explain in plain terms') ? story.headline : '',
    'glossary.definition': slotValue(s, 'Explain in plain terms') || story.body,
  };
}

/**
 * Build the complete token→value map for the template from a briefing view
 * model. Values are RAW (unescaped); escaping happens at substitution time.
 * Every optional block is filled with a `CURATED_PLACEHOLDER` (or '') so no raw
 * `{{token}}` is ever left for the client.
 *
 * @param {object} vm
 * @returns {Map<string,string>}
 */
export function buildTokenMap(vm) {
  const tokens = new Map();
  tokens.set('date', vm.date);
  tokens.set('preheader', vm.preheader ?? '');

  const groups = vm.groups ?? new Map();
  const lead = groups.get(8)?.[0] ?? null;
  const news = groups.get(7) ?? [];
  const attack = groups.get(4)?.[0] ?? null;
  const regulatory = groups.get(1)?.[0] ?? null;
  const events = groups.get(5) ?? [];
  const outreach = groups.get(6)?.[0] ?? null;
  const glossary = groups.get(3)?.[0] ?? null;

  // Lead — the deep-dive. Kept even when absent so required tokens exist.
  for (const [k, v] of Object.entries({
    'lead.headline': '', 'lead.imageAlt': '', 'lead.summary': '', 'lead.impact': '',
    'lead.affected': '', 'lead.mitigation': '', 'lead.whyItMatters': '',
    'lead.sourceName': '', 'lead.sourceUrl': '',
  })) tokens.set(k, v);
  for (const [k, v] of Object.entries(leadTokens(lead))) tokens.set(k, v);

  for (const [k, v] of Object.entries(newsTokens(news))) tokens.set(k, v);

  for (const [k, v] of Object.entries({
    'attack.headline': '', 'attack.incident': '', 'attack.entryPoint': '',
    'attack.attackerDid': '', 'attack.finalImpact': '', 'attack.keyLesson': '',
    'attack.sourceName': '', 'attack.sourceUrl': '',
  })) tokens.set(k, v);
  for (const [k, v] of Object.entries(attackTokens(attack))) tokens.set(k, v);

  for (const [k, v] of Object.entries({ 'regulatory.headline': '', 'regulatory.body': '' })) {
    tokens.set(k, v);
  }
  for (const [k, v] of Object.entries(regulatoryTokens(regulatory))) tokens.set(k, v);

  for (const [k, v] of Object.entries(eventTokens(events))) tokens.set(k, v);
  // Ensure every event token exists even with no events.
  for (const prefix of ['ngEvent', 'intlEvent']) {
    for (let n = 1; n <= MAX_EVENTS_PER_REGION; n += 1) {
      for (const field of ['title', 'location', 'date', 'focus', 'sourceName', 'sourceUrl']) {
        const key = `${prefix}${n}.${field}`;
        if (!tokens.has(key)) tokens.set(key, '');
      }
    }
  }

  for (const [k, v] of Object.entries({
    'product.headline': CURATED_PLACEHOLDER, 'product.body': CURATED_PLACEHOLDER, 'product.linkUrl': '',
  })) tokens.set(k, v);
  for (const [k, v] of Object.entries(productTokens(outreach))) tokens.set(k, v);

  for (const [k, v] of Object.entries({
    'glossary.term': '', 'glossary.definition': CURATED_PLACEHOLDER,
  })) tokens.set(k, v);
  for (const [k, v] of Object.entries(glossaryTokens(glossary))) tokens.set(k, v);

  // Curated blocks (manual in v1) — placeholder text so the edition renders.
  for (const [k, v] of Object.entries({
    'career.role': CURATED_PLACEHOLDER,
    'career.description': CURATED_PLACEHOLDER,
    'career.salary': CURATED_PLACEHOLDER,
    'career.certs': CURATED_PLACEHOLDER,
    'tool.spotlight': CURATED_PLACEHOLDER,
    'tool.whatItDoes': CURATED_PLACEHOLDER,
    'tool.whoShouldUse': CURATED_PLACEHOLDER,
    'tool.whyItMatters': CURATED_PLACEHOLDER,
    'quiz.q1': CURATED_PLACEHOLDER,
    'quiz.q2': CURATED_PLACEHOLDER,
    'quiz.a1': CURATED_PLACEHOLDER,
    'quiz.a2': CURATED_PLACEHOLDER,
  })) tokens.set(k, v);

  tokens.set('unsubscribeUrl', vm.unsubscribeUrl);
  return tokens;
}

/**
 * Fill the template tokens with escaped values.
 *
 * @param {string} html
 * @param {Map<string,string>} tokens  RAW (unescaped) values.
 * @returns {string}
 */
export function fillTemplate(html, tokens) {
  let out = html;
  for (const [key, raw] of tokens) {
    const needle = `{{${key}}}`;
    if (out.includes(needle)) out = out.split(needle).join(escapeHtml(raw));
  }
  return out;
}

/** Read the template from disk (cached per process). */
let cachedTemplate = null;
function loadTemplate() {
  if (cachedTemplate === null) cachedTemplate = readFileSync(TEMPLATE_PATH, 'utf8');
  return cachedTemplate;
}

/**
 * Render the full preview HTML for a briefing view model.
 *
 * @param {object} vm
 * @param {string} vm.date
 * @param {string} [vm.preheader]
 * @param {Map<number,Array<object>>} [vm.groups]  stories keyed by functionId.
 * @param {Array<object>} [vm.stories]  legacy flat list (grouped by functionId).
 * @param {string} vm.unsubscribeUrl
 * @param {string} [template]  Template override (tests).
 * @returns {string}
 */
export function renderBriefingPreview(vm, template = loadTemplate()) {
  const groups = vm.groups ?? groupStories(vm.sections ?? []);
  const tokens = buildTokenMap({ ...vm, groups });
  const filled = fillTemplate(template, tokens);
  // Defensive: any token we did not supply is blanked so a literal `{{` can
  // never reach the client. The deliberate `{{unsubscribeUrl}}` pass-through
  // (Plunk fills it at send) is preserved.
  return filled
    .replace(/\{\{unsubscribeUrl\}\}/g, '\u0000UNSUB\u0000')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace('\u0000UNSUB\u0000', '{{unsubscribeUrl}}');
}

export default {
  escapeHtml,
  formatBriefingDate,
  parseComposedBody,
  buildStory,
  groupStories,
  selectStories,
  buildTokenMap,
  fillTemplate,
  renderBriefingPreview,
  CURATED_PLACEHOLDER,
  MAX_NEWS,
  MAX_EVENTS_PER_REGION,
};
