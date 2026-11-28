import { normalizePhotos, syncEditionPhotos } from '../services/newsroomPhoto.js';
import Joi from 'joi';
import { prisma } from '../utils/prisma.js';
import { AppError, BadRequest, Conflict, Forbidden, NotFound } from '../utils/AppError.js';
import { projectF7, DEFAULT_TIER } from '../services/novrpulse/project/projectF7.js';
import { assertPublicArrestNameless, assertLicence, GateError } from '../services/novrpulse/project/gates.js';
import { findPersonLikeNames, knownNonPersonTokens } from '../services/novrpulse/project/templates/f7.js';

/**
 * Editorial workflow API for NovrPulse publish items (F7 projection slice).
 *
 * Authorization model (server-side, never client-supplied):
 *  - Identity is always derived from the authenticated session (`req.user.id`,
 *    set by `requireAuth`). The request body is never trusted for `editorId`,
 *    role, or status.
 *  - Any AUTHENTICATED user may act on publish items. Owner decision
 *    2026-11-18: the editorial team is internal, so the earlier ADMIN-only
 *    gate was relaxed — `SENDER`/`VIEWER` may approve/withdraw/reject/edit and
 *    project, and list-tier masking no longer restricts them. See
 *    `requireEditorRole`/`isEditor` below.
 *
 * Two legal controls remain enforced and are NOT relaxed here:
 *  1. Anything that reaches the PUBLIC output must use the public tier only.
 *  2. The pre-conviction ("alleged") word guard lives in `f7.js`/`gates.js`
 *     and stays as-is; it is not weakened by this controller.
 */

const STATUSES = ['draft', 'approved', 'rejected', 'published', 'withdrawn'];
const TIERS = ['public', 'paid'];
// The two publish-item content types (owner decision 2026-11-19, Option C).
const CONTENT_TYPES = ['briefing', 'urgent_alert'];

const listSchema = Joi.object({
  status: Joi.string().valid(...STATUSES),
  functionId: Joi.number().integer().min(1).max(10),
  tier: Joi.string().valid(...TIERS),
  contentType: Joi.string().valid(...CONTENT_TYPES),
  // Optional event scoping (Editorial Canvas "prior work" panel): show only the
  // items already created from a given inbox event.
  eventId: Joi.string().trim().min(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  // Briefing Desk "Attach existing" picker: restrict to items usable in a
  // briefing — manually-authored items, plus items whose linked inbox event was
  // Accepted. See USABLE_FOR_DESK below for the exact rule.
  usableForDesk: Joi.boolean().truthy('true').falsy('false').default(false),
});

/**
 * Eligibility rule for the Briefing Desk "Attach existing" picker.
 *
 * The Desk attaches `publish_item` rows, while Accept/Dismiss sets
 * `np_event.reviewStatus` — two different tables. The linkage:
 *   - A manually-authored briefing (no `eventId`) is always usable: it does not
 *     come from the inbox and was written by an editor on purpose.
 *   - An item bound to an inbox event (`eventId` set) is usable only when that
 *     event's `reviewStatus` is 'accepted' ("use this today"). A 'new'
 *     (un-triaged) or 'dismissed' event's item must NOT be offered.
 *
 * This keeps a single source of triage truth (the inbox Accept) without adding
 * a third button: Accept is the gate, the picker reflects it.
 */
const USABLE_FOR_DESK = {
  OR: [
    { eventId: null },
    { event: { reviewStatus: 'accepted' } },
  ],
};

const projectSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  tier: Joi.string().valid(...TIERS).default(DEFAULT_TIER),
  commit: Joi.boolean().default(false),
});

const editSchema = Joi.object({
  photos: Joi.array().max(12),
  body: Joi.string().min(1),
  // Pillar 01: the regulatory-impact field MUST be saved before approval, so it
  // is editable here (separate column, never composed into `body`).
  regulatoryImpact: Joi.string().trim().max(4000).allow('', null),
  // Pillar 05: the event date/time, saved before approval. ISO date or datetime.
  eventDate: Joi.date().iso().allow(null),
});

// The Editorial Canvas template tag for an item seeded FROM an inbox event.
const CANVAS_TEMPLATE_VERSION = 'canvas@1.0.0';

// How many characters of the raw article `body` seed the draft when the event
// has neither an editor-written `summary` nor an `excerpt`.
const SEED_BODY_LENGTH = 200;

const fromEventSchema = Joi.object({
  // `np_event.id` is a uuid, but the repo stores ids as plain strings in tests;
  // a non-empty string is required, matching how :id params are accepted elsewhere.
  eventId: Joi.string().trim().min(1).required(),
  functionId: Joi.number().integer().min(1).max(10).required(),
});

// The template tag for a MANUALLY authored piece (no source event). Distinct
// from canvas@1.0.0 (from-event) so provenance is legible per row.
const MANUAL_TEMPLATE_VERSION = 'manual@2.0.0';

/**
 * POST /api/publish — create a MANUALLY written piece (no source event).
 *
 * Used by the minimal "Today" desk's free-write mode ("✎ Write your own"): the
 * editor picks any of the eight pillars and types a headline + body directly,
 * optionally citing a reference link. Unlike the from-event path there is no
 * wire event to seed from, so the body is COMPOSED from what the editor typed.
 *
 * Body contract (matches the seed/tray-preview convention, see `seedCanvasBody`
 * and `parseSeedBody`): `"<headline>\n\n<text>"`, with a final
 * `Reference: <link>` line when a reference link is supplied.
 */
const manualPublishSchema = Joi.object({
  photos: Joi.array().max(12),
  functionId: Joi.number().integer().min(1).max(10).required(),
  headline: Joi.string().trim().min(1).max(200).required(),
  text: Joi.string().trim().min(1).max(20000).required(),
  referenceLink: Joi.string()
    .trim()
    .uri({ scheme: ['http', 'https'] })
    .max(2000),
});

/**
 * Compose the stored body for a manual piece from the editor's typed fields.
 * Deterministic and LLM-free; the shape is the same "<headline>\n\n<text>"
 * contract the tray preview and the from-event seed already produce.
 *
 * @param {{headline:string, text:string, referenceLink?:string}} input
 * @returns {string}
 */
function composeManualBody({ headline, text, referenceLink }) {
  const head = String(headline ?? '').trim();
  const body = String(text ?? '').trim();
  const link = String(referenceLink ?? '').trim();
  const parts = [head, body];
  if (link) parts.push(`Reference: ${link}`);
  return parts.filter(Boolean).join('\n\n');
}

/**
 * DEFAMATION GATE for a manual public-tier F7 item (owner spec).
 *
 * A manual piece has no source event and no entities, so the entity-based branch
 * of `assertPublicArrestNameless` has nothing to match. The LEXICAL detector
 * still applies: a person-like name typed into a public Breaking-News piece is
 * refused. We reuse `findPersonLikeNames` from the F7 template with the same
 * trusted non-person token set the F7 renderer uses (source-registry names,
 * trusted acronyms, geography, function words) via `knownNonPersonTokens({})`
 * — the event argument is empty because there is no event, so only the trusted
 * code-derived allow-lists apply. FAIL-CLOSED: any surviving person-like token
 * denies the item.
 *
 * @param {number} functionId
 * @param {string} tier
 * @param {string} body
 * @throws {AppError} 422 named_individual_in_public_arrest
 */
function assertManualNameless(functionId, tier, body) {
  if (functionId !== 7 || tier !== 'public') return;
  // No event/entities exist on a manual piece, so the entity branch is a no-op
  // by construction; only the lexical scan runs.
  const known = knownNonPersonTokens({});
  const personLike = findPersonLikeNames(String(body ?? ''), known);
  if (personLike.length > 0) {
    throw unprocessable(
      'named_individual_in_public_arrest',
      'Manual pieces must not name individuals — this is a public-tier Breaking News item.',
      { leaked: personLike, reason: 'person_like_token' },
    );
  }
}

/**
 * POST /api/publish — create a manually written publish item.
 *
 * Authorization: an authenticated session is required (route sits behind
 * `requireAuth`); identity is ALWAYS the session user (`req.user.id`), never the
 * body. The item is created as a DRAFT for the chosen pillar with
 * `eventId: null` and `editorId` from the session.
 *
 * Licence gate: N/A — a manual piece has no source, so there is no licence to
 * check. (The F7 defamation gate still applies; see `assertManualNameless`.)
 *
 * @throws {BadRequest} when validation fails.
 * @throws {AppError} 422 named_individual_in_public_arrest when fn7 names a person.
 */
export async function createManualItem(req, res) {
  requireEditorRole(req);

  const { functionId, headline, text, referenceLink, photos } = await validate(
    manualPublishSchema,
    req.body ?? {},
  );

  const tier = 'public';
  const body = composeManualBody({ headline, text, referenceLink });

  // Defamation control (fail-closed). Runs BEFORE the insert; a denial writes
  // nothing.
  assertManualNameless(functionId, tier, body);

  const item = await prisma.publishItem.create({
    data: {
      functionId,
      eventId: null,
      ...(photos && { photos: normalizePhotos(photos) }),
      contentType: 'briefing',
      tier,
      templateVersion: MANUAL_TEMPLATE_VERSION,
      editorId: req.user.id,
      body,
      // Draft: the editor signs off separately (never auto-approved).
      approvedAt: null,
    },
  });

  return res.status(201).json({ item: serializeItem(item) });
}

/**
 * Build the starter draft body for an item created FROM an event.
 *
 * Deterministic and LLM-free (AI drafting is a later hook). Shape:
 *   <headline>
 *
 *   <starting paragraph>
 *
 * The headline is the event title; the paragraph is the event's own `summary`
 * when present, else the first `SEED_BODY_LENGTH` chars of the raw article body
 * (whitespace-collapsed). The seed carries no name control of its own — the
 * defamation gate below is the control, run against this exact seed.
 *
 * @param {{title?:string, summary?:string, body?:string}} event
 * @returns {string}
 */
function seedCanvasBody(event) {
  const headline = String(event?.title ?? '').trim();
  const summary = String(event?.summary ?? '').trim();

  let paragraph = summary;
  if (!paragraph) {
    const raw = String(event?.body ?? '').replace(/\s+/g, ' ').trim();
    paragraph = raw.length > SEED_BODY_LENGTH ? raw.slice(0, SEED_BODY_LENGTH).trimEnd() : raw;
  }

  return [headline, paragraph].filter(Boolean).join('\n\n');
}

/**
 * Check the request carries an authenticated user.
 *
 * Owner decision 2026-11-18 (relaxed from ADMIN-only): the editorial team is
 * internal, so ANY authenticated user may approve/withdraw/reject/edit and
 * project. Authorization is still server-side only (security-standards:
 * "authorize server-side on every resource; never trust client-supplied
 * ids/roles"). Identity is read from the session (`req.user.id`, set by
 * `requireAuth`), never the body; a request with no session is rejected.
 */
function requireEditorRole(req) {
  if (!req.user?.id) {
    throw Forbidden('Authentication required to act on publish items');
  }
}

/** Whether the request carries an authenticated user (see requireEditorRole). */
function isEditor(req) {
  return Boolean(req.user?.id);
}

/**
 * Validate with a Joi schema, converting a Joi failure into the repo's
 * `BadRequest` (400). A raw Joi error carries no HTTP status and the shared
 * error handler would otherwise turn it into a 500.
 */
async function validate(schema, value, options = { stripUnknown: true }) {
  try {
    return await schema.validateAsync(value, options);
  } catch (err) {
    if (err.isJoi) throw BadRequest(err.message);
    throw err;
  }
}

function serializeItem(item) {
  return {
    id: item.id,
    eventId: item.eventId,
    functionId: item.functionId,
    contentType: item.contentType,
    tier: item.tier,
    body: item.body,
    regulatoryImpact: item.regulatoryImpact ?? null,
    eventDate: item.eventDate instanceof Date ? item.eventDate.toISOString() : item.eventDate ?? null,
    templateVersion: item.templateVersion,
    editorId: item.editorId,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt ?? null,
    approvedAt: item.approvedAt instanceof Date ? item.approvedAt.toISOString() : item.approvedAt,
    rejectedAt: item.rejectedAt instanceof Date ? item.rejectedAt.toISOString() : item.rejectedAt ?? null,
    publishedAt: item.publishedAt instanceof Date ? item.publishedAt.toISOString() : item.publishedAt ?? null,
    withdrawnAt: item.withdrawnAt instanceof Date ? item.withdrawnAt.toISOString() : item.withdrawnAt ?? null,
    status: deriveStatus(item),
  };
}

/**
 * Derive a single status label from the timestamp columns.
 * Precedence (documented, owner decision 2026-11-18): a withdrawal supersedes
 * everything; a live publication outranks a later rejection; a rejection
 * outranks an earlier approval; otherwise the item is a draft.
 *   withdrawn > published > rejected > approved > draft
 */
function deriveStatus(item) {
  if (item.withdrawnAt) return 'withdrawn';
  if (item.publishedAt) return 'published';
  if (item.rejectedAt) return 'rejected';
  if (item.approvedAt) return 'approved';
  return 'draft';
}

/**
 * GET /api/publish — list publish items.
 * Default view: items awaiting review (draft + approved, not yet published,
 * not rejected).
 *
 * Authorization: owner decision 2026-11-18 relaxed the previous "non-editor is
 * restricted to tier='public'" masking — the team is internal, so any
 * authenticated user may request any tier. A missing session (direct unit call)
 * still fails closed to `tier='public'`.
 */
export async function listPublishItems(req, res) {
  const { status, functionId, tier, contentType, eventId, limit, usableForDesk } = await validate(listSchema, req.query);

  const where = {};
  if (functionId !== undefined) where.functionId = functionId;
  if (contentType !== undefined) where.contentType = contentType;
  if (eventId !== undefined) where.eventId = eventId;

  // Briefing Desk picker: AND the eligibility rule onto whatever the status
  // bucket selects, so only usable items are offered.
  if (usableForDesk) {
    where.AND = [...(where.AND ?? []), USABLE_FOR_DESK];
  }

  if (isEditor(req)) {
    if (tier !== undefined) where.tier = tier;
  } else {
    // Fail-closed: an unauthenticated direct call only ever sees the public tier.
    where.tier = 'public';
  }

  if (status) {
    if (status === 'draft') where.publishedAt = null;
    else if (status === 'published') where.publishedAt = { not: null };
    else if (status === 'withdrawn') where.withdrawnAt = { not: null };
    else if (status === 'rejected') where.rejectedAt = { not: null };
    else if (status === 'approved') {
      where.publishedAt = null;
      where.withdrawnAt = null;
    }
  } else {
    // Sensible default: awaiting review — not published, not withdrawn, and not
    // rejected (a rejected item is a review outcome, not an open task).
    where.publishedAt = null;
    where.withdrawnAt = null;
    where.rejectedAt = null;
  }

  const items = await prisma.publishItem.findMany({
    where,
    orderBy: { approvedAt: 'desc' },
    take: limit,
  });

  return res.json({ items: items.map(serializeItem) });
}

/**
 * POST /api/publish/f7 — project eligible F7 events into draft publish items.
 * Dry-run by default (commit:false), matching the collect/understand scripts.
 * Never sets `publishedAt`; arrest items await explicit human approval.
 *
 * Authorization (defect D2): projecting writes `PublishItem` rows, so it is an
 * editorial action and requires an authorised editor role server-side — a
 * `requireAuth`-only guard let ANY authenticated user trigger it. The acting
 * operator is always the session user (`req.user.id`), never the body.
 */
export async function projectF7Items(req, res) {
  requireEditorRole(req);

  const { limit, tier, commit } = await projectSchema.validateAsync(req.body ?? {}, { stripUnknown: true });

  const result = await projectF7({ limit, tier, editorId: req.user.id, commit });

  return res.status(commit ? 201 : 200).json({
    mode: commit ? 'commit' : 'dry-run',
    tier,
    candidates: result.candidates,
    created: result.created,
    refused: result.refused,
    results: result.results,
    note: 'F7 arrest items require explicit human approval and are never auto-published.',
  });
}

/**
 * Find an existing LIVE working item for (eventId, functionId).
 *
 * "Live" is a draft/approved item — one that is neither withdrawn, published,
 * nor rejected. Used by both the from-event path and the AI-draft path so a
 * repeat call for the same (event, function) reuses the existing draft instead
 * of creating a duplicate. A terminal outcome (withdrawn/published/rejected)
 * does NOT block a fresh draft.
 *
 * @param {string} eventId
 * @param {number} functionId
 * @returns {Promise<object|null>}
 */
export function findLiveItem(eventId, functionId) {
  return prisma.publishItem.findFirst({
    where: { eventId, functionId, withdrawnAt: null, publishedAt: null, rejectedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Create a draft publish item bound to an event, with its primary pivot link.
 *
 * The single creation path shared by the from-event endpoint and the AI-draft
 * service: same fields (contentType 'briefing', tier 'public', eventId set,
 * a DRAFT with `approvedAt: null`), the pivot row written in the same
 * transaction, and `editorId` supplied by the CALLER from the session.
 *
 * The caller owns every gate (licence, defamation, copyright). This helper
 * writes; it does not decide publishability.
 *
 * @param {object} input
 * @param {string} input.eventId
 * @param {number} input.functionId
 * @param {string} input.body
 * @param {string} input.editorId
 * @param {string} input.templateVersion
 * @returns {Promise<object>} the created PublishItem row.
 */
export async function createEventBoundDraft({ eventId, functionId, body, editorId, templateVersion }) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.publishItem.create({
      data: {
        eventId,
        functionId,
        contentType: 'briefing',
        tier: 'public',
        body,
        templateVersion,
        editorId,
        // Draft: the editor writes and signs off separately (never auto-approved).
        approvedAt: null,
      },
    });
    // The general many-to-many linkage. The schema key is `position` (there is
    // no `role` column); the single primary event of an event-bound item is 0.
    await tx.publishItemEvent.create({
      data: { publishItemId: created.id, eventId, position: 0 },
    });
    return created;
  });
}

/**
 * POST /api/publish/from-event — create a writable editorial item FROM an
 * accepted inbox event for a chosen pillar (the Editorial Canvas entry point).
 *
 * This is NOT the Briefing Desk author path: the item is created standalone
 * (not attached to any briefing), seeded deterministically from the event, and
 * left as a DRAFT (`approvedAt: null`) for the editor to write and sign off.
 * The acting editor is always the session user (`req.user.id`), never the body.
 *
 * DEFAMATION CONTROL (the critical invariant): for the public-arrest path this
 * MUST run the same fail-closed gate the projection uses. We call
 * `assertPublicArrestNameless(event, functionId, tier, body, entities)` and
 * `assertLicence(...)` BEFORE the insert — the arrest-name gate is the control
 * that stops a named individual reaching a public item. A denial is a 4xx and
 * nothing is written; the path is never bypassed.
 *
 * IDEMPOTENCY (owner spec 2026-11-24): calling this twice for the same
 * (eventId, functionId) must NOT create a duplicate draft. If a LIVE working
 * item already exists for that pair it is returned with `200 { item, existed:
 * true }` (no write). "Live" is a draft/approved item — one that is neither
 * withdrawn, published, nor rejected. A withdrawn/published/rejected item does
 * NOT block a fresh draft: the editor may legitimately start again after
 * withdrawing. A DIFFERENT functionId is a different item and is always created.
 *
 * @throws {NotFound}  when the event does not exist.
 * @throws {BadRequest} when functionId is out of range (Joi) or the gate denies.
 */
export async function createItemFromEvent(req, res) {
  requireEditorRole(req);

  const { eventId, functionId } = await validate(fromEventSchema, req.body ?? {});

  // Idempotency: an existing LIVE working item for this (event, function) is
  // returned as-is (200, existed:true) rather than duplicated. Withdrawn,
  // published, and rejected items are terminal outcomes, so they do not block a
  // new draft — only a live draft/approved item does. Checked before any gate
  // work, so a repeat call is cheap and side-effect-free.
  const existing = await findLiveItem(eventId, functionId);
  if (existing) {
    return res.status(200).json({ item: serializeItem(existing), existed: true });
  }

  // Load the event with the prose fields the gate scans (summary/whatItMeans/
  // title/body) and its sources (licence) + entities (person names). The raw
  // `body` is needed so the gate can catch a name smuggled into the article text.
  const row = await prisma.npEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      summary: true,
      whatItMeans: true,
      body: true,
      canonicalUrl: true,
      region: true,
      eventType: true,
      functions: true,
      sources: {
        orderBy: { extractedAt: 'asc' },
        select: {
          rawDocument: {
            select: {
              url: true,
              source: { select: { name: true, licence: true, licenceStatus: true } },
            },
          },
        },
      },
      entities: { select: { role: true, entity: { select: { type: true, canonicalName: true } } } },
    },
  });
  if (!row) throw NotFound('Pulse event not found');

  const tier = 'public';
  const body = seedCanvasBody(row);

  const entities = (row.entities ?? []).map((e) => ({
    type: e.entity?.type,
    name: e.entity?.canonicalName,
    role: e.role,
  }));
  const licenceStatuses = (row.sources ?? [])
    .map((s) => s.rawDocument?.source?.licenceStatus)
    .filter(Boolean);

  // Reuse the shared gates. `assertLicence` blocks a denied-licence event for
  // every tier; `assertPublicArrestNameless` is the defamation control for the
  // F7/public path (it is a no-op for every other pillar/tier combination and
  // for non-arrest items), matching projectF7's creation-time gate exactly.
  try {
    assertLicence({ licenceStatuses });
    assertPublicArrestNameless(row, functionId, tier, body, entities);
  } catch (err) {
    if (err instanceof GateError) {
      throw BadRequest(err.message, { code: err.code, ...err.details });
    }
    throw err;
  }

  const item = await createEventBoundDraft({
    eventId: row.id,
    functionId,
    body,
    editorId: req.user.id,
    templateVersion: CANVAS_TEMPLATE_VERSION,
  });

  return res.status(201).json({ item: serializeItem(item), existed: false });
}

/**
 * The 7-day notice window for pillar 05 events (owner spec 2026-11-24).
 * "Events are published 7 or more days ahead" — an event whose date is earlier
 * than now + 7 days may not be approved.
 */
const EVENT_NOTICE_DAYS = 7;

/**
 * 422 with a machine-readable `code`. `AppError.Unprocessable` carries a status
 * but no code, and the shared errorHandler only emits `error.code` when the
 * thrown error has one, so build the AppError directly.
 *
 * @param {string} code
 * @param {string} message
 * @param {object} [details]
 * @returns {AppError}
 */
function unprocessable(code, message, details) {
  return new AppError(422, message, details, code);
}

/**
 * Per-pillar approval requirements (owner spec 2026-11-24). Called at the TOP of
 * `approvePublishItem`, BEFORE `approvedAt` is written, so a failing item is
 * never signed off. Deterministic and clock-only (no I/O). Function-specific:
 *
 *   * 01 Regulatory Impact — `regulatoryImpact` must be non-empty (trimmed).
 *   * 05 Events — `eventDate` must exist and be at least 7 days ahead.
 *   * any other pillar — no new requirement (pass-through).
 *
 * Existing items authored before these fields existed are still DRAFTABLE; this
 * gate only blocks APPROVAL, so old 01/05 drafts are not broken, they just need
 * the missing field completed before sign-off.
 *
 * @param {object} item  A stored PublishItem row.
 * @throws {AppError} 422 REGULATORY_IMPACT_REQUIRED / EVENT_DATE_REQUIRED /
 *                    EVENT_NOTICE_TOO_SHORT.
 */
export function assertSectionRequirements(item) {
  if (item.functionId === 1) {
    const value = String(item.regulatoryImpact ?? '').trim();
    if (!value) {
      throw unprocessable(
        'REGULATORY_IMPACT_REQUIRED',
        'Complete the regulatory-impact field before approving — it must state which laws or regulations this affects and what that means for the reader\'s business.',
      );
    }
    return;
  }

  if (item.functionId === 5) {
    if (!item.eventDate) {
      throw unprocessable('EVENT_DATE_REQUIRED', 'Complete the event date before approving.');
    }
    const eventDate = item.eventDate instanceof Date ? item.eventDate : new Date(item.eventDate);
    const earliest = new Date(Date.now() + EVENT_NOTICE_DAYS * 24 * 60 * 60 * 1000);
    if (eventDate.getTime() < earliest.getTime()) {
      throw unprocessable('EVENT_NOTICE_TOO_SHORT', 'Events must be at least 7 days ahead.');
    }
  }
}

/**
 * POST /api/publish/:id/approve — human sign-off.
 * Sets `approvedAt` and `editorId` from the SESSION ONLY (`req.user.id`).
 * The projection job never publishes; this endpoint (or a later publish step)
 * is the only path to `publishedAt`, and it requires an authorised role.
 */
export async function approvePublishItem(req, res) {
  requireEditorRole(req);

  const item = await prisma.publishItem.findUnique({ where: { id: req.params.id } });
  if (!item) throw NotFound('Publish item not found');
  if (item.withdrawnAt) throw BadRequest('Cannot approve a withdrawn item');

  // Per-pillar requirements BEFORE any write (owner spec 2026-11-24): a 01 item
  // needs its regulatory-impact field, a 05 event needs a date ≥ 7 days ahead.
  assertSectionRequirements(item);

  const updated = await prisma.publishItem.update({
    where: { id: item.id },
    data: { approvedAt: new Date(), editorId: req.user.id },
  });

  return res.json({ item: serializeItem(updated) });
}

/**
 * POST /api/publish/:id/withdraw — pull an item from publication.
 * Sets `withdrawnAt`; identity is recorded as the acting editor from the session.
 */
export async function withdrawPublishItem(req, res) {
  requireEditorRole(req);

  const item = await prisma.publishItem.findUnique({ where: { id: req.params.id } });
  if (!item) throw NotFound('Publish item not found');

  const updated = await prisma.publishItem.update({
    where: { id: item.id },
    data: { withdrawnAt: new Date(), editorId: req.user.id },
  });

  return res.json({ item: serializeItem(updated) });
}

/**
 * POST /api/publish/:id/reject — human rejection of a draft/approved item.
 * Sets `rejectedAt` and records the acting editor from the session. A PUBLISHED
 * item may not be rejected in place: a live publication must go through the
 * corrections path (never a silent edit/removal), so this refuses with 409.
 */
export async function rejectPublishItem(req, res) {
  requireEditorRole(req);

  const item = await prisma.publishItem.findUnique({ where: { id: req.params.id } });
  if (!item) throw NotFound('Publish item not found');
  if (item.publishedAt) {
    throw Conflict('Cannot reject a published item — use the corrections path');
  }

  const updated = await prisma.publishItem.update({
    where: { id: item.id },
    data: { rejectedAt: new Date(), editorId: req.user.id },
  });

  return res.json({ item: serializeItem(updated) });
}

/**
 * PATCH /api/publish/:id — edit the body and/or the per-pillar fields of an
 * unpublished item.
 *
 * Updates `body` and, when supplied, `regulatoryImpact` (01) and `eventDate`
 * (05). Only PROVIDED fields are written (an omitted field is left untouched).
 * `approvedAt` and `editorId` are never touched (an edit is not a sign-off). A
 * PUBLISHED item may not be edited in place — publications are immutable and
 * corrected through the corrections path — so this refuses with 409. Draft/
 * approved/rejected items are editable.
 */
export async function editPublishItem(req, res) {
  requireEditorRole(req);

  const { body, regulatoryImpact, eventDate, photos } = await validate(editSchema, req.body ?? {});

  const item = await prisma.publishItem.findUnique({ where: { id: req.params.id }, include:{sectionItems:{select:{section:{select:{id:true,briefing:{select:{publishedAt:true,sendingAt:true}}}}}}} });
  if (!item) throw NotFound('Publish item not found');
  if (item.publishedAt) {
    throw Conflict('Cannot edit a published item — use the corrections path');
  }

  // Persist ONLY what was provided; an explicit null clears the field, an
  // omitted field is left as-is.
  const data = {};
  if (photos !== undefined) data.photos = normalizePhotos(photos);
  if (body !== undefined) data.body = body;
  if (regulatoryImpact !== undefined) data.regulatoryImpact = regulatoryImpact === '' ? null : regulatoryImpact;
  if (eventDate !== undefined) data.eventDate = eventDate ?? null;

  if (Object.keys(data).length === 0) {
    throw BadRequest('Provide at least one field to update (body, regulatoryImpact, or eventDate)');
  }

  const sections=(item.sectionItems ?? []).map(link=>link.section);
  if(sections.some(section=>section.briefing.publishedAt || section.briefing.sendingAt)) throw Conflict('This story belongs to a closed edition.');
  if (data.photos) {
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.publishItem.update({ where: { id: item.id, publishedAt: null }, data });
      if (item.eventId)
        await tx.npEvent.update({
          where: { id: item.eventId },
          data: { photos: data.photos, articleVersion: { increment: 1 } },
        });
      await syncEditionPhotos(tx, item.eventId ? { eventId: item.eventId } : { id: item.id }, data.photos);
      return saved;
    });
    return res.json({ item: serializeItem(updated) });
  }
  const save=prisma.publishItem.update({where:{id:item.id},data});
  const updated=sections.length ? (await prisma.$transaction([save, prisma.briefingSection.updateMany({where:{id:{in:sections.map(section=>section.id)}},data:{state:'awaiting'}})]))[0] : await save;
  return res.json({ item: serializeItem(updated) });
}

export {
  listSchema, projectSchema, editSchema, fromEventSchema, manualPublishSchema,
  deriveStatus, requireEditorRole, isEditor, seedCanvasBody, composeManualBody, assertManualNameless,
  serializeItem, unprocessable, CANVAS_TEMPLATE_VERSION,
};
