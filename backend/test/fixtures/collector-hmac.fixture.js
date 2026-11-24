/**
 * Pinned copy of the collector's HMAC verifier (source of truth: novr-collection
 * repo, src/auth/hmac.js). Update deliberately if the wire contract ever changes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Pulse's collector client (`backend/src/services/novrpulse/collectionClient.js`)
 * is the SIGNER; the collector holds the VERIFIER. `novrpulseCollectionClient.
 * test.mjs` imports this module to assert the two canonical strings agree
 * byte-for-byte (the "anti-desync guard"). The collector was lifted out of this
 * monorepo into the standalone `novr-collection` repo, so this pinned copy keeps
 * the guard running here without a cross-repo import.
 *
 * This is a byte-for-byte copy of the pure-function module — it has NO external
 * dependencies (only `node:crypto`), so it works fully standalone. If the wire
 * contract changes, update this fixture AND the standalone collector together.
 */

import crypto from 'node:crypto';

/** The empty-body SHA-256, base64url. Used for GET/DELETE with no body. */
export const EMPTY_BODY_SHA256 = crypto.createHash('sha256').update('').digest('base64url');

/** Headers required on every signed request. */
export const REQUIRED_HEADERS = [
  'x-consumer-id',
  'x-key-id',
  'x-date',
  'x-nonce',
  'x-content-sha256',
  'x-signature',
];

/** Error carrying an HTTP status, so middleware can map it to a response. */
export class HmacError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {string} code
   */
  constructor(message, status, code) {
    super(message);
    this.name = 'HmacError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Build the canonical query string: percent-encoded, sorted by key then value.
 * Duplicate keys are preserved. An absent/empty query yields ''.
 *
 * CONTRACT for the caller's signer: each component is percent-decoded and then
 * re-encoded with `encodeURIComponent`. Percent-decoding ONLY is applied — a
 * literal `+` stays `+` (it is NOT treated as a space). Callers MUST therefore
 * encode spaces as `%20`, never `+`, or their signature will not match.
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
    // Decode then re-encode so equivalent encodings canonicalise identically.
    const key = encodeURIComponent(safeDecode(rawKey));
    const value = encodeURIComponent(safeDecode(rawValue));
    params.push([key, value]);
  }

  params.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));

  return params.map(([k, v]) => `${k}=${v}`).join('&');
}

/**
 * Percent-decode a query component, falling back to the raw value on malformed
 * input (never throws).
 *
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
 * Build the full canonical string that gets signed.
 *
 * @param {object} parts
 * @param {string} parts.method
 * @param {string} parts.path      pathname only, e.g. '/v1/runs/abc'
 * @param {string} [parts.query]   raw query string
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
 * Compute the base64url HMAC-SHA256 signature over a canonical string.
 *
 * @param {string} secret
 * @param {string} canonicalString
 * @returns {string}
 */
export function computeSignature(secret, canonicalString) {
  return crypto.createHmac('sha256', secret).update(canonicalString, 'utf8').digest('base64url');
}

/**
 * Constant-time comparison of two base64url signatures.
 * Returns false (never throws) when lengths differ or inputs are not strings.
 *
 * @param {string} provided
 * @param {string} expected
 * @returns {boolean}
 */
export function safeEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Compute base64url(SHA-256(body)). Accepts a Buffer or string.
 *
 * @param {Buffer|string} body
 * @returns {string}
 */
export function contentHash(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '', 'utf8');
  return crypto.createHash('sha256').update(buf).digest('base64url');
}

/**
 * Verify the signature and integrity of an incoming request.
 *
 * Does NOT consult the key registry or the nonce store — those concerns belong
 * to the middleware, which resolves the secret and records the nonce. This
 * function is pure with respect to its inputs so it is trivially testable.
 *
 * @param {object} input
 * @param {string} input.method
 * @param {string} input.path
 * @param {string} [input.query]
 * @param {Buffer|string} [input.rawBody]
 * @param {Record<string,string|undefined>} input.headers  lower-cased header keys
 * @param {string} input.secret
 * @param {number} [input.skewSeconds=300]
 * @param {number} [input.nowMs=Date.now()]
 * @returns {{ consumerId: string, keyId: string, date: string, nonce: string }}
 * @throws {HmacError}
 */
export function verifyRequest({ method, path, query = '', rawBody = Buffer.alloc(0), headers, secret, skewSeconds = 300, nowMs = Date.now() }) {
  const consumerId = headers['x-consumer-id'];
  const keyId = headers['x-key-id'];
  const date = headers['x-date'];
  const nonce = headers['x-nonce'];
  const contentSha256 = headers['x-content-sha256'];
  const signature = headers['x-signature'];

  for (const name of REQUIRED_HEADERS) {
    if (!headers[name]) {
      throw new HmacError(`Missing required header: ${name}`, 401, 'EMISSINGHEADER');
    }
  }

  // ── Clock skew: X-Date must parse and be within ±skewSeconds of now. ────────
  const signedAt = Date.parse(date);
  if (Number.isNaN(signedAt)) {
    throw new HmacError('Invalid X-Date', 401, 'EBADDATE');
  }
  const drift = Math.abs(nowMs - signedAt);
  if (drift > skewSeconds * 1000) {
    throw new HmacError('X-Date outside allowed clock skew', 401, 'ESKEW');
  }

  // ── Body integrity: X-Content-SHA256 must match the raw body. ───────────────
  const actualHash = contentHash(rawBody);
  if (!safeEqual(contentSha256, actualHash)) {
    throw new HmacError('Content hash mismatch', 401, 'EBODYHASH');
  }

  // ── Signature over the canonical string. ────────────────────────────────────
  const canonical = buildCanonicalString({
    method,
    path,
    query,
    consumerId,
    keyId,
    date,
    nonce,
    contentSha256,
  });
  const expected = computeSignature(secret, canonical);
  if (!safeEqual(signature, expected)) {
    throw new HmacError('Invalid signature', 401, 'EBADSIGNATURE');
  }

  return { consumerId, keyId, date, nonce };
}

export default { verifyRequest, buildCanonicalString, canonicalQuery, computeSignature, contentHash, safeEqual, HmacError, EMPTY_BODY_SHA256 };
