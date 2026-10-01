import logger from './logger.js';

/**
 * Sleep helper.
 * @param {number} ms
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Compute an exponential-backoff delay with full jitter.
 * @param {number} attempt  1-based attempt number
 * @param {number} baseMs   base delay (default 500ms)
 * @param {number} capMs    upper bound (default 32s)
 * @returns {number} delay in ms
 */
export function backoffDelay(attempt, baseMs = 500, capMs = 32_000) {
  const exp = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(Math.random() * exp);
}

/**
 * Retry an async operation with exponential backoff + jitter.
 *
 * Retries are triggered when:
 *   - `retryOn` returns true for the thrown error, or
 *   - the error is a 429 / 5xx (via `status` property), or
 *   - it's a transient network error (ETIMEDOUT, ECONNRESET, EAI_AGAIN).
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=5]
 * @param {(err: Error) => boolean} [opts.retryOn]
 * @param {string} [opts.label]  logged label for observability
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { maxAttempts = 5, retryOn, label = 'operation' } = {}) {
  const transientCodes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE']);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await fn();
      if (attempt > 1) logger.info({ label, attempt }, 'Recovered after retry');
      return result;
    } catch (err) {
      lastError = err;

      const status = err.status ?? err.response?.status ?? err.statusCode;
      const isRetryable =
        (typeof retryOn === 'function' && retryOn(err)) ||
        status === 429 ||
        (status >= 500 && status <= 599) ||
        transientCodes.has(err.code);

      if (!isRetryable || attempt === maxAttempts) {
        throw err;
      }

      const delay = backoffDelay(attempt);

      // Honour a server-sent Retry-After when present
      const retryAfter = err.headers?.['retry-after'] ?? err.response?.headers?.['retry-after'];
      const waitMs = retryAfter ? Math.min(Number(retryAfter) * 1000, 60_000) : delay;

      logger.warn(
        { label, attempt, maxAttempts, status, code: err.code, waitMs, message: err.message },
        'Retrying after backoff',
      );

      await sleep(waitMs);
    }
  }

  throw lastError;
}
