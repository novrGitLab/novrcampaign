import Joi from 'joi';
import { NotFound } from '../utils/AppError.js';
import * as plunk from '../services/plunkService.js';
import { validateCampaignInput } from '../services/emailService.js';

const templateSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  subject: Joi.string().min(1).max(300).required(),
  body: Joi.string().min(1).required(),
  type: Joi.string().valid('MARKETING', 'TRANSACTIONAL', 'HEADLESS').default('MARKETING'),
});

/**
 * GET /api/templates
 */
export async function getTemplates(_req, res) {
  const result = await plunk.getTemplates();
  const templates = Array.isArray(result) ? result : (result?.data ?? result?.templates ?? []);
  return res.json({ templates });
}

/**
 * GET /api/templates/:id
 */
export async function getTemplate(req, res) {
  const template = await plunk.getTemplate(req.params.id);
  if (!template) throw NotFound('Template not found');
  return res.json({ template });
}

/**
 * POST /api/templates
 */
export async function createTemplate(req, res) {
  const value = await templateSchema.validateAsync(req.body, { stripUnknown: true });
  const validated = validateCampaignInput(value);
  const template = await plunk.createTemplate(validated);
  return res.status(201).json({ template });
}

/**
 * PATCH /api/templates/:id
 */
export async function updateTemplate(req, res) {
  const value = await templateSchema.validateAsync(req.body, {
    stripUnknown: true,
    presence: 'optional',
  });
  const template = await plunk.updateTemplate(req.params.id, value);
  return res.json({ template });
}

/**
 * DELETE /api/templates/:id
 */
export async function deleteTemplate(req, res) {
  await plunk.deleteTemplate(req.params.id);
  return res.status(204).send();
}

/**
 * POST /api/templates/:id/duplicate
 */
export async function duplicateTemplate(req, res) {
  const template = await plunk.duplicateTemplate(req.params.id);
  return res.status(201).json({ template });
}

/**
 * GET /api/templates/:id/usage
 */
export async function getTemplateUsage(req, res) {
  const usage = await plunk.getTemplateUsage(req.params.id);
  return res.json({ usage });
}
