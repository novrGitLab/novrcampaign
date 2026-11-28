import crypto from 'node:crypto';

/**
 * Constant-time string comparison for secrets (cron bearer tokens, API keys).
 *
 * Unequal lengths return `false` (leaking only the length, never the contents);
 * equal lengths are compared with `crypto.timingSafeEqual`.
 */
export function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
