import Joi from 'joi';
import { BadRequest, Forbidden, NotFound } from '../utils/AppError.js';
import {
  JUDGEMENT_KINDS,
  JUDGEMENT_OUTCOMES,
  MIN_REASON_LENGTH,
  acceptJudgement,
  listJudgements,
  rejectJudgement,
} from '../services/novrpulse/judgements.js';
import { prisma } from '../utils/prisma.js';

/**
 * Review API for the AI judgement ledger.
 *
 * Identity is ALWAYS derived from the authenticated session (`req.user.id`, set
 * by `requireAuth`) — never from the request body. The body is validated for
 * `reason` only; `outcome` and `reviewerId` are server-owned.
 *
 * Follows the publishController conventions: Joi schemas validated into the
 * repo's `BadRequest`, `requireEditorRole` to assert an authenticated actor, and
 * `NotFound`/`Conflict` from the shared AppError helpers.
 */

const listSchema = Joi.object({
  kind: Joi.string().valid(...JUDGEMENT_KINDS),
  // Default view is the human review queue.
  outcome: Joi.string().valid(...JUDGEMENT_OUTCOMES).default('pending'),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

// A rejection reason is mandatory and bounded (mirrors MIN_REASON_LENGTH in the
// service, which is the authoritative guard when the service is called directly).
const rejectSchema = Joi.object({
  reason: Joi.string().trim().min(MIN_REASON_LENGTH).max(2000).required(),
});

/**
 * Assert the request carries an authenticated user. The judgement review loop
 * is an internal editorial action; a request with no session is refused.
 */
function requireEditorRole(req) {
  if (!req.user?.id) {
    throw Forbidden('Authentication required to review AI judgements');
  }
}

/** Validate with a Joi schema, mapping a Joi failure to the repo's 400. */
async function validate(schema, value, options = { stripUnknown: true }) {
  try {
    return await schema.validateAsync(value, options);
  } catch (err) {
    if (err.isJoi) throw BadRequest(err.message);
    throw err;
  }
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

function serializeJudgement(row) {
  return {
    id: row.id,
    kind: row.kind,
    decision: row.decision,
    confidence: row.confidence,
    rationale: row.rationale,
    outcome: row.outcome,
    reason: row.reason,
    createdAt: toIso(row.createdAt),
    reviewedAt: toIso(row.reviewedAt),
    // Top-level event link — the wizard builds its picks from these. The
    // subject block keeps the same fields for older consumers.
    eventId: row.eventId ?? null,
    eventTitle: row.eventTitle ?? row.subject?.eventTitle ?? null,
    subject: row.subject ?? {
      eventTitle: null,
      counterpartTitle: null,
      publishItemId: row.publishItemId ?? null,
      subjectKey: row.subjectKey,
    },
    scenario: row.scenario,
    detail: row.detail,
  };
}

/**
 * GET /api/ai-judgements?kind=&outcome=&limit= — the review queue.
 * Defaults to `outcome='pending'`. Returns `{ judgements: [...] }` with the
 * frozen `scenario`/`detail` so the UI can show what the AI judged.
 */
export async function list(req, res) {
  const { kind, outcome, limit } = await validate(listSchema, req.query);

  const judgements = await listJudgements({ kind, outcome, limit });

  return res.json({ judgements: judgements.map(serializeJudgement) });
}

/**
 * POST /api/ai-judgements/:id/accept — accept a pending judgement.
 * Identity is the SESSION user. Unknown id → 404; already adjudicated → 409.
 */
export async function accept(req, res) {
  requireEditorRole(req);

  const existing = await prisma.aiJudgement.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!existing) throw NotFound('Judgement not found');

  const updated = await acceptJudgement(req.params.id, req.user.id);

  return res.json({ judgement: serializeJudgement(updated) });
}

/**
 * POST /api/ai-judgements/:id/reject — reject a pending judgement with a reason.
 * `reason` is required (min length enforced by Joi and the service). Unknown id
 * → 404; already adjudicated → 409.
 */
export async function reject(req, res) {
  requireEditorRole(req);

  const { reason } = await validate(rejectSchema, req.body ?? {});

  const existing = await prisma.aiJudgement.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!existing) throw NotFound('Judgement not found');

  const updated = await rejectJudgement(req.params.id, req.user.id, reason);

  return res.json({ judgement: serializeJudgement(updated) });
}

export { listSchema, rejectSchema, serializeJudgement, requireEditorRole };
