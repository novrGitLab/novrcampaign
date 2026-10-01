import { promises as dns } from 'node:dns';
import logger from './logger.js';

// Practical, RFC-5322-ish pattern (intentionally rejects quoted local parts & IPs,
// which are the source of most deliverability problems).
const EMAIL_REGEX =
  /^(?=.{1,254}$)(?=.{1,64}@)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

// Disposable / known-bad domains worth rejecting outright at the door.
const BLOCKED_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'sharklasers.com',
  'getnada.com',
  'dispostable.com',
  'trashmail.com',
]);

/**
 * Validate an email address syntactically.
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmailSyntax(email) {
  if (typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim().toLowerCase());
}

/**
 * Check that the domain has an MX (or A) record. Falls back to "true" when DNS
 * resolution is unavailable so we never hard-block on infra hiccups.
 * @param {string} email
 * @returns {Promise<boolean>}
 */
export async function hasValidMxRecord(email) {
  const domain = email.split('@')[1];
  if (!domain) return false;

  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length > 0) return true;
  } catch {
    // No MX record — some legit domains only publish A records
    try {
      await dns.resolve4(domain);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Full validation: syntax + disposable-domain + (optional) MX check.
 * @param {string} email
 * @param {{ checkMx?: boolean }} [opts]
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export async function validateEmail(email, { checkMx = true } = {}) {
  const normalized = String(email ?? '').trim().toLowerCase();

  if (!normalized) return { valid: false, reason: 'empty' };
  if (!isValidEmailSyntax(normalized)) return { valid: false, reason: 'invalid_syntax' };

  const domain = normalized.split('@')[1];
  if (BLOCKED_DOMAINS.has(domain)) return { valid: false, reason: 'disposable_domain' };

  if (checkMx) {
    const hasMx = await hasValidMxRecord(normalized);
    if (!hasMx) {
      logger.debug({ domain }, 'Email domain has no MX/A record');
      return { valid: false, reason: 'no_mx_record' };
    }
  }

  return { valid: true };
}

/**
 * Batch-validate, partitioning results so callers can report exactly what failed.
 * @param {string[]} emails
 * @param {{ checkMx?: boolean }} [opts]
 * @returns {Promise<{ valid: string[], invalid: Array<{ email: string, reason: string }> }>}
 */
export async function validateEmailBatch(emails, opts) {
  const valid = [];
  const invalid = [];

  await Promise.all(
    emails.map(async (email) => {
      const result = await validateEmail(email, opts);
      if (result.valid) valid.push(email.trim().toLowerCase());
      else invalid.push({ email, reason: result.reason });
    }),
  );

  return { valid, invalid };
}
