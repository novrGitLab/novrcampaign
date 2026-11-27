import { mediaUrl } from '../editionReview.js';
import { publicOrigin, safeUrl } from '../publicNews.js';
import { pillarLabel } from './pillars.js';
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
 *   fn 8 → 🧠 CyberIntel (the lead; parses Summary/Impact/Affected/Mitigation/
 *          Why it matters)
 *   fn 7 → 📰 Breaking News of the Day (ALL fn 7 pieces, pre-rendered)
 *   fn 4 → 🛡️ Cybersecurity Awareness / Cyber Hygiene (case study: Incident/
 *          Entry point/What the attacker did/Final impact/Key lesson)
 *   fn 1 → 🏛️ Regulatory Impact
 *   fn 5 → 📅 Events (Nigeria vs International by event region, else Nigeria)
 *   fn 6 → 🤝 Outreach Initiatives
 *   fn 3 → 🎓 Public Education & Advocacy
 *   fn 2 → 💬 Forum Topic of the Day
 *
 * SECTION HEADERS use the F1–F8 PILLAR NAMES (the emoji-prefixed strings in
 * `PILLAR_HEADERS`), not editorial copy.
 *
 * EMPTY-SECTION OMISSION: a section with no content renders NOTHING at all —
 * the whole block (header included) is dropped. A section WITH content renders
 * ONLY its filled slots (no empty source links, no repeated placeholder rows).
 * The pre-rendered section blocks are injected as RAW HTML via `RAWSECTIONS`;
 * every untrusted value inside them is escaped here at build time.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { pillarSlots } from './pillarShapes.js';

/** Path to the backend-owned template, resolved relative to this module. */
const TEMPLATE_PATH = fileURLToPath(
  new URL('../../templates/pulse-daily-brief.html', import.meta.url),
);

/** The maximum number of events per region group the template supports. */
export const MAX_EVENTS_PER_REGION = 2;

/**
 * The F1–F8 pillar section headers (emoji + pillar name). These are the ONLY
 * headers rendered in the preview — no editorial copy is carried anywhere.
 */
export const PILLAR_HEADERS = {
  1: '🏛️ Regulatory Impact',
  2: '💬 Forum Topic of the Day',
  3: '🎓 Public Education & Advocacy',
  4: '🛡️ Cybersecurity Awareness / Cyber Hygiene',
  5: '📅 Events',
  6: '🤝 Outreach Initiatives',
  7: '📰 Breaking News of the Day',
  8: '🧠 CyberIntel',
};

/**
 * The RAW-HTML section tokens. Each is replaced by a pre-rendered `<tr>` block
 * (or '' when the section is empty, so the block is OMITTED entirely). They are
 * substituted WITHOUT escaping — the builder escapes every value it interpolates.
 */
export const RAWSECTIONS = [
  'leadSection', 'newsSection', 'attackSection', 'regulatorySection',
  'eventsSection', 'careerSection', 'toolSection', 'productSection',
  'glossarySection', 'quizSection', 'editionSections',
];

/** Characters escaped for HTML-text/attribute contexts. */
const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * RETAINED FOR COMPATIBILITY ONLY — no longer rendered. Unfilled curated blocks
 * (Career / Tool / Assessment) are now OMITTED entirely instead of showing this
 * placeholder, so an unfilled edition has no repeated placeholder rows.
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
 *  - Headline uses the edited copy, with the linked title as a fallback.
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

  const referenceLine = /(?:^|\n)\s*(?:Reference|Full story):\s*(https?:\/\/\S+)\s*$/i.exec(body);
  const reference = safeUrl(referenceLine?.[1]);
  const copy = reference ? body.slice(0, referenceLine.index).trimEnd() : body;
  const parsed = parseComposedBody(copy, functionId);
  const headline = parsed.headline || collapseWhitespace(event?.title) || 'Untitled';
  const sourceUrl = reference || event?.canonicalUrl || '';
  const pulseStory = sourceUrl.startsWith(publicOrigin + '/news/');

  return {
    functionId,
    headline,
    source: pulseStory ? 'Read the full story on NovrPulse' : sourceName || (reference ? new URL(reference).hostname : 'NovrPulse'),
    sourceUrl: safeUrl(sourceUrl) || '',
    imageUrl: mediaUrl(link.imageUrl),
    imageAlt: link.imageAlt || '',
    imageCredit: link.imageCredit || '',
    slots: parsed.slots,
    body: copy,
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

/**
 * Pre-render the 🧠 CyberIntel lead block from the fn 8 story. Only FILLED
 * slots render — an empty Impact/Affected/Mitigation line is dropped, and the
 * 📌 Key Details box is omitted entirely when none of the three is present.
 */
function leadSectionHtml(story) {
  if (!story) return '';
  const s = story.slots;
  const summary = slotValue(s, 'Summary');
  const impact = slotValue(s, 'Impact');
  const affected = slotValue(s, 'Affected');
  const mitigation = slotValue(s, 'Mitigation');
  const whyItMatters = slotValue(s, 'Why it matters');

  const parts = [sectionHeader(8)];
  parts.push(`<p style="margin:16px 0 6px;font-size:18px;font-weight:bold;color:#ffffff;">${escapeHtml(story.headline)}</p>`);
  if (story.sourceName || story.sourceUrl) {
    const label = escapeHtml(story.source || 'source');
    const link = story.sourceUrl
      ? `<a href="${escapeHtml(story.sourceUrl)}" style="color:#8E9AD3;text-decoration:none;">${label}</a>`
      : label;
    parts.push(`<p style="margin:0 0 6px;font-size:12px;color:#6B76A3;">${link}</p>`);
  }
  if (summary) {
    parts.push(`<p style="margin:0;font-size:14px;line-height:1.6;color:#C4CBE4;"><strong style="color:#ffffff;">Summary:</strong> ${escapeHtml(summary)}</p>`);
  }

  const details = [];
  if (impact) details.push(`<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#C4CBE4;"><strong style="color:#ffffff;">Impact:</strong> ${escapeHtml(impact)}</p>`);
  if (affected) details.push(`<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#C4CBE4;"><strong style="color:#ffffff;">Affected:</strong> ${escapeHtml(affected)}</p>`);
  if (mitigation) details.push(`<p style="margin:0;font-size:14px;line-height:1.6;color:#C4CBE4;"><strong style="color:#ffffff;">Mitigation:</strong> ${escapeHtml(mitigation)}</p>`);
  if (details.length) {
    parts.push(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0A0F1C;border-radius:14px;margin:16px 0;">'
      + '<tr><td style="padding:12px 16px;">'
      + '<p style="margin:0 0 8px;font-size:14px;color:#ffffff;"><strong>📌 Key Details:</strong></p>'
      + details.join('')
      + '</td></tr></table>',
    );
  }

  if (whyItMatters) {
    parts.push(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid #f97316;background-color:#0F172A;border-radius:12px;">'
      + '<tr><td style="padding:10px 16px;">'
      + `<p style="margin:0;font-size:14px;line-height:1.6;color:#C4CBE4;"><strong style="color:#ffffff;">⚠️ Why It Matters:</strong> ${escapeHtml(whyItMatters)}</p>`
      + sourceLine(story.sourceUrl, story.source)
      + '</td></tr></table>',
    );
  }

  return sectionShell(parts.join(''));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-rendered section blocks (raw HTML)
//
// Each section renders its OWN `<tr>` block so an EMPTY section can be dropped
// entirely. Values are escaped HERE at build time; the blocks are injected raw.
// ─────────────────────────────────────────────────────────────────────────────

/** The shared section wrapper: a padded row with a top divider. */
function sectionShell(inner) {
  return `<tr><td class="m-px" style="padding:24px;border-top:1px solid #1E2A45;">${inner}</td></tr>`;
}

/** The section header line — the pillar name with a purple left rule. */
function sectionHeader(functionId) {
  return `<p style="margin:0 0 4px;font-size:20px;font-weight:bold;color:#ffffff;border-left:4px solid #662F8E;padding-left:12px;">${escapeHtml(PILLAR_HEADERS[functionId] ?? '')}</p>`;
}

/** A muted attribution line, or '' when there is no source URL/name. */
function sourceLine(url, name, prefix = '🔗 Source:') {
  if (!url && !name) return '';
  const label = escapeHtml(name || 'source');
  const link = url
    ? `<a href="${escapeHtml(url)}" style="color:#8E9AD3;text-decoration:none;">${label}</a>`
    : label;
  return `<p style="margin:8px 0 0;font-size:12px;color:#6B76A3;">${prefix} ${link}</p>`;
}

/**
 * Pre-render ALL fn 7 news pieces into one HTML block (no cap): one compact
 * block per story with its own filled summary + source. Renders '' when there
 * are no fn 7 stories, so the whole section is omitted.
 */
function newsSectionHtml(stories) {
  if (!stories.length) return '';
  const blocks = stories.map((story, i) => {
    const summary = slotValue(story.slots, 'What happened') || story.body;
    const divider = i === 0 ? '' : '<hr style="border:0;border-top:1px solid #1E2A45;margin:16px 0;">';
    const summaryHtml = summary
      ? `<p style="margin:0;font-size:14px;line-height:1.6;color:#C4CBE4;">${escapeHtml(summary)}</p>`
      : '';
    const src = sourceLine(story.sourceUrl, story.source);
    return `${divider}<p style="margin:16px 0 4px;font-size:16px;font-weight:bold;color:#ffffff;">${escapeHtml(story.headline)}</p>${summaryHtml}${src}`;
  });
  return sectionShell(sectionHeader(7) + blocks.join(''));
}

/**
 * Pre-render the 🛡️ Cybersecurity Awareness / Cyber Hygiene case-study block
 * from the fn 4 story. Only FILLED slots render; the 🔑 Key lesson callout is
 * omitted when the slot is empty.
 */
function attackSectionHtml(story) {
  if (!story) return '';
  const s = story.slots;
  const lines = [
    ['Incident', 'Incident'],
    ['Entry point', 'Entry Point'],
    ['What the attacker did', 'What the attacker did'],
    ['Final impact', 'Final Impact'],
  ];
  const parts = [
    sectionHeader(4),
    `<p style="margin:16px 0 8px;font-size:16px;font-weight:bold;color:#ffffff;">${escapeHtml(story.headline)}</p>`,
  ];
  for (const [label, display] of lines) {
    const value = slotValue(s, label);
    if (value) {
      parts.push(`<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#C4CBE4;"><strong style="color:#ffffff;">${display}:</strong> ${escapeHtml(value)}</p>`);
    }
  }
  const lesson = slotValue(s, 'Key lesson');
  if (lesson) {
    parts.push(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:4px solid #ef4444;background-color:#1A1F2E;border-radius:12px;margin-top:12px;">'
      + '<tr><td style="padding:10px 14px;">'
      + `<p style="margin:0;font-size:14px;line-height:1.6;color:#C4CBE4;"><strong style="color:#ffffff;">🔑 Key Lesson:</strong> ${escapeHtml(lesson)}</p>`
      + '</td></tr></table>',
    );
  }
  parts.push(sourceLine(story.sourceUrl, story.source));
  return sectionShell(parts.join(''));
}

/** Pre-render the 🏛️ Regulatory Impact block from the fn 1 story. */
function regulatorySectionHtml(story) {
  if (!story) return '';
  const body = slotValue(story.slots, 'What it means for organisations') || story.body;
  const parts = [
    sectionHeader(1),
    `<p style="margin:16px 0 8px;font-size:16px;font-weight:bold;color:#ffffff;">${escapeHtml(story.headline)}</p>`,
  ];
  if (body) {
    parts.push(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0A0F1C;border-radius:14px;">'
      + `<tr><td style="padding:12px 16px;"><p style="margin:0;font-size:14px;line-height:1.6;color:#C4CBE4;">${escapeHtml(body)}</p></td></tr></table>`,
    );
  }
  return sectionShell(parts.join(''));
}

/**
 * Pre-render the 🤝 Outreach Initiatives block from the fn 6 story. Renders
 * nothing when the body is empty.
 */
function productSectionHtml(story) {
  if (!story || !story.body) return '';
  const parts = [
    sectionHeader(6),
    `<p style="margin:16px 0 6px;font-size:16px;font-weight:bold;color:#ffffff;">${escapeHtml(story.headline)}</p>`,
    `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#C4CBE4;">${escapeHtml(story.body)}</p>`,
  ];
  if (story.sourceUrl) {
    parts.push(`<p style="margin:0;font-size:13px;color:#6B76A3;">🔗 <a href="${escapeHtml(story.sourceUrl)}" style="color:#8E9AD3;text-decoration:none;">Learn more</a></p>`);
  }
  return sectionShell(parts.join(''));
}

/** Pre-render the 📅 Events block from the fn 5 stories (Nigeria / International). */
function eventsSectionHtml(stories) {
  if (!stories.length) return '';
  const groups = { ng: [], intl: [] };
  for (const story of stories) {
    const event = story.event ?? {};
    (isNigeria(event) ? groups.ng : groups.intl).push(story);
  }

  const groupHtml = (title, list) => {
    const filled = list.slice(0, MAX_EVENTS_PER_REGION);
    if (!filled.length) return '';
    const items = filled.map((story) => {
      const event = story.event ?? {};
      const meta = [event.venue, event.startsAt ? formatBriefingDate(event.startsAt) : '']
        .filter(Boolean)
        .map(escapeHtml)
        .join(' — ');
      const focus = story.body
        ? `<p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:#9AA3C7;">Focus: ${escapeHtml(story.body)}</p>`
        : '';
      return `<p style="margin:0 0 4px;font-size:14px;color:#C4CBE4;"><strong style="color:#ffffff;">${escapeHtml(story.headline)}</strong>${meta ? ` — ${meta}` : ''}</p>${focus}${sourceLine(story.sourceUrl, story.source, '📌 Source:')}`;
    });
    return `<p style="margin:12px 0 6px;font-size:15px;font-weight:bold;color:#ffffff;">${title}</p>${items.join('')}`;
  };

  const inner = sectionHeader(5)
    + groupHtml('🇳🇬 Nigeria', groups.ng)
    + groupHtml('🌍 International', groups.intl);
  return sectionShell(inner);
}

/** Pre-render the 🎓 Public Education & Advocacy block from the fn 3 story. */
function glossarySectionHtml(story) {
  if (!story) return '';
  const definition = slotValue(story.slots, 'Explain in plain terms') || story.body;
  const term = slotValue(story.slots, 'Explain in plain terms') ? story.headline : '';
  if (!definition) return '';
  const head = term ? `<strong style="color:#ffffff;">${escapeHtml(term)}:</strong> ` : '';
  return sectionShell(
    sectionHeader(3)
    + `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#C4CBE4;">${head}${escapeHtml(definition)}</p>`,
  );
}

/** Whether an event's region string denotes Nigeria (default group). */
function isNigeria(event) {
  const region = String(event?.region ?? '').toLowerCase();
  return region === '' || region.includes('nigeria') || region === 'ng' || region === '🇳🇬';
}

/**
 * Build the complete token→value map for the template from a briefing view
 * model. Text tokens are RAW (unescaped); escaping happens at substitution time.
 * The section blocks are PRE-RENDERED HTML (escaped as they are built) and are
 * injected raw; an empty section maps to '' so the block is omitted entirely.
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

  // Pre-rendered section blocks ('' → omitted).
  const sections = {
    leadSection: leadSectionHtml(lead),
    newsSection: newsSectionHtml(news),
    attackSection: attackSectionHtml(attack),
    regulatorySection: regulatorySectionHtml(regulatory),
    eventsSection: eventsSectionHtml(events),
    productSection: productSectionHtml(outreach),
    glossarySection: glossarySectionHtml(glossary),
    // Curated blocks (manual in v1) have no source data yet → always omitted.
    careerSection: '',
    toolSection: '',
    quizSection: '',
  };
  for (const key of RAWSECTIONS) tokens.set(key, sections[key] ?? '');

  const edition = [];
  for (const id of [8,7,1,4,2,3,5,6,9,10]) {
    const stories=groups.get(id) || [];
    if (!stories.length) continue;
    const heading=escapeHtml(pillarLabel(id));
    const blocks=stories.map(story=>{
      const lines=String(story.body || '').trim().split(/\r?\n/);
      if(lines[0]?.trim()===story.headline)lines.shift();
      const slotTitles={SUMMARY:'Summary',IMPACT:'Impact','WHY IT MATTERS':'Why It Matters','KEY DETAILS':'Key Details',AFFECTED:'Who is affected','WHAT HAPPENED':'What happened',SOURCE:'Source'};
      const structured=Object.entries(story.slots).filter(([label,value])=>value && label !== story.headline);
      const paragraphs=structured.length ? structured.map(([name,value])=>'<p style="font:16px/1.6 Georgia,serif"><strong>'+escapeHtml(slotTitles[name] || name[0]+name.slice(1).toLowerCase())+'</strong><br>'+escapeHtml(value)+'</p>').join('') : lines.join('\n').trim().split(/\n\s*\n/).filter(Boolean).map(p=>'<p style="font:16px/1.6 Georgia,serif;margin:12px 0">'+escapeHtml(p).replaceAll('\n','<br>')+'</p>').join('');
      const photo=story.imageUrl?'<img width="540" style="display:block;width:100%;height:auto" src="'+escapeHtml(story.imageUrl)+'" alt="'+escapeHtml(story.imageAlt)+'"><p style="font:12px Arial;color:#5e5a59">'+escapeHtml(story.imageCredit)+'</p>':'';
      const link=safeUrl(story.sourceUrl);
      return '<h3 style="font: bold 25px/1.15 Georgia,serif;margin:12px 0">'+escapeHtml(story.headline)+'</h3>'+photo+paragraphs+(link?'<p><a style="color:#4353a3" href="'+escapeHtml(link)+'">'+escapeHtml(story.source)+'</a></p>':'');
    });
    edition.push('<tr><td style="padding:22px;border-top:1px solid #cfcac1"><h2 style="font: bold 13px Arial;color:#632d8a;margin:0">'+heading+'</h2>'+blocks.join('')+'</td></tr>');
  }
  tokens.set('editionSections',edition.join(''));
  // {{newsItems}} is retained as an alias for the pre-rendered news roll body.
  tokens.set('newsItems', sections.newsSection);

  tokens.set('unsubscribeUrl', vm.unsubscribeUrl);
  return tokens;
}

/**
 * Fill the template: RAW-HTML section tokens are injected verbatim, text tokens
 * are escaped. Section tokens are processed FIRST so a section body that happens
 * to contain a literal looked-like token cannot be re-escaped.
 *
 * @param {string} html
 * @param {Map<string,string>} tokens
 * @param {Set<string>} [rawKeys]  keys whose values are pre-rendered HTML.
 * @returns {string}
 */
export function fillTemplate(html, tokens, rawKeys = new Set(RAWSECTIONS.concat('newsItems'))) {
  let out = html;
  for (const [key, raw] of tokens) {
    const needle = `{{${key}}}`;
    if (!out.includes(needle)) continue;
    out = out.split(needle).join(rawKeys.has(key) ? raw : escapeHtml(raw));
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
  PILLAR_HEADERS,
  RAWSECTIONS,
  MAX_EVENTS_PER_REGION,
};
