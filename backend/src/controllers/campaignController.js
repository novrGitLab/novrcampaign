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
 * POST /api/campaigns/:id/resend-unsent — rebuild the unsent audience.
 *
 * Collects every contact Plunk actually sent this campaign to (email.sent
 * events carry data.campaignId), subtracts them from the original audience,
 * saves the remainder as a STATIC segment, and returns a DRAFT duplicate
 * already retargeted at that segment. Nothing is sent — the user reviews
 * and sends the duplicate themselves.
 */
export async function resendUnsent(req, res) {
  const campaign = await plunk.getCampaign(req.params.id);
  if (!campaign) throw NotFound('Campaign not found');

  // 1. Everyone Plunk actually reached for THIS campaign — union of every
  // delivery signal (a blocked send may count in stats without an event,
  // so any evidence of receipt excludes the contact from the resend)
  const sent = new Set();
  for (const name of ['email.sent', 'email.delivery', 'email.open', 'email.click', 'email.bounce', 'email.complaint']) {
    const result = await plunk.getEvents({ eventName: name, limit: 1000 });
    const events = result?.events ?? result?.data ?? [];
    for (const e of events) {
      if (e?.data?.campaignId === campaign.id && e?.contact?.email) {
        sent.add(String(e.contact.email).toLowerCase());
      }
    }
  }

  // 2. Reconstruct the original audience
  const audience = [];
  if (campaign.audienceType === 'SEGMENT' && campaign.segmentId) {
    let pageNum = 1;
    for (;;) {
      const result = await plunk.getSegmentContacts(campaign.segmentId, { page: pageNum, pageSize: 100 });
      const rows = result?.contacts ?? result?.data ?? [];
      audience.push(...rows.map((c) => String(c.email).toLowerCase()));
      if (rows.length < 100) break;
      pageNum += 1;
      if (pageNum > 50) break;
    }
  } else if (!campaign.audienceType || campaign.audienceType === 'ALL') {
    let contactCursor;
    for (let page = 0; page < 50; page++) {
      const result = await plunk.getContacts({ limit: 100, cursor: contactCursor });
      const rows = result?.data ?? result?.contacts ?? [];
      for (const c of rows) {
        if (c?.subscribed !== false && c?.email) audience.push(String(c.email).toLowerCase());
      }
      contactCursor = result?.cursor;
      if (!contactCursor || !result?.hasMore || rows.length === 0) break;
    }
  } else {
    throw BadRequest('FILTERED audiences cannot be reconstructed — duplicate the campaign and pick the audience manually.');
  }

  const audienceSet = new Set(audience);
  const unsent = [...audienceSet].filter((email) => !sent.has(email));
  const summary = { sentCount: sent.size, audienceCount: audienceSet.size, unsentCount: unsent.length };

  if (unsent.length === 0) {
    return res.json({ ...summary, segment: null, campaign: null });
  }

  // 3. STATIC segment with the remainder (chunked; members already exist)
  const segment = await plunk.createSegment({
    name: `Resend · ${campaign.name} · unsent`,
    description: `Auto-built: contacts in the original audience with no email.sent event for campaign ${campaign.id}.`,
    type: 'STATIC',
  });
  for (let i = 0; i < unsent.length; i += 500) {
    await plunk.addSegmentMembers(segment.id, { emails: unsent.slice(i, i + 500), createMissing: false });
  }

  // 4. DRAFT duplicate retargeted at the unsent segment, ready to review + send
  const copy = await plunk.duplicateCampaign(campaign.id);
  const ready = await plunk.updateCampaign(copy.id, { audienceType: 'SEGMENT', segmentId: segment.id });

  return res.status(201).json({ ...summary, segment, campaign: ready });
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
