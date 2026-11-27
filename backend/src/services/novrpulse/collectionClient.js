import crypto from 'node:crypto';
import net from 'node:net';

import { assertFetchable } from '@novr/ingest';
import config from '../../config/env.js';

/**
 * Pulse-side client for the stateless collector's frozen HMAC v1 API.
 *
 * This module is the CLIENT counterpart of `novr-collection/src/auth/hmac.js`.
 * It deliberately re-implements the canonical-string/signature algorithm rather
 * than importing the collector's code: Pulse depends on the *wire contract*,
 * not on the collector's module. A test (`novrpulseCollectionClient.test.mjs`)
 * imports the collector's pure `verifyRequest` and asserts byte-for-byte
 * agreement, so the two signers can never silently drift.
 *
 * Scheme (see docs/decisions/adr-0001-collector-hmac-auth.md):
 *   headers  X-Consumer-Id, X-Key-Id, X-Date, X-Nonce, X-Content-SHA256, X-Signature
 *   canonical METHOD \n PATH \n CANONICAL_QUERY \n X-Consumer-Id \n X-Key-Id \n
 *             X-Date \n X-Nonce \n X-Content-SHA256   (no trailing newline)
 *   X-Signature       base64url(HMAC-SHA256(secret, canonicalString))
 *   X-Content-SHA256  base64url(SHA-256(rawBody))  (empty-body hash for GET)
 *
 * Secrets are read from the environment by NAME at call time and are never
 * logged, returned or embedded in an error.
 */

/** The empty-body SHA-256, base64url. Used for GET requests with no body. */
export const EMPTY_BODY_SHA256 = crypto.createHash('sha256').update('').digest('base64url');

/** Error carrying the collector's `{ error: { code, message } }` envelope. */
export class CollectionApiError extends Error {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {number} [opts.status]  HTTP status
   * @param {string} [opts.code]    machine code from the error envelope
   * @param {unknown} [opts.raw]    parsed response body (for diagnostics; no secrets)
   */
  constructor(message, { status, code, raw } = {}) {
    super(message);
    this.name = 'CollectionApiError';
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

/** Error for a local/transport failure before a response was parsed. */
export class CollectionTransportError extends Error {
  constructor(message, { cause, configError = false } = {}) {
    super(message);
    this.name = 'CollectionTransportError';
    this.cause = cause;
    this.configError = configError;
  }
}

/**
 * Percent-decode a query component, never throwing on malformed input.
 * @param {string} value
 * @returns {string}
 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Build the canonical query string: percent-decoded then re-encoded with
 * `encodeURIComponent`, sorted by key then value, `&`-joined.
 *
 * A literal `+` is preserved (NOT treated as a space) — callers MUST send
 * spaces as `%20`. This matches `novr-collection/src/auth/hmac.js` exactly.
 *
 * @param {string} [rawQuery] the raw query string (with or without leading '?')
 * @returns {string}
 */
export function canonicalQuery(rawQuery) {
  if (!rawQuery) return '';
  const query = rawQuery.startsWith('?') ? rawQuery.slice(1) : rawQuery;
  if (query === '') return '';

  const params = [];
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const idx = pair.indexOf('=');
    const rawKey = idx === -1 ? pair : pair.slice(0, idx);
    const rawValue = idx === -1 ? '' : pair.slice(idx + 1);
    params.push([encodeURIComponent(safeDecode(rawKey)), encodeURIComponent(safeDecode(rawValue))]);
  }

  params.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return params.map(([k, v]) => `${k}=${v}`).join('&');
}

/**
 * Build the canonical string that is signed. Order and separators are frozen.
 *
 * @param {object} parts
 * @param {string} parts.method
 * @param {string} parts.path       pathname only, e.g. '/v1/runs/abc'
 * @param {string} [parts.query]    raw query string
 * @param {string} parts.consumerId
 * @param {string} parts.keyId
 * @param {string} parts.date
 * @param {string} parts.nonce
 * @param {string} parts.contentSha256
 * @returns {string}
 */
export function buildCanonicalString({ method, path, query = '', consumerId, keyId, date, nonce, contentSha256 }) {
  return [
    String(method).toUpperCase(),
    path,
    canonicalQuery(query),
    consumerId,
    keyId,
    date,
    nonce,
    contentSha256,
  ].join('\n');
}

/**
 * base64url(SHA-256(body)). Accepts a Buffer or string.
 * @param {Buffer|string} body
 * @returns {string}
 */
export function contentHash(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '', 'utf8');
  return crypto.createHash('sha256').update(buf).digest('base64url');
}

/**
 * base64url HMAC-SHA256 over the canonical string.
 * @param {string} secret
 * @param {string} canonicalString
 * @returns {string}
 */
export function computeSignature(secret, canonicalString) {
  return crypto.createHmac('sha256', secret).update(canonicalString, 'utf8').digest('base64url');
}

/**
 * Build the signed headers for one request.
 *
 * @param {object} params
 * @param {string} params.method
 * @param {string} params.path
 * @param {string} [params.query]
 * @param {Buffer|string} [params.body]   raw body (empty for GET)
 * @param {object} params.credentials     `{ consumerId, keyId, secret }`
 * @param {number} [params.nowMs]         signing clock (tests inject a fixed one)
 * @returns {Record<string,string>} the six contract headers
 */
export function signRequest({ method, path, query = '', body = '', credentials, nowMs = Date.now() }) {
  const { consumerId, keyId, secret } = credentials;
  if (!secret) throw new CollectionTransportError('collection secret is not configured', { configError: true });

  const date = new Date(nowMs).toISOString();
  const nonce = crypto.randomBytes(16).toString('base64url');
  const bodyHash = contentHash(body);
  const canonical = buildCanonicalString({ method, path, query, consumerId, keyId, date, nonce, contentSha256: bodyHash });
  const signature = computeSignature(secret, canonical);

  return {
    'X-Consumer-Id': consumerId,
    'X-Key-Id': keyId,
    'X-Date': date,
    'X-Nonce': nonce,
    'X-Content-SHA256': bodyHash,
    'X-Signature': signature,
  };
}

/** True only for a strictly loopback host — the scoped opt-in for a local collector. */
function isLoopbackUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;
  const v = net.isIP(host);
  if (v === 4) return host.split('.')[0] === '127';
  if (v === 6) return host.startsWith('::ffff:') && host.slice(7).split('.')[0] === '127';
  return false;
}

/**
 * Resolve the collector credentials from env by NAME. The secret value is never
 * logged, returned in errors or exposed outside this module.
 *
 * @param {object} [cfg] config override (defaults to `config.novrpulse.collection`)
 * @returns {{ consumerId:string, keyId:string, secret:string }}
 */
export function resolveCredentials(cfg = config.novrpulse?.collection) {
  if (!cfg) throw new CollectionTransportError('novrpulse.collection is not configured', { configError: true });
  const secret = process.env[cfg.apiKey] ?? '';
  return { consumerId: cfg.consumerId, keyId: cfg.keyId, secret };
}

/**
 * Create the collector client bound to a config block.
 *
 * @param {object} [cfg] `config.novrpulse.collection`
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]  HTTP layer (tests inject a stub)
 * @param {() => number} [deps.now]        signing clock (tests inject a fixed one)
 * @param {object} [deps.logger]
 * @returns {{ startRun:Function, getRun:Function, getRunItems:Function }}
 */
export function createCollectionClient(cfg = config.novrpulse?.collection, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const logger = deps.logger;

  if (!cfg) throw new CollectionTransportError('novrpulse.collection is not configured', { configError: true });
  // Trust boundary: the base URL is operator-configured but is still validated
  // (scheme + SSRF guard) because it decides where the signing headers go. The
  // collector is normally a private service, so loopback is permitted here.
  const base = cfg.baseUrl;
  let parsedBase;
  try {
    parsedBase = new URL(base);
  } catch {
    throw new CollectionTransportError(`Invalid collection baseUrl`, { configError: true });
  }
  if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
    throw new CollectionTransportError('collection baseUrl must be http(s)', { configError: true });
  }
  // A non-loopback base must also not resolve to a private/metadata address.
  // That check is async (DNS), so it is performed per request in `send` — a
  // loopback base (the common local/private-service case) is exempted there.

  /**
   * One signed request. Resolves the path against the configured base, signs it,
   * sends it, and translates the error envelope into a typed error.
   *
   * @param {string} method
   * @param {string} pathname   e.g. '/v1/collections'
   * @param {object} [opts]
   * @param {Record<string,string|number|undefined>} [opts.query]
   * @param {unknown} [opts.body]
   * @returns {Promise<object>} the parsed JSON body
   */
  async function send(method, pathname, { query, body } = {}) {
    const url = new URL(pathname, base);
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    // Sign the query exactly as it is sent on the wire: `rawQuery` is set as the
    // URL's search AND passed to the signer, so the two can never disagree.
    const rawQuery = buildRawQuery(query);
    url.search = rawQuery;
    const path = url.pathname;

    const credentials = resolveCredentials(cfg);
    if (!credentials.secret) {
      throw new CollectionTransportError(`collection secret env ${cfg.apiKey} is not set`, { configError: true });
    }

    const headers = signRequest({
      method,
      path,
      query: rawQuery,
      body: method === 'GET' ? '' : bodyText,
      credentials,
      nowMs: now(),
    });

    try {
      // The base URL is OPERATOR-configured (NP_COLLECTION_BASE_URL), not user
      // input. Loopback is always allowed. A private/internal address (e.g. a
      // sibling Docker container) is allowed ONLY when the operator explicitly
      // opts in via NP_COLLECTION_ALLOW_INTERNAL_BASE_URL=true; otherwise the
      // SSRF guard applies. This never relaxes guards for request-derived URLs.
      const allowInternal = cfg.allowInternalBaseUrl === true;
      if (!isLoopbackUrl(base) && !allowInternal) await assertFetchable(base);
    } catch (err) {
      throw new CollectionTransportError(`Unsafe collection baseUrl: ${err.message}`, { cause: err, configError: true });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let res;
    try {
      res = await fetchImpl(url.toString(), {
        method,
        headers: { ...headers, ...(bodyText ? { 'Content-Type': 'application/json' } : {}) },
        body: bodyText || undefined,
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err?.name === 'AbortError';
      logger?.warn?.({ method, path, status: aborted ? 'timeout' : 'error' }, 'collection request failed');
      throw new CollectionTransportError(
        aborted ? `collection ${method} ${path} timed out after ${cfg.timeoutMs}ms` : `collection ${method} ${path} failed: ${err.message}`,
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
    }

    const parsed = await safeJson(res);
    if (!res.ok) {
      const code = parsed?.error?.code ?? `HTTP_${res.status}`;
      const message = parsed?.error?.message ?? `collection ${method} ${path} → ${res.status}`;
      // Never surface a secret/signature: `parsed` is the server's error envelope.
      throw new CollectionApiError(message, { status: res.status, code, raw: parsed });
    }
    return parsed ?? {};
  }

  return {
    /**
     * POST /v1/collections — start a collection run (scope runs:create).
     * @param {object} [params]
     * @param {string[]} [params.sourceIds]
     * @param {number} [params.maxAgeDays]
     * @returns {Promise<{ runId:string, status:string }>}
     */
    async startRun({ sourceIds, maxAgeDays } = {}) {
      const body = { fullText: true };
      if (sourceIds !== undefined) body.sourceIds = sourceIds;
      if (maxAgeDays !== undefined) body.maxAgeDays = maxAgeDays;
      const out = await send('POST', '/v1/collections', { body });
      return { runId: out.runId, status: out.status };
    },

    /**
     * GET /v1/runs/:runId — run status envelope (scope runs:read).
     * @param {string} runId
     * @returns {Promise<object>}
     */
    async getRun(runId) {
      return send('GET', `/v1/runs/${encodeURIComponent(runId)}`);
    },

    /**
     * GET /v1/runs/:runId/items — one page of items (scope runs:read).
     * @param {string} runId
     * @param {string|null} [cursor]
     * @param {number} [limit]
     * @returns {Promise<{ items:Array<object>, nextCursor:string|null, complete:boolean }>}
     */
    async getRunItems(runId, cursor = null, limit) {
      const query = {};
      if (cursor) query.cursor = cursor;
      if (limit !== undefined) query.limit = limit;
      return send('GET', `/v1/runs/${encodeURIComponent(runId)}/items`, { query });
    },
  };
}

/**
 * Turn a query object into the raw query string that will be sent AND signed.
 * Values are stringified; spaces are encoded as `%20` (never `+`) so the
 * canonical form (percent-decode then encodeURIComponent) round-trips.
 *
 * @param {Record<string,string|number|undefined>} [query]
 * @returns {string}
 */
function buildRawQuery(query) {
  if (!query) return '';
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}

/** Parse a response body as JSON without throwing on an empty/invalid body. */
async function safeJson(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default { createCollectionClient, signRequest, buildCanonicalString, canonicalQuery, contentHash, computeSignature, resolveCredentials, EMPTY_BODY_SHA256, CollectionApiError, CollectionTransportError };
