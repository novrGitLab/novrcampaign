import Joi from 'joi';
import { BadRequest, NotFound } from '../utils/AppError.js';
import * as plunk from '../services/plunkService.js';

const segmentSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  description: Joi.string().max(500).allow('').optional(),
  type: Joi.string().valid('DYNAMIC', 'STATIC').default('DYNAMIC'),
  condition: Joi.object().unknown(true).optional(),
  trackMembership: Joi.boolean().optional(),
});

const membersSchema = Joi.object({
  emails: Joi.array().items(Joi.string().email()).min(1).max(1000).required(),
  createMissing: Joi.boolean().optional(),
  subscribed: Joi.boolean().optional(),
});

/**
 * GET /api/segments
 */
export async function getSegments(_req, res) {
  const result = await plunk.getSegments();
  const segments = Array.isArray(result) ? result : (result?.data ?? result?.segments ?? []);
  return res.json({ segments });
}

/**
 * GET /api/segments/:id
 */
export async function getSegment(req, res) {
  const segment = await plunk.getSegment(req.params.id);
  if (!segment) throw NotFound('Segment not found');
  return res.json({ segment });
}

/**
 * POST /api/segments
 */
export async function createSegment(req, res) {
  const value = await segmentSchema.validateAsync(req.body, { stripUnknown: true });
  if (value.type === 'DYNAMIC' && !value.condition) {
    throw BadRequest('condition is required for DYNAMIC segments');
  }
  const segment = await plunk.createSegment(value);
  return res.status(201).json({ segment });
}

/**
 * PATCH /api/segments/:id
 */
export async function updateSegment(req, res) {
  const value = await Joi.object({
    name: Joi.string().min(1).max(200).optional(),
    description: Joi.string().max(500).allow('').optional(),
    condition: Joi.object().unknown(true).optional(),
    trackMembership: Joi.boolean().optional(),
  }).validateAsync(req.body, { stripUnknown: true });
  const segment = await plunk.updateSegment(req.params.id, value);
  return res.json({ segment });
}

/**
 * DELETE /api/segments/:id
 */
export async function deleteSegment(req, res) {
  await plunk.deleteSegment(req.params.id);
  return res.status(204).send();
}

/**
 * GET /api/segments/:id/contacts?page&pageSize
 */
export async function getSegmentContacts(req, res) {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25)));
  const result = await plunk.getSegmentContacts(req.params.id, { page, pageSize });
  return res.json(result);
}

/**
 * POST /api/segments/:id/members (STATIC only)
 */
export async function addSegmentMembers(req, res) {
  const value = await membersSchema.validateAsync(req.body, { stripUnknown: true });
  const result = await plunk.addSegmentMembers(req.params.id, value);
  return res.json(result);
}

/**
 * DELETE /api/segments/:id/members { emails }
 */
export async function removeSegmentMembers(req, res) {
  const { emails } = await Joi.object({
    emails: Joi.array().items(Joi.string().email()).min(1).max(1000).required(),
  }).validateAsync(req.body, { stripUnknown: true });
  const result = await plunk.removeSegmentMembers(req.params.id, emails);
  return res.json(result);
}

/**
 * POST /api/segments/:id/refresh | /compute
 */
export async function refreshSegment(req, res) {
  const result = await plunk.refreshSegment(req.params.id);
  return res.json(result);
}

export async function computeSegment(req, res) {
  const result = await plunk.computeSegment(req.params.id);
  return res.json(result);
}
