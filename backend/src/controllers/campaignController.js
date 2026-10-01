import Joi from 'joi';
import { BadRequest, NotFound } from '../utils/AppError.js';
import * as plunk from '../services/plunkService.js';
import { validateCampaignInput } from '../services/emailService.js';

const createSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  subject: Joi.string().min(1).max(300).required(),
  body: Joi.string().min(1).required(),
  type: Joi.string().valid('MARKETING', 'TRANSACTIONAL', 'HEADLESS').default('MARKETING'),
  audienceType: Joi.string().valid('ALL', 'SEGMENT', 'FILTERED').default('ALL'),
  segmentId: Joi.string().uuid().optional(),
});

const scheduleSchema = Joi.object({
  scheduledFor: Joi.string().isoDate().required(),
});

/**
 * GET /api/campaigns
 */
export async function getCampaigns(_req, res) {
  const result = await plunk.getCampaigns();
  const campaigns = Array.isArray(result) ? result : (result?.data ?? result?.campaigns ?? []);
  return res.json({ campaigns });
}

/**
 * GET /api/campaigns/:id
 */
export async function getCampaign(req, res) {
  const campaign = await plunk.getCampaign(req.params.id);
  if (!campaign) throw NotFound('Campaign not found');
  return res.json({ campaign });
}

/**
 * POST /api/campaigns — created as DRAFT in Plunk
 */
export async function createCampaign(req, res) {
  const value = await createSchema.validateAsync(req.body, { stripUnknown: true });
  const validated = validateCampaignInput(value);

  if (validated.audienceType === 'SEGMENT' && !validated.segmentId) {
    throw BadRequest('segmentId is required when audienceType is SEGMENT');
  }

  const campaign = await plunk.createCampaign(validated);
  return res.status(201).json({ campaign });
}

/**
 * PUT /api/campaigns/:id — replace a draft
 */
export async function updateCampaign(req, res) {
  const value = await createSchema.validateAsync(req.body, {
    stripUnknown: true,
    presence: 'optional',
  });
  const validated = validateCampaignInput(value);
  const campaign = await plunk.updateCampaign(req.params.id, validated);
  return res.json({ campaign });
}

/**
 * DELETE /api/campaigns/:id
 */
export async function deleteCampaign(req, res) {
  await plunk.deleteCampaign(req.params.id);
  return res.status(204).send();
}

/**
 * POST /api/campaigns/:id/send — send now, or schedule with `scheduledFor`
 */
export async function sendCampaign(req, res) {
  const { scheduledFor } = req.body ?? {};

  if (scheduledFor) {
    const when = new Date(scheduledFor);
    if (Number.isNaN(when.getTime())) throw BadRequest('Invalid scheduledFor value');
    if (when.getTime() <= Date.now()) throw BadRequest('scheduledFor must be in the future');

    const campaign = await plunk.sendCampaign(req.params.id, when.toISOString());
    return res.json({ campaign });
  }

  const campaign = await plunk.sendCampaign(req.params.id);
  return res.status(202).json({ campaign });
}

/**
 * POST /api/campaigns/:id/schedule — explicit schedule endpoint
 */
export async function scheduleCampaign(req, res) {
  const { scheduledFor } = await scheduleSchema.validateAsync(req.body, { stripUnknown: true });
  const when = new Date(scheduledFor);
  if (when.getTime() <= Date.now()) throw BadRequest('scheduledFor must be in the future');

  const campaign = await plunk.sendCampaign(req.params.id, when.toISOString());
  return res.json({ campaign });
}

/**
 * POST /api/campaigns/:id/cancel
 */
export async function cancelCampaign(req, res) {
  const campaign = await plunk.cancelCampaign(req.params.id);
  return res.json({ campaign });
}

/**
 * POST /api/campaigns/:id/test — single-address test send
 */
export async function testCampaign(req, res) {
  const { email } = req.body ?? {};
  if (!email) throw BadRequest('email is required for a test send');

  const result = await plunk.testCampaign(req.params.id, email);
  return res.json(result);
}

/**
 * POST /api/campaigns/:id/duplicate — editable DRAFT copy (recurring / A/B base)
 */
export async function duplicateCampaign(req, res) {
  const campaign = await plunk.duplicateCampaign(req.params.id);
  return res.status(201).json({ campaign });
}

/**
 * GET /api/campaigns/:id/analytics — authoritative stats from Plunk
 */
export async function getCampaignAnalytics(req, res) {
  const stats = await plunk.getCampaignStats(req.params.id);
  if (!stats) throw NotFound('Campaign stats not found');
  return res.json({ stats });
}

export { createSchema, scheduleSchema };
