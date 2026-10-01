import { AppError } from '../utils/AppError.js';
import logger from '../utils/logger.js';
import { parseContactsCsv } from './csvService.js';
import { validateEmailBatch } from '../utils/emailValidator.js';

/**
 * Thin BFF service layer.
 *
 * Plunk is the source of truth for contacts, campaigns, and analytics — this
 * module holds *only* the value-add logic that shouldn't live in a proxy:
 * deliverability validation, unsubscribe enforcement, and webhook shaping.
 */

// Merge tags Plunk auto-injects and expands per recipient
const UNSUBSCRIBE_TOKENS = ['{{unsubscribeurl}}', '{{unsubscribe}}', '{{unsuburl}}', '{{manageurl}}'];

/**
 * Whether the HTML already references Plunk's unsubscribe variables.
 * @param {string} html
 * @returns {boolean}
 */
export function hasUnsubscribeToken(html) {
  const lower = String(html ?? '').toLowerCase();
  return UNSUBSCRIBE_TOKENS.some((t) => lower.includes(t));
}

/**
 * Plunk auto-injects the unsubscribe footer for MARKETING and HEADLESS campaign
 * types, so enforcement is a *check*, not an injection — except for HEADLESS,
 * where the body is entirely ours and must link `{{unsubscribeUrl}}` itself.
 *
 * @param {string} html
 * @param {'MARKETING'|'TRANSACTIONAL'|'HEADLESS'} type
 * @returns {string}
 */
export function enforceUnsubscribeLink(html, type = 'MARKETING') {
  if (type === 'TRANSACTIONAL') return html;

  if (hasUnsubscribeToken(html)) return html;

  if (type === 'HEADLESS') {
    // Headless sends are responsible for their own footer
    return `${html}
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
  <p><a href="{{unsubscribeUrl}}" style="color:#6b7280;">Unsubscribe</a> &middot;
     Manage your email preferences at any time.</p>
  <p>CyberNovr &middot; 17 Sunday Adigun Street, Alausa, Ikeja, Lagos, Nigeria</p>
</div>`;
  }

  // MARKETING: Plunk appends the footer itself; nothing to do
  return html;
}

/**
 * Validate campaign input. The sender address is fixed in-house, so it is not
 * part of the request payload.
 * @param {object} input
 * @returns {object} normalized input
 */
export function validateCampaignInput(input) {
  if (!input.name?.trim()) throw AppError.BadRequest('Campaign name is required');
  if (!input.subject?.trim()) throw AppError.BadRequest('Subject is required');
  if (!input.body?.trim()) throw AppError.BadRequest('Email HTML body is required');

  return {
    ...input,
    name: input.name.trim(),
    subject: input.subject.trim(),
    body: enforceUnsubscribeLink(input.body, input.type ?? 'MARKETING'),
    type: input.type ?? 'MARKETING',
    audienceType: input.audienceType ?? 'ALL',
  };
}

/**
 * Pre-flight check on a CSV before it is handed to Plunk's importer.
 * Returns a report of what would be rejected so the dashboard can show it
 * instantly; the buffer itself is forwarded unchanged.
 *
 * @param {Buffer|string} csv
 * @param {{ checkMx?: boolean, maxRows?: number }} [opts]
 * @returns {Promise<{ total: number, valid: number, invalid: Array<{email:string,reason:string}>, duplicates: number }>}
 */
export async function validateCsv(
  csv,
  { checkMx = true, maxRows = Number(process.env.CSV_MAX_ROWS ?? 100_000) } = {},
) {
  const { contacts, stats } = await parseContactsCsv(csv, { maxRows });

  if (!contacts.length) {
    return { total: stats.total, valid: 0, invalid: [], duplicates: 0 };
  }

  const emails = contacts.map((c) => c.email);
  const seen = new Set();
  const duplicates = emails.filter((e) => (seen.has(e) ? true : (seen.add(e), false))).length;

  const { valid, invalid } = await validateEmailBatch(emails, { checkMx });

  return { total: stats.total, valid: valid.length, invalid, duplicates };
}

/**
 * Normalize an inbound Plunk webhook payload (from a Workflow Webhook step).
 *
 * Plunk already suppresses hard bounces and complaints and honors unsubscribes,
 * so this is observability + downstream alerting rather than state management.
 *
 * @param {object} payload
 * @returns {{ event: string|null, email: string|null, campaignId: string|null, bounceType?: string, transient?: boolean }}
 */
export function normalizeWebhookEvent(payload) {
  const event = String(payload?.event ?? payload?.type ?? '').toLowerCase() || null;
  const email = String(payload?.email ?? payload?.contact ?? payload?.data?.email ?? '').toLowerCase() || null;
  const campaignId = payload?.campaignId ?? payload?.campaign ?? payload?.data?.campaignId ?? null;

  return {
    event,
    email,
    campaignId,
    bounceType: payload?.bounceType ?? null,
    transient: payload?.transientBounce ?? false,
  };
}

/**
 * Log and acknowledge a webhook event. Extend here to fan out to Slack, etc.
 * @param {object} payload
 */
export async function handleWebhookEvent(payload) {
  const normalized = normalizeWebhookEvent(payload);

  if (!normalized.event) {
    logger.warn({ payload }, 'Webhook received with no event type');
    return { handled: false };
  }

  const level = ['email.bounce', 'email.complaint'].includes(normalized.event) ? 'warn' : 'info';
  logger[level](normalized, `Plunk webhook: ${normalized.event}`);

  return { handled: true, ...normalized };
}

export default {
  hasUnsubscribeToken,
  enforceUnsubscribeLink,
  validateCampaignInput,
  validateCsv,
  normalizeWebhookEvent,
  handleWebhookEvent,
};
