import Joi from 'joi';
import { BadRequest, Forbidden } from '../utils/AppError.js';
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
});

const recommendSchema = Joi.object({
  functionIds: Joi.array().items(Joi.number().integer().min(1).max(8)).default(NEWS_DERIVED_PILLARS),
  limit: Joi.number().integer().min(1).max(3).default(2),
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
 * @throws {BadRequest} 400 field-form pillar (AI_DRAFT_NOT_AVAILABLE) / Joi.
 * @throws {AppError}   503 AI_NOT_CONFIGURED, 422 copyright/defamation guards.
 */
export async function aiDraft(req, res) {
  requireEditor(req);

  const { eventId, functionId } = await validate(rewriteSchema, req.body ?? {});

  const { item, judgementId, existed } = await rewriteEventToDraft({
    eventId,
    functionId,
    editorId: req.user.id,
  });

  return res.status(existed ? 200 : 201).json({ item, judgementId, existed });
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

  const result = await recommendEvents({ functionIds, limit });

  return res.json(result);
}

export { rewriteSchema, recommendSchema, requireEditor };
