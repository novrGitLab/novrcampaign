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
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Path to the backend-owned template, resolved relative to this module. */
const TEMPLATE_PATH = fileURLToPath(
  new URL('../../templates/pulse-daily-brief.html', import.meta.url),
);

/** The maximum number of story blocks the template supports. */
export const MAX_STORIES = 5;

/** Section priority for story selection: §07 Breaking, §08 CyberIntel, §01 Regulatory, then the rest. */
export const STORY_SECTION_PRIORITY = [7, 8, 1, 2, 3, 4, 5, 6];

/** Characters escaped for HTML-text/attribute contexts. */
const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

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

/** The first non-empty line of a body, collapsed. */
function firstLine(body) {
  const line = String(body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return collapseWhitespace(line ?? '');
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
 * Derive a story's display fields from a briefing section item.
 *
 *  - headline: linked event title, else the first line of the item body.
 *  - summary: the first ~200 chars of the body.
 *  - whatItMeans: the remainder of the body after the summary ('' when none).
 *  - source: the linked event's source name + date, else 'NovrPulse'.
 *  - sourceUrl: the linked event's canonical URL, else ''.
 *
 * @param {object} link  A briefing section item with an included `publishItem`.
 * @returns {{headline:string,headlineUrl:string,source:string,sourceUrl:string,summary:string,whatItMeans:string}|null}
 */
export function buildStory(link) {
  const item = link?.publishItem;
  const body = typeof item?.body === 'string' ? item.body : '';
  if (!body.trim()) return null;

  const event = item?.event ?? null;
  const sourceName = event?.sources?.[0]?.rawDocument?.source?.name ?? null;

  const headline = collapseWhitespace(event?.title) || firstLine(body);
  const headlineUrl = event?.canonicalUrl ?? '';
  const sourceUrl = event?.canonicalUrl ?? '';

  const summaryText = body.length > 200 ? body.slice(0, 200) : body;
  const remainder = body.length > 200 ? body.slice(200) : '';

  const source = sourceName ? `${sourceName} · ${formatBriefingDate(event?.publishedAt)}`.replace(/ · $/, '') : 'NovrPulse';

  return {
    headline: headline || 'Untitled',
    headlineUrl,
    source,
    sourceUrl,
    summary: collapseWhitespace(summaryText),
    whatItMeans: collapseWhitespace(remainder),
  };
}

/**
 * Flatten a briefing's sections into up to five stories, in section-priority
 * order (§07 → §08 → §01 → others), taking the first items with non-empty bodies.
 *
 * @param {Array<object>} sections  Briefing sections, each with ordered `items`.
 * @param {number} [max=MAX_STORIES]
 * @returns {Array<object>}
 */
export function selectStories(sections, max = MAX_STORIES) {
  const byFunction = new Map();
  for (const s of sections ?? []) {
    const items = [...(s.items ?? [])].sort((a, b) => a.position - b.position);
    byFunction.set(s.functionId, items);
  }

  const orderedFunctions = [
    ...STORY_SECTION_PRIORITY.filter((f) => byFunction.has(f)),
    ...[...byFunction.keys()].filter((f) => !STORY_SECTION_PRIORITY.includes(f)),
  ];

  const stories = [];
  for (const fn of orderedFunctions) {
    for (const link of byFunction.get(fn) ?? []) {
      const story = buildStory(link);
      if (story) stories.push(story);
      if (stories.length >= max) return stories;
    }
  }
  return stories;
}

/**
 * Build the complete token→value map for the template from a briefing view
 * model. Values are RAW (unescaped); escaping happens at substitution time.
 *
 * @param {{date:string,issueLine:string,preheader:string,intro:string,stories:Array<object>,readMoreUrl:string,unsubscribeUrl:string}} vm
 * @returns {Map<string,string>}
 */
export function buildTokenMap(vm) {
  const tokens = new Map();
  tokens.set('date', vm.date);
  tokens.set('issueLine', vm.issueLine);
  tokens.set('preheader', vm.preheader);
  tokens.set('intro', vm.intro);
  tokens.set('storyCount', String(vm.stories.length));
  tokens.set('readMoreUrl', vm.readMoreUrl);
  tokens.set('unsubscribeUrl', vm.unsubscribeUrl);

  vm.stories.forEach((story, i) => {
    const n = i + 1;
    tokens.set(`story${n}.headline`, story.headline);
    tokens.set(`story${n}.headlineUrl`, story.headlineUrl);
    tokens.set(`story${n}.source`, story.source);
    tokens.set(`story${n}.sourceUrl`, story.sourceUrl);
    tokens.set(`story${n}.summary`, story.summary);
    tokens.set(`story${n}.whatItMeans`, story.whatItMeans);
  });

  return tokens;
}

/**
 * Collapse the unused optional story blocks (2..5) out of the template so no
 * literal `{{storyN.*}}` token — nor an empty heading/divider — is left behind.
 *
 * The template structure (see `pulse-daily-brief.html`):
 *   <!-- Story 1 -->  <tr><td ...padding:24px;"> …story 1 content…
 *   <!-- Story 2 -->  <hr…> …story 2 content…
 *   … up to <!-- Story 5 (optional …) --> …story 5 content…
 *   </td></tr>  <!-- CTA -->
 *
 * Story 2..5 blocks each open with their `<!-- Story N` comment and are removed
 * entirely when unused (removing the leading `<hr>` too). Story 1's container
 * (`<tr><td>`) is shared by every story, so when NO stories exist we remove the
 * story-1 content lines but leave the container so the markup stays balanced.
 *
 * @param {string} html
 * @param {number} storyCount
 * @returns {string}
 */
export function collapseStoryBlocks(html, storyCount) {
  // Only the optional multi-story blocks are removed; the caller guarantees the
  // template uses the `<!-- Story N -->` markers.
  let out = html;
  for (let n = MAX_STORIES; n >= 2; n -= 1) {
    if (n <= storyCount) continue;
    out = removeStoryBlock(out, n);
  }
  return out;
}

/**
 * Remove one optional story block (marker + content) from the template.
 * The block spans from its `<!-- Story N` comment up to the next `<!-- Story M`
 * comment (or the `<!-- CTA` comment for the last block); the human note inside
 * the story-4/5 markers is tolerated.
 *
 * @param {string} html
 * @param {number} n
 * @returns {string}
 */
function removeStoryBlock(html, n) {
  const startMarker = `<!-- Story ${n}`;
  const start = html.indexOf(startMarker);
  if (start === -1) return html;

  // The block ends at the next story marker, else the CTA marker.
  const candidates = [];
  for (let m = n + 1; m <= MAX_STORIES; m += 1) {
    const idx = html.indexOf(`<!-- Story ${m}`, start + startMarker.length);
    if (idx !== -1) candidates.push(idx);
  }
  const cta = html.indexOf('<!-- CTA', start + startMarker.length);
  if (cta !== -1) candidates.push(cta);
  const end = candidates.length ? Math.min(...candidates) : html.length;

  return html.slice(0, start) + html.slice(end);
}

/**
 * Fill the template tokens with escaped values.
 *
 * @param {string} html
 * @param {Map<string,string>} tokens  RAW (unescaped) values.
 * @returns {string}
 */
export function fillTemplate(html, tokens) {
  // Deterministic single pass over the known token set. Longest keys first is not
  // required (keys are uniquely delimited), but the map iteration is stable.
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
 * @param {string} vm.issueLine
 * @param {string} vm.preheader
 * @param {string} vm.intro
 * @param {Array<object>} vm.stories
 * @param {string} vm.readMoreUrl
 * @param {string} vm.unsubscribeUrl
 * @param {string} [template]  Template override (tests).
 * @returns {string}
 */
export function renderBriefingPreview(vm, template = loadTemplate()) {
  const tokens = buildTokenMap(vm);
  const collapsed = collapseStoryBlocks(template, vm.stories.length);
  const filled = fillTemplate(collapsed, tokens);
  // Defensive: any story token we did not supply (should be none) is blanked so
  // a literal `{{` can never reach the client. The deliberate `{{unsubscribeUrl}}`
  // pass-through (Plunk fills it at send) is preserved.
  return filled
    .replace(/\{\{unsubscribeUrl\}\}/g, '\u0000UNSUB\u0000')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace('\u0000UNSUB\u0000', '{{unsubscribeUrl}}');
}

export default {
  escapeHtml,
  formatBriefingDate,
  buildStory,
  selectStories,
  buildTokenMap,
  collapseStoryBlocks,
  fillTemplate,
  renderBriefingPreview,
  MAX_STORIES,
  STORY_SECTION_PRIORITY,
};
