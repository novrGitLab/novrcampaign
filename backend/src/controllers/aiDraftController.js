import Joi from 'joi';
import { BadRequest, Forbidden, BadGateway, AppError } from '../utils/AppError.js';
import { rewriteEventToDraft, recommendEvents } from '../services/novrpulse/aiDraft.js';
import { NEWS_DERIVED_PILLARS } from '../services/novrpulse/pillarShapes.js';

/**
 * HTTP surface for the NovrPulse AI editorial layer:
 *   - POST /api/publish/ai-draft  — one event → a pillar DRAFT (rewrite)
 *   - POST /api/ai/recommend      — the day's events → section picks (recommend)
 *
 * Identity is ALWAYS the authenticated session (`req.user.id`, set by
 * `requireAuth`) — never a body field. Both routes sit behind `requireAuth`;
 * any authenticated user may draft or request recommendations.
 */

const rewriteSchema = Joi.object({
  eventId: Joi.string().trim().min(1).required(),
  functionId: Joi.number().integer().min(1).max(8).required(),
  // Retry: ask for a FRESH draft over an existing live draft (updates the same
  // item in place) instead of returning the existing one. Default false =
  // today's idempotent behaviour.
  regenerate: Joi.boolean().default(false),
});

const recommendSchema = Joi.object({
  functionIds: Joi.array().items(Joi.number().integer().min(1).max(8)).default(NEWS_DERIVED_PILLARS),
  limit: Joi.number().integer().min(1).max(6).default(4),
});

/** Assert the request carries an authenticated user. */
function requireEditor(req) {
  if (!req.user?.id) {
    throw Forbidden('Authentication required to use the AI editorial layer');
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

/**
 * POST /api/publish/ai-draft — AI-rewrite one event into a pillar draft.
 *
 * Idempotent by default (a live draft is returned unchanged). With
 * `regenerate: true` and a live draft present, a FRESH draft is generated and
 * written over the existing item (same id, no duplicate) with a new ledger row.
 *
 * The copyright/defamation guards WARN (owner decision): a tripped guard still
 * returns 201/200 and lists its code in `warnings` — the draft is saved and the
 * human decides at approval. The genuine failures remain errors.
 *
 * @throws {BadRequest} 400 field-form pillar (AI_DRAFT_NOT_AVAILABLE) / Joi.
 * @throws {AppError}   503 AI_NOT_CONFIGURED.
 */
export async function aiDraft(req, res) {
  requireEditor(req);

  const { eventId, functionId, regenerate } = await validate(rewriteSchema, req.body ?? {});

  const { item, judgementId, existed, regenerated, warnings } = await rewriteEventToDraft({
    eventId,
    functionId,
    editorId: req.user.id,
    regenerate,
  });

  return res.status(existed ? 200 : 201).json({ item, judgementId, existed, regenerated, warnings });
}

/**
 * POST /api/ai/recommend — recommend the day's events per section.
 *
 * @returns {Promise<void>} `{ recommendations: [{ functionId, judgements }] }`.
 * @throws {AppError} 503 AI_NOT_CONFIGURED.
 */
export async function recommend(req, res) {
  requireEditor(req);

  const { functionIds, limit } = await validate(recommendSchema, req.body ?? {});

  try {
    const result = await recommendEvents({ functionIds, limit });
    return res.json(result);
  } catch (err) {
    // The service degrades per-section on a provider hiccup, so anything that
    // still throws is a hard failure — surface it as 502 (provider) rather than
    // a bare 500, unless it is already a typed AppError (e.g. 503 unconfigured).
    if (err instanceof AppError) throw err;
    throw BadGateway(`AI recommendation failed: ${err.message}`);
  }
}

export { rewriteSchema, recommendSchema, requireEditor };
