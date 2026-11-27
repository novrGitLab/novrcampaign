import { randomUUID } from 'node:crypto';
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
async function plunkRequest(path, { method = 'GET', query = {}, body, retry = true, idempotencyKey } = {}) {
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
        ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey }),
      },
      ...(idempotencyKey && { signal: AbortSignal.timeout(15000) }),
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
      err.originalStatus = apiError.details?.originalStatusCode;
      err.requestId = apiError.requestId;
      err.details = apiError.errors;
      throw err;
    }

    return unwrap(data);
  };

  if (!retry) return call();
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
 * `subscribed: true|false` filters to one subscription state (Plunk returns
 * `total` for that filter on the first page); `sort`/`dir` order the rows.
 * @param {{ limit?: number, cursor?: string, search?: string, subscribed?: boolean, sort?: string, dir?: string }} [opts]
 */
export async function getContacts({ limit = 50, cursor, search, subscribed, sort, dir } = {}) {
  return plunkRequest('/contacts', {
    query: {
      limit,
      ...(cursor ? { cursor } : {}),
      ...(search ? { search } : {}),
      ...(typeof subscribed === 'boolean' ? { subscribed } : {}),
      ...(sort ? { sort } : {}),
      ...(dir ? { dir } : {}),
    },
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
    retry: false,
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

// ── Suppressions ──────────────────────────────────────────────────────────────
// Plunk's /contacts only exposes a `subscribed` boolean, so there is no way to
// ask it "which addresses are undeliverable and why". The reason only exists on
// the event stream: hard bounces and complaints auto-flip `subscribed` to
// false, soft (transient) bounces do not. This rebuilds that picture.

const SUPPRESSION_EVENTS = [
  { eventName: 'email.bounce', reason: 'BOUNCE' },
  { eventName: 'email.complaint', reason: 'COMPLAINT' },
  { eventName: 'contact.unsubscribed', reason: 'UNSUBSCRIBED' },
];

const PERMANENT_BOUNCE = new Set(['permanent', 'hard', 'blocked']);

function toRow(event, reason, campaignName) {
  const campaignId = event.data?.campaignId ?? null;
  return {
    email: event.contact?.email ?? event.data?.email,
    reason,
    at: event.createdAt ?? null,
    campaignId,
    campaignName: campaignId ? (campaignName.get(campaignId) ?? null) : null,
    bounceType: event.data?.bounceType ?? null,
  };
}

export async function getSuppressions() {
  // Plunk wraps list responses as { data: [...] } / { campaigns: [...] } —
  // unwrap before building the id→name map, otherwise every campaign shows
  // as a raw id in the UI.
  const raw = await getCampaigns();
  const campaignList = Array.isArray(raw)
    ? raw
    : (raw?.data ?? raw?.campaigns ?? raw?.items ?? []);
  const campaignName = new Map(
    campaignList.filter((c) => c?.id).map((c) => [c.id, c.name]),
  );

  const streams = await Promise.all(
    SUPPRESSION_EVENTS.map(({ eventName }) =>
      plunkRequest('/events', { query: { eventName, limit: 2000 } }).catch(() => ({ events: [] })),
    ),
  );

  const byEmail = new Map();
  const softBounces = [];

  streams.forEach((stream, index) => {
    const { reason } = SUPPRESSION_EVENTS[index];
    const events = Array.isArray(stream?.events) ? stream.events : [];

    for (const event of events) {
      const row = toRow(event, reason, campaignName);
      if (!row.email) continue;

      if (reason === 'BOUNCE' && !PERMANENT_BOUNCE.has(String(row.bounceType).toLowerCase())) {
        softBounces.push(row);
        continue;
      }

      const key = row.email.toLowerCase();
      const entry = byEmail.get(key);
      if (!entry) {
        byEmail.set(key, { ...row, reasons: [reason] });
        continue;
      }

      if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
      if (row.at && (!entry.at || row.at < entry.at)) {
        entry.at = row.at;
        entry.campaignId = row.campaignId;
        entry.campaignName = row.campaignName;
      }
    }
  });

  const suppressions = [...byEmail.values()].sort((a, b) =>
    new Date(b.at ?? 0) - new Date(a.at ?? 0),
  );
  softBounces.sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0));

  const counts = { BOUNCE: 0, COMPLAINT: 0, UNSUBSCRIBED: 0, total: suppressions.length };
  for (const s of suppressions) {
    for (const reason of s.reasons) counts[reason] += 1;
  }

  return { suppressions, softBounces, counts };
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

export async function sendBriefingProof(to, subject, html) {
  const delivery = await plunkRequest('/v1/send', {
    method: 'POST',
    retry: false,
    idempotencyKey: 'pulse-proof-' + randomUUID(),
    body: { to, subject: '[Test] ' + subject, body: html, from: { name: 'NovrPulse', email: SENDER.from }, reply: SENDER.replyTo },
  });
  const recipients = delivery?.emails;
  if (recipients?.length !== 1 || !['queued', 'sent', 'delivered'].includes(recipients[0].status)) {
    throw new Error('The provider did not confirm a queued proof copy. Check delivery history before retrying.');
  }
  return recipients[0].email;
}

export async function sendStaffNotice(email, content, id) {
  try {
    return await plunkRequest('/v1/send', { method: 'POST', retry: false, idempotencyKey: 'pulse-access-' + id,
      body: { to: email, from: { name: 'NovrPulse', email: SENDER.from }, ...content } });
  } catch (error) {
    if (error.code === 'IDEMPOTENCY_KEY_REUSED' && error.originalStatus >= 200 && error.originalStatus < 300) return;
    throw error;
  }
}

export function sendConfirmation(email, link) {
  return plunkRequest('/v1/send', { method: 'POST', body: {
    to: email, from: { name:'NovrPulse', email:SENDER.from }, subject: 'Confirm your NovrPulse subscription',
    body: '<p>Confirm this address to receive the NovrPulse Daily Brief.</p><p><a href="' + link + '">Confirm subscription</a></p><p>The link expires in 24 hours.</p>',
  } });
}
