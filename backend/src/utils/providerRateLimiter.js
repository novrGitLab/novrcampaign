import { config } from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * In-memory fixed-window rate limiter for outbound Plunk calls.
 *
 * Redis was dropped in the thin-BFF refactor — a single process instance
 * doesn't need a shared counter. If this ever scales horizontally, move the
 * counter back to Redis without changing the call sites.
 */
const { max, windowMs } = config.plunk.rateLimit;

let windowId = 0;
let used = 0;
let lockoutUntil = 0;

function currentWindow() {
  return Math.floor(Date.now() / windowMs);
}

/**
 * Consume one unit of budget. Returns how long to wait when exhausted.
 * @returns {{ waitMs: number, remaining: number }}
 */
export function consumeBudget() {
  const now = Date.now();

  if (lockoutUntil > now) {
    return { waitMs: lockoutUntil - now, remaining: 0 };
  }

  const id = currentWindow();
  if (id !== windowId) {
    windowId = id;
    used = 0;
  }

  used += 1;
  const remaining = Math.max(0, max - used);

  if (used <= max) {
    return { waitMs: 0, remaining };
  }

  const windowEnd = (id + 1) * windowMs;
  const waitMs = windowEnd - now + 250;
  logger.warn({ used, max, waitMs }, 'Provider rate budget exhausted — backing off');
  return { waitMs, remaining: 0 };
}

/**
 * Record a provider-imposed lockout (429 with Retry-After) so the process
 * pauses instead of hammering a throttled endpoint.
 * @param {number} retryAfterSeconds
 */
export function setLockout(retryAfterSeconds) {
  const secs = Math.min(Math.max(1, Math.ceil(retryAfterSeconds)), 300);
  lockoutUntil = Date.now() + secs * 1000;
  logger.warn({ secs }, 'Provider lockout recorded');
}

/**
 * @returns {number} ms until the current lockout expires (0 if free)
 */
export function getLockoutMs() {
  const now = Date.now();
  return lockoutUntil > now ? lockoutUntil - now : 0;
}

export const rateBudget = { max, windowMs };
