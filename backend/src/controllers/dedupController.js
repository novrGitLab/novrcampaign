import Joi from 'joi';
import { BadRequest, Forbidden } from '../utils/AppError.js';
import { findCandidatePairs, isConfigured, runDedup } from '../services/novrpulse/dedup.js';

/**
 * Deduplication API (Capability 1) — preview and run the blocking + LLM pair
 * confirmation.
 *
 * Follows the aiJudgement controller conventions: identity comes from the
 * authenticated session (`req.user.id`), the body is validated by Joi, and the
 * repo's `AppError` helpers are used. The run endpoint is DRY-RUN by DEFAULT —
 * a caller must explicitly pass `commit: true` to write `ai_judgement` rows.
 *
 * Wire these handlers in `dedupRoutes.js` behind `requireAuth`.
 */

const runSchema = Joi.object({
  commit: Joi.boolean().default(false),
  since: Joi.date().iso().optional(),
  maxAgeDays: Joi.number().integer().min(1).max(30).default(3),
  limit: Joi.number().integer().min(1).max(100).default(25),
});

const candidatesSchema = Joi.object({
  since: Joi.date().iso().optional(),
  maxAgeDays: Joi.number().integer().min(1).max(30).default(3),
});

/** Assert the request carries an authenticated user (internal editorial action). */
function requireEditorRole(req) {
  if (!req.user?.id) {
    throw Forbidden('Authentication required to run deduplication');
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

function serializePair(pair) {
  return {
    subjectKey: pair.subjectKey,
    a: { id: pair.a?.id ?? null, title: pair.a?.title ?? null },
    b: { id: pair.b?.id ?? null, title: pair.b?.title ?? null },
    decision: pair.decision ?? null,
    confidence: pair.confidence ?? null,
    reason: pair.reason ?? null,
    model: pair.model ?? null,
    error: pair.error ?? null,
  };
}

/**
 * GET /api/dedup/candidates?maxAgeDays=&since= — the deterministic blocking
 * preview. Free, no LLM, writes nothing.
 */
export async function candidates(req, res) {
  requireEditorRole(req);
  const { since, maxAgeDays } = await validate(candidatesSchema, req.query);

  const pairs = await findCandidatePairs({ since, maxAgeDays });

  return res.json({
    candidates: pairs.length,
    configured: isConfigured(),
    pairs: pairs.map(serializePair),
  });
}

/**
 * POST /api/dedup/run — block → confirm (bounded) → record.
 * DRY-RUN by default: pass `{ "commit": true }` to write `ai_judgement` rows.
 */
export async function runDedupRequest(req, res) {
  requireEditorRole(req);
  const { commit, since, maxAgeDays, limit } = await validate(runSchema, req.body ?? {});

  const dryRun = !commit;
  if (!dryRun && !isConfigured()) {
    throw BadRequest('No AI provider is configured; cannot record dedup judgements');
  }

  const result = await runDedup({ dryRun, since, maxAgeDays, limit });

  return res.json({
    dryRun: result.dryRun,
    candidates: result.candidates,
    processed: result.processed,
    pairs: result.pairs.map(serializePair),
  });
}

export { runSchema, candidatesSchema, serializePair, requireEditorRole };
