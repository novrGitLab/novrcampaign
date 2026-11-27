import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';
import ipaddr from 'ipaddr.js';

/**
 * Generic, dependency-free HTTP fetch for ingestion with security by default.
 *
 * Improvements over a naive fetch, and over the first NovrPulse version:
 *   - **SSRF guard.** Blocks private/loopback/link-local/metadata addresses and
 *     non-HTTP(S) schemes, and re-checks after DNS resolution so a hostname that
 *     resolves to an internal IP (DNS rebinding / misconfiguration) is refused.
 *   - **Size cap.** Reads the body with a running byte count and aborts past the
 *     cap, so a hostile or misconfigured endpoint cannot exhaust memory.
 *   - **Timeout.** Hard per-request abort.
 *   - **Bounded retries** with exponential backoff for transient failures.
 *   - **Identifiable User-Agent** so publishers can contact us.
 *
 * No app dependencies: the logger is injected.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_UA = 'NovrCollector/1.0 (+https://pulse.cybernovr.com)';

/** Error carrying an HTTP status so retry logic can classify it. */
export class FetchError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    if (code) this.code = code;
  }
}

/** True for IPv4/IPv6 addresses that must never be fetched (SSRF guard). */
export function isBlockedAddress(ip) {
  try {
    return ipaddr.process(ip).range() !== 'unicast';
  } catch {
    return true;
  }
}

const publicDispatcher = new Agent({
  connect: {
    lookup(host, options, callback) {
      dns.lookup(host, { family: options.family || 0, all: true }).then(records => {
        if (!records.length || records.some(record => isBlockedAddress(record.address))) {
          callback(new FetchError('Publisher address is unavailable', 400, 'EBADIP'));
          return;
        }
        if (options.all) callback(null, records);
        else callback(null, records[0].address, records[0].family);
      }, callback);
    },
  },
});

/** Validate a URL for fetching: scheme + hostname, and resolve to a safe IP. */
export async function assertFetchable(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new FetchError(`Invalid URL: ${url}`, 400, 'EINVALIDURL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FetchError(`Blocked scheme: ${parsed.protocol}`, 400, 'EBADSCHEME');
  }
  if (parsed.username || parsed.password) throw new FetchError('Publisher URL contains credentials', 400, 'EBADHOST');
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new FetchError('Blocked host: localhost', 400, 'EBADHOST');
  }
  // Literal IP: check directly. Hostname: resolve and check every answer.
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new FetchError(`Blocked IP: ${host}`, 400, 'EBADIP');
    return parsed;
  }
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new FetchError(`DNS lookup failed: ${host}`, 502, 'EDNS');
  }
  if (!addrs.length) throw new FetchError(`DNS returned no address: ${host}`, 502, 'EDNS');
  for (const a of addrs) {
    if (isBlockedAddress(a.address)) {
      throw new FetchError(`Blocked address for ${host}: ${a.address}`, 400, 'EBADIP');
    }
  }
  return parsed;
}

/** Read a response body as UTF-8 text, aborting past `maxBytes`. */
async function readCapped(res, maxBytes, url) {
  if (!res.body) return res.text ? res.text() : '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new FetchError(`Body exceeded ${maxBytes}B for ${url}`, 413, 'ETOOBIG');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Fetch text with security guards, timeout, size cap and bounded retries.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxBytes]
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.maxRedirects]
 * @param {string} [opts.userAgent]
 * @param {object}  [opts.logger]     injected logger (optional)
 * @param {boolean} [opts.allowPrivate] escape hatch for trusted internal use (default false)
 * @returns {Promise<{status:number, headers:Headers, body:string}>}
 */
export async function fetchText(url, opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    userAgent = DEFAULT_UA,
    logger,
    allowPrivate = false,
    allowedHost,
  } = opts;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (!allowPrivate) await assertFetchable(url);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Follow redirects manually, re-validating EVERY hop. `redirect: 'follow'`
        // would let a public host 302 us to an internal address (e.g. cloud
        // metadata) that the one-time pre-flight check never saw.
        let current = url;
        for (let hop = 0; ; hop += 1) {
          if (allowedHost && new URL(current).hostname.toLowerCase().replace(/^www\./, '') !== allowedHost) {
            throw new FetchError('Article moved outside its publisher', 400, 'EBADHOST');
          }
          const res = await fetch(current, {
            ...(!allowPrivate && { dispatcher: publicDispatcher }),
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: {
              'User-Agent': userAgent,
              Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*',
              'Accept-Language': 'en',
            },
          });

          const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
          if (location) {
            await res.body?.cancel?.();
            if (hop >= maxRedirects) {
              throw new FetchError(`GET ${url} exceeded ${maxRedirects} redirects`, 400, 'ETOOMANYREDIRECTS');
            }
            // Resolve against the current URL, then re-run the SSRF guard before
            // following, so no hop can point at a private/metadata address.
            const nextUrl = new URL(location, current);
            if (!allowPrivate) await assertFetchable(nextUrl);
            current = nextUrl.toString();
            continue;
          }

          if (!res.ok) throw new FetchError(`GET ${url} → ${res.status}`, res.status);

          const declared = Number(res.headers.get('content-length') || 0);
          if (declared > maxBytes) {
            throw new FetchError(`Body too large (${declared}B) for ${url}`, 413, 'ETOOBIG');
          }
          const body = await readCapped(res, maxBytes, current);
          return { status: res.status, headers: res.headers, body };
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new FetchError(`GET ${url} timed out after ${timeoutMs}ms`, 408, 'ETIMEDOUT');
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      const transient =
        err.status === 408 || err.status === 429 || (err.status >= 500 && err.status < 600);
      if (attempt >= maxAttempts || !transient) break;
      const wait = Math.min(2000, 250 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 100);
      logger?.warn?.({ url, attempt, status: err.status }, 'fetch retry');
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  logger?.warn?.({ url, status: lastErr?.status, message: lastErr?.message }, 'fetch failed');
  throw lastErr;
}

export default { fetchText, assertFetchable, isBlockedAddress, FetchError };
