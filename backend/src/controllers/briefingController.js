import { completeEdition, mediaUrl } from '../services/editionReview.js';
import Joi from 'joi';
import { prisma } from '../utils/prisma.js';
import { BadRequest, BadGateway, Conflict, Gone, NotFound } from '../utils/AppError.js';
import { deriveStatus } from './publishController.js';
import { PILLARS, pillarLabel } from '../services/novrpulse/pillars.js';
import { renderBriefingPreview, groupStories, formatBriefingDate } from '../services/novrpulse/briefingPreview.js';
import * as plunk from '../services/plunkService.js';
import { config } from '../config/env.js';

/**
 * Daily Briefing Desk.
 *
 * A `briefing` is one day's briefing, composed of eight ordered `briefing_section`
 * rows — exactly one per pillar (functionId 1..8). Each section references ordered
 * `briefing_section_item` rows, the publish items that make up that section.
 *
 * Editorial model / authorization:
 *  - Identity always comes from the session (`req.user.id`, set by `requireAuth`).
 *    The body is never trusted for identity or status.
 *  - Any authenticated user may compose a briefing (the desk is internal), matching
 *    the relaxed publish-item policy. Routes sit behind `requireAuth` in `index.js`.
 *
 * Two invariants enforced here:
 *  1. Attaching/detaching NEVER deletes a `publish_item` — only the link row.
 *  2. Every section lookup is scoped to the briefing id, so a section id from a
 *     different briefing is a 404, never a cross-briefing write.
 */

// The seven briefing lifecycle states.
const BRIEFING_STATUSES = ['not_started', 'draft', 'in_review', 'approved', 'scheduled', 'published', 'archived'];
// The four per-section states.
const SECTION_STATES = ['empty', 'no_updates', 'ready', 'awaiting'];
// The two publish-item content types.
const CONTENT_TYPES = ['briefing', 'urgent_alert'];
// Delete is only permitted while the briefing is still being composed.
const DELETABLE_STATUSES = ['not_started', 'draft'];

// §02/§05/§06 are the sections fed by standalone supporting records.
const EVENTS_FUNCTION_ID = 5;
const OUTREACH_FUNCTION_ID = 6;
const FORUM_TOPIC_FUNCTION_ID = 2;

const createBriefingSchema = Joi.object({
  briefingDate: Joi.string().isoDate().required(),
  title: Joi.string().trim().max(300).allow('', null),
});

const updateBriefingSchema = Joi.object({
  title: Joi.string().trim().max(300).allow('', null),
  status: Joi.string().valid(...BRIEFING_STATUSES),
  scheduledFor: Joi.string().isoDate().allow(null),
}).min(1);

const listBriefingSchema = Joi.object({
  from: Joi.string().isoDate(),
  to: Joi.string().isoDate(),
  status: Joi.string().valid(...BRIEFING_STATUSES),
});

// Publish → Preview → Send (owner requirement 2026-11-25). A test send needs an
// address (defaulted to the caller's own when omitted); a production send needs
// at least one segment (defaulted from config). `email` is validated as an email
// address — the client sends a real address, not a URI.
const publishBriefingSchema = Joi.object({
  test: Joi.boolean().default(false),
  email: Joi.string().trim().email({ tlds: { allow: false } }).when('test', {
    is: true,
    then: Joi.optional(),
    otherwise: Joi.forbidden(),
  }),
  segments: Joi.array().items(Joi.string().trim().min(1)).max(50),
});

const updateSectionSchema = Joi.object({
  state: Joi.string().valid(...SECTION_STATES),
  note: Joi.string().allow('', null),
  position: Joi.number().integer().min(0),
}).min(1);

const attachItemSchema = Joi.object({
  publishItemId: Joi.string().trim().min(1).required(),
  position: Joi.number().integer().min(0),
});

const reorderSchema = Joi.object({
  itemIds: Joi.array().items(Joi.string().trim().min(1)).min(1).required(),
});

const authorSchema = Joi.object({
  body: Joi.string().trim().min(1).required(),
  contentType: Joi.string().valid(...CONTENT_TYPES).default('briefing'),
});

const supportingEventSchema = Joi.object({
  title: Joi.string().trim().min(1).max(300).required(),
  description: Joi.string().trim().min(1).max(5000).required(),
  organiser: Joi.string().trim().min(1).max(300).required(),
  startsAt: Joi.string().isoDate().required(),
  venue: Joi.string().trim().max(300).allow('', null),
  onlineUrl: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(2000).allow('', null),
  registrationUrl: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(2000).allow('', null),
  verified: Joi.boolean(),
});

const supportingEventUpdateSchema = supportingEventSchema.fork(
  ['title', 'description', 'organiser', 'startsAt'],
  (s) => s.optional(),
);

const opportunitySchema = Joi.object({
  title: Joi.string().trim().min(1).max(300).required(),
  description: Joi.string().trim().min(1).max(5000).required(),
  kind: Joi.string().valid('scholarship', 'course', 'programme', 'other').required(),
  provider: Joi.string().trim().max(300).allow('', null),
  deadline: Joi.string().isoDate().allow(null),
  url: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(2000).allow('', null),
  verified: Joi.boolean(),
});

const opportunityUpdateSchema = opportunitySchema.fork(
  ['title', 'description', 'kind'],
  (s) => s.optional(),
);

const forumTopicSchema = Joi.object({
  title: Joi.string().trim().min(1).max(300).required(),
  prompt: Joi.string().trim().min(1).max(5000).required(),
  scheduledFor: Joi.string().isoDate().allow(null),
  publishItemId: Joi.string().trim().min(1).allow(null),
  forumUrl: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(2000).allow('', null),
});

const forumTopicUpdateSchema = forumTopicSchema.fork(['title', 'prompt'], (s) => s.optional());

// ── validation helpers ────────────────────────────────────────────────────────

/**
 * Validate with a Joi schema, converting a Joi failure into the repo's
 * `BadRequest` (400). A raw Joi error carries no status and the shared error
 * handler would otherwise turn it into a 500.
 */
async function validate(schema, value, options = { convert: true, stripUnknown: true }) {
  try {
    return await schema.validateAsync(value, options);
  } catch (err) {
    if (err.isJoi) throw BadRequest(err.message);
    throw err;
  }
}

// ── serializers ───────────────────────────────────────────────────────────────

function isoOrNull(value) {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

/** The ≤200-char preview of a publish item body used in the briefing detail. */
function bodyPreview(body) {
  if (typeof body !== 'string') return '';
  return body.length > 200 ? body.slice(0, 200) : body;
}

/**
 * Compact summary of a publish item as it appears inside a section: identity,
 * pillar, derived status, a short body preview, and the sign-off timestamps.
 * Staff use the complete body to edit the attached item from the newsroom.
 */
function serializePublishItemSummary(item) {
  return {
    id: item.id,
    functionId: item.functionId,
    contentType: item.contentType,
    status: deriveStatus(item),
    bodyPreview: bodyPreview(item.body),
    body: item.body,
    approvedAt: isoOrNull(item.approvedAt),
    publishedAt: isoOrNull(item.publishedAt),
  };
}

/** A section with its ordered items (each item carrying its publish-item summary). */
function serializeSection(section) {
  const items = [...(section.items ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((link) => ({
      id: link.id,
      position: link.position,
      publishItemId: link.publishItemId,
      imageUrl: link.imageUrl ?? null, imageAlt: link.imageAlt ?? null, imageCredit: link.imageCredit ?? null,
      publishItem: link.publishItem ? serializePublishItemSummary(link.publishItem) : null,
    }));

  return {
    id: section.id,
    briefingId: section.briefingId,
    functionId: section.functionId,
    label: pillarLabel(section.functionId),
    position: section.position,
    state: section.state,
    note: section.note ?? null,
    itemCount: items.length,
    items,
  };
}

/** Briefing header fields, without sections. */
function serializeBriefing(briefing) {
  return {
    id: briefing.id,
    briefingDate: isoOrNull(briefing.briefingDate),
    status: briefing.status,
    title: briefing.title ?? null,
    publishedAt: isoOrNull(briefing.publishedAt),
    scheduledFor: isoOrNull(briefing.scheduledFor),
    createdAt: isoOrNull(briefing.createdAt),
    updatedAt: isoOrNull(briefing.updatedAt),
  };
}

/** Fold a briefing's sections into counts keyed by section state. */
function sectionCountsByState(sections) {
  const counts = { empty: 0, no_updates: 0, ready: 0, awaiting: 0 };
  for (const s of sections ?? []) {
    if (counts[s.state] === undefined) counts[s.state] = 0;
    counts[s.state] += 1;
  }
  return counts;
}

// ── shared lookups ────────────────────────────────────────────────────────────

/** Prisma `include` for a section with its items and each item's publish item. */
const SECTION_INCLUDE = {
  items: {
    orderBy: { position: 'asc' },
    include: { publishItem: true },
  },
};

/**
 * Prisma include for the preview: each section item's publish item (body +
 * functionId) and its linked event, with the first provenance source for
 * attribution (source name) plus the event's canonical URL.
 */
const PREVIEW_ITEM_INCLUDE = {
  publishItem: {
    include: {
      event: {
        select: {
          title: true,
          publishedAt: true,
          canonicalUrl: true,
          region: true,
          eventType: true,
          sources: {
            orderBy: { extractedAt: 'asc' },
            take: 1,
            select: { rawDocument: { select: { source: { select: { name: true } } } } },
          },
        },
      },
    },
  },
};

/** Load a briefing by id or throw 404. */
async function requireBriefing(id) {
  const briefing = await prisma.briefing.findUnique({ where: { id } });
  if (!briefing) throw NotFound('Briefing not found');
  if (briefing.publishedAt || briefing.sendingAt) throw Conflict('This edition is closed for editing.');
  return briefing;
}

/**
 * Load a section scoped to its briefing (404 when the section is not part of
 * that briefing) with its items, or throw 404.
 */
async function requireSection(briefingId, functionId) {
  await requireBriefing(briefingId);
  const fid = Number(functionId);
  if (!Number.isInteger(fid)) throw BadRequest('functionId must be an integer');

  const section = await prisma.briefingSection.findUnique({
    where: { briefingId_functionId: { briefingId, functionId: fid } },
    include: SECTION_INCLUDE,
  });
  if (!section) throw NotFound('Briefing section not found');
  return section;
}

/** Reload a section (by id) with its items — used to return the fresh shape. */
function reloadSection(sectionId) {
  return prisma.briefingSection.findUnique({ where: { id: sectionId }, include: SECTION_INCLUDE });
}

/**
 * Whether a thrown Prisma error is a unique-constraint violation (P2002), used
 * to convert a race on the briefing-date / section-item unique keys into a 409.
 */
function isUniqueViolation(err) {
  return err?.code === 'P2002';
}

// ── briefing CRUD ─────────────────────────────────────────────────────────────

/**
 * GET /api/briefings — list briefings, newest first, each with a state count
 * breakdown of its sections. Optional `from`/`to` (briefingDate) and `status`.
 */
export async function listBriefings(req, res) {
  const { from, to, status } = await validate(listBriefingSchema, req.query);

  const where = {};
  if (status) where.status = status;
  if (from || to) {
    where.briefingDate = {};
    if (from) where.briefingDate.gte = new Date(from);
    if (to) where.briefingDate.lte = new Date(to);
  }

  const briefings = await prisma.briefing.findMany({
    where,
    orderBy: { briefingDate: 'desc' },
    include: { sections: { select: { state: true } } },
  });

  return res.json({
    briefings: briefings.map((b) => ({
      ...serializeBriefing(b),
      sectionCounts: sectionCountsByState(b.sections),
      sectionTotal: b.sections?.length ?? 0,
    })),
  });
}

/**
 * GET /api/briefings/:id — the full briefing: the eight sections in pillar
 * order, each with its ordered items (publish-item summaries) and — for the
 * pillars fed by standalone records — the supporting-record counts.
 */
export async function getBriefing(req, res) {
  const briefing = await prisma.briefing.findUnique({
    where: { id: req.params.id },
    include: { sections: { orderBy: { position: 'asc' }, include: SECTION_INCLUDE } },
  });
  if (!briefing) throw NotFound('Briefing not found');

  const [supportingEvents, opportunities, forumTopics] = await Promise.all([
    prisma.supportingEvent.count(),
    prisma.opportunity.count(),
    prisma.forumTopic.count(),
  ]);

  // Supporting counts are keyed by the pillar that renders them (§02/§05/§06).
  const supportingCounts = {
    [FORUM_TOPIC_FUNCTION_ID]: forumTopics,
    [EVENTS_FUNCTION_ID]: supportingEvents,
    [OUTREACH_FUNCTION_ID]: opportunities,
  };

  return res.json({
    briefing: {
      ...serializeBriefing(briefing),
      sections: briefing.sections.map((s) => ({
        ...serializeSection(s),
        supportingCount: supportingCounts[s.functionId] ?? 0,
      })),
      // Publish affordances for the client: whether a default segment is
      // configured (drives the "Send to segment" disabled state) and whether the
      // briefing has any items to send at all (drives the Send button state).
      reviewComplete: completeEdition(briefing.sections),
      publishSegmentConfigured: Boolean(config.novrpulse.pulseSegment),
      itemCount: briefing.sections.reduce((n, s) => n + (s.items?.length ?? 0), 0),
    },
  });
}

/**
 * Load a briefing with the sections/items/events needed to render its email,
 * or throw 404. Used by BOTH the preview endpoint and the publish endpoint so
 * the preview and the sent email are built from the same query and the same
 * renderer (they must be byte-identical — owner requirement 2026-11-25).
 */
async function loadBriefingForRender(id) {
  const briefing = await prisma.briefing.findUnique({
    where: { id },
    include: {
      sections: {
        orderBy: { position: 'asc' },
        include: { items: { orderBy: { position: 'asc' }, include: PREVIEW_ITEM_INCLUDE } },
      },
    },
  });
  if (!briefing) throw NotFound('Briefing not found');
  return briefing;
}

/**
 * Render a loaded briefing through the email template. THE single render path —
 * the preview endpoint and the publish send both call this, so the preview and
 * the sent email are byte-identical.
 */
function renderBriefingHtml(briefing) {
  return renderBriefingPreview({
    date: formatBriefingDate(briefing.briefingDate),
    preheader: briefing.title ?? '',
    groups: groupStories(briefing.sections),
    unsubscribeUrl: '{{unsubscribeUrl}}',
  });
}

/** Count of publish items attached anywhere in the briefing. */
function briefingItemCount(briefing) {
  return (briefing.sections ?? []).reduce((n, s) => n + (s.items?.length ?? 0), 0);
}

/**
 * POST /api/briefings/:id/preview — render the assembled briefing through the
 * `pulse-daily-brief.html` email template and return the full HTML for the
 * Briefing Desk's sandboxed-iframe preview.
 *
 * The view model is built server-side from the briefing's sections (ordered by
 * position) and their ordered items. Items are grouped by their section's
 * functionId and the renderer maps each group into the matching template block
 * (§08 → the deep-dive lead, §07 → the news roll, §04 → the case study, §01 →
 * Regulatory Impact, §05 → Events, §06 → Product Corner, §03 → Glossary).
 *  - `source`/`sourceUrl` come from the item's linked event (source name, event
 *    canonical URL); a manually-authored item with no event is attributed to
 *    'NovrPulse'.
 * `unsubscribeUrl` is left as the literal `{{unsubscribeUrl}}` pass-through that
 * Plunk fills at send time.
 *
 * SECURITY: the template is rendered server-side and every injected value is
 * HTML-escaped by `.renderBriefingPreview` — article text is untrusted and must
 * never be able to inject markup. The client only displays the returned string in
 * a `sandbox=""` iframe.
 */
export async function previewBriefing(req, res) {
  const briefing = await loadBriefingForRender(req.params.id);
  return res.json({ html: renderBriefingHtml(briefing) });
}

/**
 * The subject line for a briefing send. The title when set, else a dated
 * fallback — mirrors the campaign desk's fixed-sender pattern.
 */
function briefingSubject(briefing) {
  return (briefing.title && briefing.title.trim()) || `NovrPulse Daily Briefing — ${formatBriefingDate(briefing.briefingDate)}`;
}

/**
 * Record a `briefing_publication` row. `kind` is 'production' | 'test'. A test
 * row is written for AUDIT but never snapshots the whole email and never counts
 * as a publication of the briefing. `version` is the next per-briefing sequence
 * number over ALL rows (so test and production rows never collide on the
 * `(briefingId, version)` unique key).
 */
async function recordPublication(briefingId, { kind, html, segments, recipientSummary }) {
  const last = await prisma.briefingPublication.findFirst({
    where: { briefingId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  return prisma.briefingPublication.create({
    data: {
      briefingId,
      kind,
      version: nextVersion,
      html: html ?? null,
      segments: segments ?? [],
      recipientSummary: recipientSummary ?? null,
      sentAt: new Date(),
    },
  });
}

/**
 * POST /api/briefings/:id/publish — Publish → Preview → Send
 * (owner requirement 2026-11-25). Behind `requireAuth`.
 *
 * Body (Joi): `{ test?: boolean, email?: string, segments?: string[] }`.
 *
 * Flow:
 *  1. Load the briefing + ordered sections/items (+ linked events) and render the
 *     email through THE SAME renderer the preview endpoint uses (byte-identical).
 *  2. Guard: 400 when the briefing has no items ("Nothing to publish"); 409 when
 *     it is already published.
 *  3. `test: true` → send ONE email to `email` (defaults to the caller's own
 *     address) via the campaign test-send primitive; write a `kind: 'test'`
 *     publication row for audit; return `{ sent: true, test: true, to }`.
 *  4. production → segments are `body.segments` or `[NP_PULSE_SEGMENT]`; when
 *     neither is configured, 400 `NO_SEGMENT_CONFIGURED`. Send via the campaign
 *     create+send primitives to each segment, then write the `production`
 *     publication row (html snapshot + version + sentAt + segments), set
 *     `briefing.status = 'published'` and stamp `publishedAt` on the briefing and
 *     every attached publish item.
 *  5. Failures are honest: a Plunk error becomes a 502 carrying the provider
 *     message, and the briefing is NOT marked published.
 */
export async function publishBriefing(req, res) {
  const value = await validate(publishBriefingSchema, req.body);
  const briefing = await loadBriefingForRender(req.params.id);

  // Guard 1 — nothing to send.
  if (briefingItemCount(briefing) === 0) {
    throw BadRequest('Nothing to publish');
  }
  // Guard 2 — already published.
  if (briefing.status === 'published') {
    throw Conflict('Briefing is already published', { briefingId: briefing.id });
  }

  const html = renderBriefingHtml(briefing);
  const subject = briefingSubject(briefing);

  // ── Test send ────────────────────────────────────────────────────────────
  if (value.test) {
    const to = value.email || req.user?.email;
    if (!to) throw BadRequest('No email to send the test to — pass `email` in the body');

    let lastError;
    try {
      // Reuse the campaign primitives: create a TRANSACTIONAL draft, then send a
      // single test copy. Nothing is transmitted to a segment.
      const campaign = await plunk.createCampaign({
        name: `Briefing test · ${formatBriefingDate(briefing.briefingDate)}`,
        subject,
        body: html,
        type: 'TRANSACTIONAL',
        audienceType: 'ALL',
      });
      await plunk.testCampaign(campaign.id, to);
      // The throwaway test campaign is deleted so it never appears as a draft.
      await plunk.deleteCampaign(campaign.id).catch(() => {});
    } catch (err) {
      lastError = err;
    }

    if (lastError) {
      throw BadGateway(
        `Could not send the test email: ${lastError.message}`,
        { provider: 'plunk', status: lastError.status ?? null },
      );
    }

    // Audit row (kind 'test'). Never marks the briefing published.
    await recordPublication(briefing.id, { kind: 'test', segments: [], recipientSummary: { test: true, to } });

    return res.json({ sent: true, test: true, to });
  }

  // ── Production send ────────────────────────────────────────────────────────
  const configured = Array.isArray(value.segments) && value.segments.length
    ? [...new Set(value.segments)]
    : (config.novrpulse.pulseSegment ? [config.novrpulse.pulseSegment] : []);

  if (configured.length === 0) {
    throw Object.assign(
      BadRequest('Set NP_PULSE_SEGMENT or pass segments'),
      { code: 'NO_SEGMENT_CONFIGURED' },
    );
  }

  if (!completeEdition(briefing.sections)) throw BadRequest('Review all ten sections before sending.');
  const claim = await prisma.briefing.updateMany({ where: { id: briefing.id, publishedAt: null, sendingAt: null }, data: { sendingAt: new Date() } });
  if (claim.count !== 1) throw Conflict('Delivery is in progress or has already completed.');
  const sentCampaigns = [];
  let sendError;
  let dispatchAttempted = false;
  try {
    for (const segment of configured) {
      // Reuse the campaign primitives: create a MARKETING campaign targeted at
      // the segment, then send it now. `segment` is the Plunk segment id.
      const campaign = await plunk.createCampaign({
        name: `NovrPulse Daily Briefing · ${formatBriefingDate(briefing.briefingDate)}`,
        subject,
        body: html,
        type: 'MARKETING',
        audienceType: 'SEGMENT',
        segmentId: segment,
      });
      dispatchAttempted = true;
      await plunk.sendCampaign(campaign.id);
      sentCampaigns.push({ segment, campaignId: campaign.id });
    }
  } catch (err) {
    sendError = err;
  }

  if (sendError) {
    if (!dispatchAttempted) await prisma.briefing.updateMany({ where: { id: briefing.id, publishedAt: null }, data: { sendingAt: null } });
    // Fail loudly and honestly: 502 with the provider message; the briefing is
    // NOT marked published.
    throw BadGateway(
      `Could not send the briefing: ${sendError.message}`,
      { provider: 'plunk', status: sendError.status ?? null, segments: configured },
    );
  }

  const publication = await recordPublication(briefing.id, {
    kind: 'production',
    html,
    segments: configured,
    recipientSummary: { segments: configured, campaigns: sentCampaigns },
  });

  // Mark the briefing and every attached publish item published. One write each,
  // in a transaction, so the record is consistent.
  const now = new Date();
  const publishItemIds = [
    ...new Set(
      (briefing.sections ?? []).flatMap((s) => (s.items ?? []).map((i) => i.publishItemId)),
    ),
  ];
  await prisma.$transaction([
    prisma.briefing.update({
      where: { id: briefing.id },
      data: { status: 'published', publishedAt: now, sendingAt: null },
    }),
    ...publishItemIds.map((id) =>
      prisma.publishItem.update({ where: { id }, data: { publishedAt: now } }),
    ),
  ]);

  return res.json({
    sent: true,
    segments: configured,
    publicationId: publication.id,
    publishedAt: now.toISOString(),
  });
}

/**
 * POST /api/briefings/:id — create a briefing and auto-seed its eight sections in
 * ONE transaction. `position` equals `functionId`; every section starts
 * `empty`. A duplicate date is a 409 (the `briefingDate` unique key).
 */
export async function createBriefing(req, res) {
  const { briefingDate, title } = await validate(createBriefingSchema, req.body);

  const existing = await prisma.briefing.findUnique({ where: { briefingDate: new Date(briefingDate) } });
  if (existing) throw Conflict('A briefing already exists for that date', { briefingId: existing.id });

  let briefing;
  try {
    briefing = await prisma.$transaction(async (tx) => {
      const created = await tx.briefing.create({
        data: { briefingDate: new Date(briefingDate), title: title || null },
      });
      await tx.briefingSection.createMany({
        data: PILLARS.map((p) => ({
          briefingId: created.id,
          functionId: p.functionId,
          position: p.functionId,
          state: 'empty',
        })),
      });
      return tx.briefing.findUnique({
        where: { id: created.id },
        include: { sections: { orderBy: { position: 'asc' }, include: SECTION_INCLUDE } },
      });
    });
  } catch (err) {
    // A concurrent create can still lose the race on the unique date key.
    if (isUniqueViolation(err)) throw Conflict('A briefing already exists for that date');
    throw err;
  }

  return res.status(201).json({
    briefing: { ...serializeBriefing(briefing), sections: briefing.sections.map(serializeSection) },
  });
}

/**
 * PATCH /api/briefings/:id — update title/status/scheduledFor.
 *
 * Transition policy (documented, intentionally minimal): any of the seven
 * statuses may be set from any other for now — the workflow is being bedded in
 * and the desk owns the sequence. Only the value is validated (Joi); no
 * transition graph is enforced yet.
 */
export async function updateBriefing(req, res) {
  const value = await validate(updateBriefingSchema, req.body);
  const current = await requireBriefing(req.params.id);

  const data = {};
  if (value.title !== undefined) data.title = value.title || null;
  if (value.status === 'published') throw BadRequest('Use Send to publish a briefing.');
  if (value.status !== undefined) data.status = value.status;
  if (value.scheduledFor !== undefined) {
    data.scheduledFor = value.scheduledFor === null ? null : new Date(value.scheduledFor);
  }

  const updated = await prisma.briefing.update({ where: { id: current.id }, data });
  return res.json({ briefing: serializeBriefing(updated) });
}

/**
 * DELETE /api/briefings/:id — only while `not_started` or `draft`. Once a
 * briefing is in review or later it is part of the record and may not be
 * removed. Sections and section items cascade on delete.
 */
export async function deleteBriefing(req, res) {
  const current = await requireBriefing(req.params.id);
  if (!DELETABLE_STATUSES.includes(current.status)) {
    throw Conflict('cannot delete a briefing in review or later');
  }
  await prisma.briefing.delete({ where: { id: current.id } });
  return res.status(204).send();
}

// ── section management ────────────────────────────────────────────────────────

/**
 * PATCH /api/briefings/:id/sections/:functionId — update a section's
 * state/note/position. The section is looked up within the briefing, so a
 * functionId that is not part of it is a 404.
 */
export async function updateSection(req, res) {
  const value = await validate(updateSectionSchema, req.body);
  const section = await requireSection(req.params.id, req.params.functionId);

  const data = {};
  if (value.state === 'ready' && !section.items.length) throw BadRequest('Confirm no updates for an empty section.');
  if (value.state === 'no_updates' && section.items.length) throw BadRequest('Review the stories in this section.');
  if (value.state !== undefined) data.state = value.state;
  if (value.note !== undefined) data.note = value.note || null;
  if (value.position !== undefined) data.position = value.position;

  await prisma.briefingSection.update({ where: { id: section.id }, data });
  const fresh = await reloadSection(section.id);
  return res.json({ section: serializeSection(fresh) });
}

/**
 * POST /api/briefings/:id/sections/:functionId/items — attach an existing
 * publish item to the section. Reorder-safe: the default position is
 * `max(existing)+1`. Attaching an item already in this section is a 409; an
 * unknown publish item is a 404. Only the LINK is created — the publish item
 * itself is never touched.
 */
export async function attachSectionItem(req, res) {
  const { publishItemId, position } = await validate(attachItemSchema, req.body);
  const section = await requireSection(req.params.id, req.params.functionId);

  const publishItem = await prisma.publishItem.findUnique({ where: { id: publishItemId } });
  if (!publishItem) throw NotFound('Publish item not found');

  const existing = await prisma.briefingSectionItem.findUnique({
    where: { sectionId_publishItemId: { sectionId: section.id, publishItemId } },
  });
  if (existing) throw Conflict('Publish item is already attached to this section');

  let targetPosition = position;
  if (targetPosition === undefined) {
    const last = await prisma.briefingSectionItem.findFirst({
      where: { sectionId: section.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    targetPosition = last ? last.position + 1 : 0;
  }

  try {
    await prisma.$transaction([prisma.briefingSectionItem.create({data: { sectionId: section.id, publishItemId, position: targetPosition }}), prisma.briefingSection.update({where: {id:section.id},data:{state:'awaiting'}})]);
  } catch (err) {
    if (isUniqueViolation(err)) throw Conflict('Publish item is already attached to this section');
    throw err;
  }

  const fresh = await reloadSection(section.id);
  return res.status(201).json({ section: serializeSection(fresh) });
}

/**
 * DELETE /api/briefings/:id/sections/:functionId/items/:itemId — detach a link.
 * Deletes the LINK ROW ONLY; the underlying `publish_item` is never deleted.
 */
export async function detachSectionItem(req, res) {
  const section = await requireSection(req.params.id, req.params.functionId);

  const link = await prisma.briefingSectionItem.findUnique({ where: { id: req.params.itemId } });
  // Scope the link to this section: a link id from another section is a 404.
  if (!link || link.sectionId !== section.id) throw NotFound('Section item not found');

  await prisma.$transaction([prisma.briefingSectionItem.delete({where:{id:link.id}}), prisma.briefingSection.update({where:{id:section.id},data:{state:'awaiting'}})]);

  const fresh = await reloadSection(section.id);
  return res.json({ section: serializeSection(fresh) });
}

/**
 * PATCH /api/briefings/:id/sections/:functionId/items/reorder — set positions
 * 0..n in the given order. The submitted id set must match the section's
 * current items exactly (same members), otherwise it is a 400.
 */
export async function reorderSectionItems(req, res) {
  const { itemIds } = await validate(reorderSchema, req.body);
  const section = await requireSection(req.params.id, req.params.functionId);

  const current = new Set(section.items.map((i) => i.id));
  if (itemIds.length !== current.size || new Set(itemIds).size !== itemIds.length) {
    throw BadRequest('itemIds must match the section items exactly');
  }
  if (!itemIds.every((id) => current.has(id))) {
    throw BadRequest('itemIds must match the section items exactly');
  }

  await prisma.$transaction(
    itemIds.map((id, index) =>
      prisma.briefingSectionItem.update({ where: { id }, data: { position: index } }),
    ),
  );

  const fresh = await reloadSection(section.id);
  return res.json({ section: serializeSection(fresh) });
}

/**
 * POST /api/briefings/:id/sections/:functionId/author — RETIRED.
 *
 * The Desk is an attach-only surface: editorial content is written in exactly one
 * place, the Editorial Canvas (Inbox → Write → pillar → item). Authoring here
 * duplicated that surface and made "needs write-up" meaningless, so the route is
 * permanently refused server-side — not merely hidden in the UI — with a 410 Gone
 * and a stable `AUTHOR_MOVED_TO_CANVAS` code the client can branch on.
 *
 * The original authoring implementation is retained (inert) in the comment below
 * so the historical create-and-attach transaction stays documented; the guard
 * short-circuits before any validation or database access.
 */
export async function authorSectionItem() {
  throw Gone(
    'Editorial content is created in the Editorial Canvas; the Desk only attaches existing items.',
    'AUTHOR_MOVED_TO_CANVAS',
  );
}

/*
 * Original implementation (retired alongside the rule above). It created a
 * `publish_item` — `tier: 'public'`, `templateVersion: 'manual@1.0.0'`,
 * `functionId` from the section, `editorId` from the session, `approvedAt: null`
 * (a draft, not a sign-off) — and attached it to the section in one transaction:
 *
 *   const { body, contentType } = await validate(authorSchema, req.body);
 *   const section = await requireSection(req.params.id, req.params.functionId);
 *
 *   const last = await prisma.briefingSectionItem.findFirst({
 *     where: { sectionId: section.id },
 *     orderBy: { position: 'desc' },
 *     select: { position: true },
 *   });
 *   const position = last ? last.position + 1 : 0;
 *
 *   await prisma.$transaction(async (tx) => {
 *     const item = await tx.publishItem.create({
 *       data: {
 *         functionId: section.functionId,
 *         tier: 'public',
 *         contentType,
 *         body,
 *         templateVersion: 'manual@1.0.0',
 *         editorId: req.user?.id ?? null,
 *         approvedAt: null,
 *       },
 *     });
 *     await tx.briefingSectionItem.create({
 *       data: { sectionId: section.id, publishItemId: item.id, position },
 *     });
 *   });
 *
 *   const fresh = await reloadSection(section.id);
 *   return res.status(201).json({ section: serializeSection(fresh) });
 */

// ── supporting records (§05 events / §06 opportunities / §02 forum topics) ─────

/**
 * GET /api/briefings/supporting/events — list supporting events, soonest first.
 */
export async function listSupportingEvents(_req, res) {
  const events = await prisma.supportingEvent.findMany({ orderBy: { startsAt: 'asc' } });
  return res.json({ events: events.map(serializeSupportingEvent) });
}

/**
 * POST /api/briefings/supporting/events — create a supporting event. When the
 * body carries `verified: true`, `verifiedAt` is stamped now.
 */
export async function createSupportingEvent(req, res) {
  const value = await validate(supportingEventSchema, req.body);
  const event = await prisma.supportingEvent.create({ data: supportingEventData(value) });
  return res.status(201).json({ event: serializeSupportingEvent(event) });
}

/**
 * PATCH /api/briefings/supporting/events/:id — update a supporting event.
 */
export async function updateSupportingEvent(req, res) {
  const value = await validate(supportingEventUpdateSchema, req.body);
  const current = await prisma.supportingEvent.findUnique({ where: { id: req.params.id } });
  if (!current) throw NotFound('Supporting event not found');

  const event = await prisma.supportingEvent.update({
    where: { id: current.id },
    data: supportingEventData(value),
  });
  return res.json({ event: serializeSupportingEvent(event) });
}

/**
 * DELETE /api/briefings/supporting/events/:id
 */
export async function deleteSupportingEvent(req, res) {
  const current = await prisma.supportingEvent.findUnique({ where: { id: req.params.id } });
  if (!current) throw NotFound('Supporting event not found');
  await prisma.supportingEvent.delete({ where: { id: current.id } });
  return res.status(204).send();
}

/**
 * Build the Prisma `data` for a supporting event, only including supplied
 * fields (so PATCH leaves untouched columns alone) and stamping `verifiedAt`
 * when `verified: true` is sent.
 */
function supportingEventData(value) {
  const data = {};
  if (value.title !== undefined) data.title = value.title;
  if (value.description !== undefined) data.description = value.description;
  if (value.organiser !== undefined) data.organiser = value.organiser;
  if (value.startsAt !== undefined) data.startsAt = new Date(value.startsAt);
  if (value.venue !== undefined) data.venue = value.venue || null;
  if (value.onlineUrl !== undefined) data.onlineUrl = value.onlineUrl || null;
  if (value.registrationUrl !== undefined) data.registrationUrl = value.registrationUrl || null;
  if (value.verified !== undefined) data.verifiedAt = value.verified ? new Date() : null;
  return data;
}

function serializeSupportingEvent(event) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    organiser: event.organiser,
    startsAt: isoOrNull(event.startsAt),
    venue: event.venue ?? null,
    onlineUrl: event.onlineUrl ?? null,
    registrationUrl: event.registrationUrl ?? null,
    verifiedAt: isoOrNull(event.verifiedAt),
    publishedAt: isoOrNull(event.publishedAt),
    createdAt: isoOrNull(event.createdAt),
    updatedAt: isoOrNull(event.updatedAt),
  };
}

/**
 * GET /api/briefings/supporting/opportunities — list opportunities, newest first.
 */
export async function listOpportunities(_req, res) {
  const opportunities = await prisma.opportunity.findMany({ orderBy: { createdAt: 'desc' } });
  return res.json({ opportunities: opportunities.map(serializeOpportunity) });
}

/** POST /api/briefings/supporting/opportunities — create an opportunity. */
export async function createOpportunity(req, res) {
  const value = await validate(opportunitySchema, req.body);
  const opportunity = await prisma.opportunity.create({ data: opportunityData(value) });
  return res.status(201).json({ opportunity: serializeOpportunity(opportunity) });
}

/** PATCH /api/briefings/supporting/opportunities/:id — update an opportunity. */
export async function updateOpportunity(req, res) {
  const value = await validate(opportunityUpdateSchema, req.body);
  const current = await prisma.opportunity.findUnique({ where: { id: req.params.id } });
  if (!current) throw NotFound('Opportunity not found');

  const opportunity = await prisma.opportunity.update({
    where: { id: current.id },
    data: opportunityData(value),
  });
  return res.json({ opportunity: serializeOpportunity(opportunity) });
}

/** DELETE /api/briefings/supporting/opportunities/:id */
export async function deleteOpportunity(req, res) {
  const current = await prisma.opportunity.findUnique({ where: { id: req.params.id } });
  if (!current) throw NotFound('Opportunity not found');
  await prisma.opportunity.delete({ where: { id: current.id } });
  return res.status(204).send();
}

function opportunityData(value) {
  const data = {};
  if (value.title !== undefined) data.title = value.title;
  if (value.description !== undefined) data.description = value.description;
  if (value.kind !== undefined) data.kind = value.kind;
  if (value.provider !== undefined) data.provider = value.provider || null;
  if (value.deadline !== undefined) data.deadline = value.deadline === null ? null : new Date(value.deadline);
  if (value.url !== undefined) data.url = value.url || null;
  if (value.verified !== undefined) data.verifiedAt = value.verified ? new Date() : null;
  return data;
}

function serializeOpportunity(opportunity) {
  return {
    id: opportunity.id,
    title: opportunity.title,
    description: opportunity.description,
    kind: opportunity.kind,
    provider: opportunity.provider ?? null,
    deadline: isoOrNull(opportunity.deadline),
    url: opportunity.url ?? null,
    verifiedAt: isoOrNull(opportunity.verifiedAt),
    createdAt: isoOrNull(opportunity.createdAt),
    updatedAt: isoOrNull(opportunity.updatedAt),
  };
}

/** GET /api/briefings/supporting/forum-topics — list forum topics. */
export async function listForumTopics(_req, res) {
  const topics = await prisma.forumTopic.findMany({ orderBy: { createdAt: 'desc' } });
  return res.json({ forumTopics: topics.map(serializeForumTopic) });
}

/** POST /api/briefings/supporting/forum-topics — create a forum topic. */
export async function createForumTopic(req, res) {
  const value = await validate(forumTopicSchema, req.body);
  const topic = await prisma.forumTopic.create({ data: forumTopicData(value) });
  return res.status(201).json({ forumTopic: serializeForumTopic(topic) });
}

/** PATCH /api/briefings/supporting/forum-topics/:id — update a forum topic. */
export async function updateForumTopic(req, res) {
  const value = await validate(forumTopicUpdateSchema, req.body);
  const current = await prisma.forumTopic.findUnique({ where: { id: req.params.id } });
  if (!current) throw NotFound('Forum topic not found');

  const topic = await prisma.forumTopic.update({ where: { id: current.id }, data: forumTopicData(value) });
  return res.json({ forumTopic: serializeForumTopic(topic) });
}

/** DELETE /api/briefings/supporting/forum-topics/:id */
export async function deleteForumTopic(req, res) {
  const current = await prisma.forumTopic.findUnique({ where: { id: req.params.id } });
  if (!current) throw NotFound('Forum topic not found');
  await prisma.forumTopic.delete({ where: { id: current.id } });
  return res.status(204).send();
}

function forumTopicData(value) {
  const data = {};
  if (value.title !== undefined) data.title = value.title;
  if (value.prompt !== undefined) data.prompt = value.prompt;
  if (value.scheduledFor !== undefined) {
    data.scheduledFor = value.scheduledFor === null ? null : new Date(value.scheduledFor);
  }
  if (value.publishItemId !== undefined) data.publishItemId = value.publishItemId || null;
  if (value.forumUrl !== undefined) data.forumUrl = value.forumUrl || null;
  return data;
}

function serializeForumTopic(topic) {
  return {
    id: topic.id,
    title: topic.title,
    prompt: topic.prompt,
    scheduledFor: isoOrNull(topic.scheduledFor),
    publishItemId: topic.publishItemId ?? null,
    forumUrl: topic.forumUrl ?? null,
    createdAt: isoOrNull(topic.createdAt),
    updatedAt: isoOrNull(topic.updatedAt),
  };
}

export {
  BRIEFING_STATUSES,
  SECTION_STATES,
  createBriefingSchema,
  updateBriefingSchema,
  listBriefingSchema,
  updateSectionSchema,
  attachItemSchema,
  reorderSchema,
  authorSchema,
  publishBriefingSchema,
  supportingEventSchema,
  opportunitySchema,
  forumTopicSchema,
  serializeBriefing,
  serializeSection,
  serializePublishItemSummary,
};

export async function updatePhoto(req,res) {
  const value=await validate(Joi.object({imageUrl:Joi.string().max(2048).allow(null).required(),imageAlt:Joi.string().trim().max(250).allow(null,''),imageCredit:Joi.string().trim().max(160).allow(null,'')}),req.body);
  if(value.imageUrl && (!mediaUrl(value.imageUrl) || !value.imageAlt))throw BadRequest('Provide an approved photograph and an image description.');
  const section=await requireSection(req.params.id,req.params.functionId);
  const link=section.items.find(item=>item.id===req.params.itemId);
  if(!link)throw NotFound('Story unavailable');
  await prisma.$transaction([
    prisma.briefingSectionItem.update({where:{id:link.id},data:{imageUrl:value.imageUrl,imageAlt:value.imageAlt||null,imageCredit:value.imageCredit||null}}),
    prisma.briefingSection.update({where:{id:section.id},data:{state:'awaiting'}}),
  ]);
  return res.sendStatus(204);
}
