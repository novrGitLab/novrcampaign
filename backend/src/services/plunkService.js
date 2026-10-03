import { config } from '../config/env.js';
import { withRetry, sleep } from '../utils/backoff.js';
import { AppError } from '../utils/AppError.js';
import logger from '../utils/logger.js';
import {
  consumeBudget,
  setLockout,
  getLockoutMs,
} from '../utils/providerRateLimiter.js';

/**
 * Fixed in-house sender identity. This is an internal tool, so the from /
 * reply-to addresses are not configurable per campaign.
 */
export const SENDER = {
  from: 'info@cybernovr.com',
  fromName: 'CyberNovr',
  replyTo: 'info@cybernovr.com',
};

/**
 * Plunk API client (Plunk Cloud: https://next-api.useplunk.com).
 *
 * Auth is a single secret API key (sk_*) sent as `Authorization: Bearer <key>`.
 * Every call is rate-budgeted (Redis token window) and retried with exponential
 * backoff on 429 / 5xx / transient network errors.
 *
 * Response shapes:
 *   - Public `/v1/*` + campaign endpoints wrap in { success, data }
 *   - Other dashboard endpoints return the resource directly
 *   - List endpoints return { data, cursor, hasMore, total }
 * `unwrap()` normalises all three.
 */

/**
 * Resolve the envelope Plunk used for this endpoint.
 * @param {any} payload
 * @returns {any}
 */
function unwrap(payload) {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

/**
 * @param {string} path e.g. "/contacts" or "/v1/send"
 * @param {{ method?: string, query?: Record<string,string|number>, body?: object }} [opts]
 * @returns {Promise<any>}
 */
async function plunkRequest(path, { method = 'GET', query = {}, body } = {}) {
  const call = async () => {
    // 1. Honour an active lockout
    const lockMs = await getLockoutMs();
    if (lockMs > 0) {
      logger.debug({ lockMs }, 'Provider lockout active — waiting');
      await sleep(lockMs + 100);
    }

    // 2. Consume rate budget; wait out the window if exhausted
    let budget = await consumeBudget();
    if (budget.waitMs > 0) {
      await sleep(budget.waitMs);
      budget = await consumeBudget();
    }

    const apiKey = config.plunk.apiKey;

    if (!apiKey) {
      throw AppError.Unauthorized('Plunk API key not configured — set PLUNK_API_KEY');
    }

    const url = new URL(`${config.plunk.baseUrl}${path}`);
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const err = new Error(`Plunk returned a non-JSON response (${res.status})`);
      err.status = res.status;
      err.raw = text.slice(0, 500);
      throw err;
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? 60);
      await setLockout(retryAfter);
      const err = new Error('Plunk API rate limit reached');
      err.status = 429;
      err.headers = { 'retry-after': retryAfter };
      throw err;
    }

    // Plunk error envelope: { success: false, error: { code, message, statusCode, errors } }
    if (!res.ok || data?.success === false) {
      const apiError = data?.error ?? {};
      const message = apiError.message || data?.message || `Plunk API error (${res.status})`;
      const err = new Error(message);
      err.status = apiError.statusCode || (res.status >= 400 ? res.status : 500);
      err.code = apiError.code;
      err.requestId = apiError.requestId;
      err.details = apiError.errors;
      throw err;
    }

    return unwrap(data);
  };

  return withRetry(call, {
    maxAttempts: 4,
    label: `plunk.${method}:${path}`,
    retryOn: (e) => e.status === 429 || e.status >= 500,
  });
}

// ── Contacts ──────────────────────────────────────────────────────────────────

/**
 * Create or upsert a contact. Existing emails are updated, not rejected.
 * @param {{ email: string, subscribed?: boolean, data?: Record<string, any> }} input
 * @returns {Promise<{ id: string, email: string, isNew: boolean }>}
 */
export async function createContact({ email, subscribed = true, data }) {
  const result = await plunkRequest('/contacts', {
    method: 'POST',
    body: { email, subscribed, ...(data ? { data } : {}) },
  });
  // POST /contacts returns _meta.isNew / _meta.isUpdate
  return {
    id: result.id,
    email: result.email,
    isNew: result._meta?.isNew ?? true,
    ...result,
  };
}

/**
 * Bulk subscribe contact IDs (max 1,000 per call).
 * @param {string[]} contactIds
 * @returns {Promise<string>} job id — poll with getBulkJob()
 */
export async function bulkSubscribe(contactIds) {
  if (!contactIds.length) return null;
  const result = await plunkRequest('/contacts/bulk-subscribe', {
    method: 'POST',
    body: { ids: contactIds },
  });
  return result.jobId ?? result.job ?? result.id;
}

/**
 * Bulk unsubscribe contact IDs.
 * @param {string[]} contactIds
 */
export async function bulkUnsubscribe(contactIds) {
  if (!contactIds.length) return null;
  const result = await plunkRequest('/contacts/bulk-unsubscribe', {
    method: 'POST',
    body: { ids: contactIds },
  });
  return result.jobId ?? result.job ?? result.id;
}

/**
 * Bulk delete contact IDs.
 * @param {string[]} contactIds
 */
export async function bulkDelete(contactIds) {
  if (!contactIds.length) return null;
  const result = await plunkRequest('/contacts/bulk-delete', {
    method: 'POST',
    body: { ids: contactIds },
  });
  return result.jobId ?? result.job ?? result.id;
}

/**
 * Poll a bulk job for progress.
 * @param {string} jobId
 */
export async function getBulkJob(jobId) {
  return plunkRequest(`/contacts/bulk/${jobId}`);
}

/**
 * List contacts with cursor pagination.
 * @param {{ limit?: number, cursor?: string, search?: string }} [opts]
 */
export async function getContacts({ limit = 50, cursor, search } = {}) {
  return plunkRequest('/contacts', {
    query: { limit, ...(cursor ? { cursor } : {}), ...(search ? { search } : {}) },
  });
}

/**
 * Import contacts from a CSV buffer (≤ 5 MB). Plunk takes multipart uploads;
 * first column must be `email`, remaining columns map to `data.*`.
 * @param {Buffer} csv
 * @returns {Promise<string>} import job id
 */
export async function importContactsCsv(csv) {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'contacts.csv');

  const res = await fetch(`${config.plunk.baseUrl}/contacts/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.plunk.apiKey}`,
    },
    body: form,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.error ?? data;
    const reason = detail?.message || `Plunk import failed (${res.status})`;
    const err = new Error(
      [reason, detail?.code ? `[${detail.code}]` : null, detail?.requestId ? `(ref ${detail.requestId})` : null]
        .filter(Boolean)
        .join(' '),
    );
    err.status = res.status;
    err.details = detail?.errors;
    throw err;
  }

  return unwrap(data)?.jobId ?? unwrap(data)?.id;
}

/**
 * Poll a CSV import job.
 * @param {string} jobId
 */
export async function getImportJob(jobId) {
  return plunkRequest(`/contacts/import/${jobId}`);
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

/**
 * Create a campaign in DRAFT. Sender identity is fixed to the in-house address.
 *
 * @param {{
 *   name: string,
 *   subject: string,
 *   body: string,
 *   type?: 'MARKETING'|'TRANSACTIONAL'|'HEADLESS',
 *   audienceType?: 'ALL'|'SEGMENT'|'FILTERED',
 *   segmentId?: string,
 * }} input
 * @returns {Promise<object>} the created campaign
 */
export async function createCampaign(input) {
  return plunkRequest('/campaigns', {
    method: 'POST',
    body: {
      name: input.name,
      subject: input.subject,
      body: input.body,
      from: SENDER.from,
      fromName: SENDER.fromName,
      replyTo: SENDER.replyTo,
      type: input.type ?? 'MARKETING',
      audienceType: input.audienceType ?? 'ALL',
      ...(input.segmentId ? { segmentId: input.segmentId } : {}),
    },
  });
}

/**
 * Replace a draft campaign's content.
 * @param {string} campaignId
 * @param {object} input
 */
export async function updateCampaign(campaignId, input) {
  return plunkRequest(`/campaigns/${campaignId}`, {
    method: 'PUT',
    body: {
      name: input.name,
      subject: input.subject,
      body: input.body,
      from: SENDER.from,
      fromName: SENDER.fromName,
      replyTo: SENDER.replyTo,
      type: input.type ?? 'MARKETING',
      audienceType: input.audienceType ?? 'ALL',
      ...(input.segmentId ? { segmentId: input.segmentId } : {}),
    },
  });
}

/**
 * Delete a draft campaign (409 if it has active executions).
 * @param {string} campaignId
 */
export async function deleteCampaign(campaignId) {
  await plunkRequest(`/campaigns/${campaignId}`, { method: 'DELETE' });
  return true;
}

/**
 * Send a campaign now, or schedule it by passing `scheduledFor`.
 * @param {string} campaignId
 * @param {string} [scheduledFor] ISO 8601 timestamp
 */
export async function sendCampaign(campaignId, scheduledFor) {
  return plunkRequest(`/campaigns/${campaignId}/send`, {
    method: 'POST',
    body: scheduledFor ? { scheduledFor } : {},
  });
}

/**
 * Cancel a SCHEDULED or SENDING campaign.
 * @param {string} campaignId
 */
export async function cancelCampaign(campaignId) {
  return plunkRequest(`/campaigns/${campaignId}/cancel`, { method: 'POST' });
}

/**
 * Send a single test email.
 * @param {string} campaignId
 * @param {string} email
 */
export async function testCampaign(campaignId, email) {
  return plunkRequest(`/campaigns/${campaignId}/test`, { method: 'POST', body: { email } });
}

/**
 * List campaigns.
 */
export async function getCampaigns() {
  return plunkRequest('/campaigns');
}

/**
 * Fetch one campaign.
 * @param {string} campaignId
 */
export async function getCampaign(campaignId) {
  return plunkRequest(`/campaigns/${campaignId}`);
}

/**
 * Fetch authoritative stats for a campaign.
 * @param {string} campaignId
 * @returns {Promise<object>}
 */
export async function getCampaignStats(campaignId) {
  return plunkRequest(`/campaigns/${campaignId}/stats`);
}

/**
 * Duplicate a campaign — returns the new DRAFT copy.
 * @param {string} campaignId
 */
export async function duplicateCampaign(campaignId) {
  return plunkRequest(`/campaigns/${campaignId}/duplicate`, { method: 'POST' });
}

// ── Templates ─────────────────────────────────────────────────────────────────
// Reusable subject/body/sender presets used by campaigns, workflows and /v1/send.

/**
 * List all templates.
 */
export async function getTemplates() {
  return plunkRequest('/templates');
}

/**
 * Get one template.
 * @param {string} templateId
 */
export async function getTemplate(templateId) {
  return plunkRequest(`/templates/${templateId}`);
}

/**
 * Create a template. `from` must be on a verified domain (defaults to SENDER).
 */
export async function createTemplate({ name, subject, body, type = 'MARKETING', from, fromName, replyTo }) {
  return plunkRequest('/templates', {
    method: 'POST',
    body: {
      name,
      subject,
      body,
      type,
      from: from ?? SENDER.from,
      fromName: fromName ?? SENDER.fromName,
      replyTo: replyTo ?? SENDER.replyTo,
    },
  });
}

/**
 * Update a template (partial).
 * @param {string} templateId
 * @param {object} input
 */
export async function updateTemplate(templateId, input) {
  return plunkRequest(`/templates/${templateId}`, { method: 'PATCH', body: input });
}

/**
 * Delete a template.
 * @param {string} templateId
 */
export async function deleteTemplate(templateId) {
  await plunkRequest(`/templates/${templateId}`, { method: 'DELETE' });
  return true;
}

/**
 * Duplicate a template — returns the new template.
 * @param {string} templateId
 */
export async function duplicateTemplate(templateId) {
  return plunkRequest(`/templates/${templateId}/duplicate`, { method: 'POST' });
}

/**
 * List campaigns / workflow steps referencing a template.
 * @param {string} templateId
 */
export async function getTemplateUsage(templateId) {
  return plunkRequest(`/templates/${templateId}/usage`);
}

// ── Segments ──────────────────────────────────────────────────────────────────
// Named audiences: DYNAMIC (filter-driven) or STATIC (manually curated).

/**
 * List all segments (small list, no pagination in Plunk).
 */
export async function getSegments() {
  return plunkRequest('/segments');
}

/**
 * Get one segment, including cached memberCount.
 * @param {string} segmentId
 */
export async function getSegment(segmentId) {
  return plunkRequest(`/segments/${segmentId}`);
}

/**
 * Create a segment. DYNAMIC (default) requires `condition`; STATIC rejects it.
 */
export async function createSegment({ name, description, type = 'DYNAMIC', condition, trackMembership }) {
  return plunkRequest('/segments', {
    method: 'POST',
    body: {
      name,
      ...(description ? { description } : {}),
      type,
      ...(condition ? { condition } : {}),
      ...(typeof trackMembership === 'boolean' ? { trackMembership } : {}),
    },
  });
}

/**
 * Update name / description / condition (dynamic only) / trackMembership.
 * @param {string} segmentId
 * @param {object} input
 */
export async function updateSegment(segmentId, input) {
  return plunkRequest(`/segments/${segmentId}`, { method: 'PATCH', body: input });
}

/**
 * Delete a segment (409 if used by an active campaign).
 * @param {string} segmentId
 */
export async function deleteSegment(segmentId) {
  await plunkRequest(`/segments/${segmentId}`, { method: 'DELETE' });
  return true;
}

/**
 * Page-based list of segment members. Live for dynamic segments.
 * @param {string} segmentId
 * @param {{ page?: number, pageSize?: number }} [opts]
 */
export async function getSegmentContacts(segmentId, { page = 1, pageSize = 25 } = {}) {
  return plunkRequest(`/segments/${segmentId}/contacts`, { query: { page, pageSize } });
}

/**
 * Add contacts by email to a STATIC segment.
 * @param {string} segmentId
 * @param {{ emails: string[], createMissing?: boolean, subscribed?: boolean }} input
 */
export async function addSegmentMembers(segmentId, { emails, createMissing, subscribed }) {
  return plunkRequest(`/segments/${segmentId}/members`, {
    method: 'POST',
    body: {
      emails,
      ...(typeof createMissing === 'boolean' ? { createMissing } : {}),
      ...(typeof subscribed === 'boolean' ? { subscribed } : {}),
    },
  });
}

/**
 * Remove contacts by email from a STATIC segment.
 * @param {string} segmentId
 * @param {string[]} emails
 */
export async function removeSegmentMembers(segmentId, emails) {
  return plunkRequest(`/segments/${segmentId}/members`, { method: 'DELETE', body: { emails } });
}

/**
 * Force a cheap count refresh (no events).
 * @param {string} segmentId
 */
export async function refreshSegment(segmentId) {
  return plunkRequest(`/segments/${segmentId}/refresh`, { method: 'POST' });
}

/**
 * Force a full membership recomputation (fires pending entry/exit events).
 * @param {string} segmentId
 */
export async function computeSegment(segmentId) {
  return plunkRequest(`/segments/${segmentId}/compute`, { method: 'POST' });
}

// ── Events ────────────────────────────────────────────────────────────────────
// System events (email.sent/delivery/open/click/bounce/complaint) are tracked
// automatically per contact and carry data.campaignId for campaign mail.

/**
 * List events, optionally filtered by exact event name.
 * NOTE: the filter param is `eventName` (`event` is silently ignored),
 * and the response is a bare `{ events: [...] }` envelope — no cursor,
 * so use a generous limit (verified: 500 covers this project's volume).
 * @param {{ eventName?: string, limit?: number }} [opts]
 */
export async function getEvents({ eventName, limit = 500 } = {}) {
  return plunkRequest('/events', {
    query: {
      ...(eventName ? { eventName } : {}),
      limit,
    },
  });
}

// ── Contacts (single-record detail for Contact 360) ───────────────────────────

/**
 * Get a single contact.
 * @param {string} contactId
 */
export async function getContact(contactId) {
  return plunkRequest(`/contacts/${contactId}`);
}

/**
 * Update a contact's email / subscription / data fields.
 * @param {string} contactId
 * @param {object} input
 */
export async function updateContact(contactId, input) {
  return plunkRequest(`/contacts/${contactId}`, { method: 'PATCH', body: input });
}

export default {
  SENDER,
  createContact,
  bulkSubscribe,
  bulkUnsubscribe,
  bulkDelete,
  getBulkJob,
  getContacts,
  getContact,
  updateContact,
  getEvents,
  importContactsCsv,
  getImportJob,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  duplicateCampaign,
  sendCampaign,
  cancelCampaign,
  testCampaign,
  getCampaigns,
  getCampaign,
  getCampaignStats,
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplateUsage,
  getSegments,
  getSegment,
  createSegment,
  updateSegment,
  deleteSegment,
  getSegmentContacts,
  addSegmentMembers,
  removeSegmentMembers,
  refreshSegment,
  computeSegment,
};
