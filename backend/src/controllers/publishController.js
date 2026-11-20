import Joi from 'joi';
import { prisma } from '../utils/prisma.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../utils/AppError.js';
import { projectF7, DEFAULT_TIER } from '../services/novrpulse/project/projectF7.js';

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

const listSchema = Joi.object({
  status: Joi.string().valid(...STATUSES),
  functionId: Joi.number().integer().min(1).max(8),
  tier: Joi.string().valid(...TIERS),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

const projectSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  tier: Joi.string().valid(...TIERS).default(DEFAULT_TIER),
  commit: Joi.boolean().default(false),
});

const editSchema = Joi.object({
  body: Joi.string().min(1).required(),
});

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

function serializeItem(item) {
  return {
    id: item.id,
    eventId: item.eventId,
    functionId: item.functionId,
    contentType: item.contentType,
    tier: item.tier,
    body: item.body,
    templateVersion: item.templateVersion,
    editorId: item.editorId,
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
  const { status, functionId, tier, limit } = await listSchema.validateAsync(req.query, { stripUnknown: true });

  const where = {};
  if (functionId !== undefined) where.functionId = functionId;

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
 * PATCH /api/publish/:id — edit the body of an unpublished item.
 * Updates `body` ONLY: `approvedAt` and `editorId` are never touched (a body
 * edit is not a sign-off). A PUBLISHED item may not be edited in place —
 * publications are immutable and corrected through the corrections path — so
 * this refuses with 409. Draft/approved/rejected items are editable.
 */
export async function editPublishItem(req, res) {
  requireEditorRole(req);

  const { body } = await editSchema.validateAsync(req.body ?? {}, { stripUnknown: true });

  const item = await prisma.publishItem.findUnique({ where: { id: req.params.id } });
  if (!item) throw NotFound('Publish item not found');
  if (item.publishedAt) {
    throw Conflict('Cannot edit a published item — use the corrections path');
  }

  const updated = await prisma.publishItem.update({
    where: { id: item.id },
    data: { body },
  });

  return res.json({ item: serializeItem(updated) });
}

export { listSchema, projectSchema, editSchema, deriveStatus, requireEditorRole, isEditor };
