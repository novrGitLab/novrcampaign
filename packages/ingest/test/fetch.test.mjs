import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { fetchText, FetchError, isBlockedAddress, assertFetchable } from '../src/fetch/index.js';

describe('fetch: SSRF guards', () => {
  test('blocks private, loopback, link-local and metadata IPv4 ranges', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.5.5', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
      assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
    }
  });
  test('blocks private/link-local IPv6 and v4-mapped', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1']) {
      assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
    }
  });
  test('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111']) {
      assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
    }
  });

  test('assertFetchable rejects non-http(s) schemes', async () => {
    await assert.rejects(() => assertFetchable('file:///etc/passwd'), (e) => e instanceof FetchError && e.code === 'EBADSCHEME');
    await assert.rejects(() => assertFetchable('gopher://x'), (e) => e.code === 'EBADSCHEME');
  });
  test('assertFetchable rejects localhost and literal private IPs', async () => {
    await assert.rejects(() => assertFetchable('http://localhost/x'), (e) => e.code === 'EBADHOST');
    await assert.rejects(() => assertFetchable('http://127.0.0.1/x'), (e) => e.code === 'EBADIP');
    await assert.rejects(() => assertFetchable('http://169.254.169.254/latest/meta-data'), (e) => e.code === 'EBADIP');
  });
});

// fetchText uses the global fetch; stub it, and bypass DNS by using a literal
// public IP so assertFetchable passes without network.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function streamedResponse(bytes, { contentLength } = {}) {
  const headers = new Map();
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  let emitted = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => headers.get(k) ?? null },
    body: {
      getReader() {
        return {
          async read() {
            if (emitted >= bytes) return { done: true, value: undefined };
            const chunk = new Uint8Array(Math.min(64 * 1024, bytes - emitted));
            emitted += chunk.length;
            return { done: false, value: chunk };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
    },
  };
}

describe('fetch: size cap and content-length', () => {
  test('rejects an oversized declared Content-Length', async () => {
    globalThis.fetch = async () => streamedResponse(0, { contentLength: 10 * 1024 * 1024 });
    await assert.rejects(
      () => fetchText('https://8.8.8.8/feed', { maxBytes: 1024, maxAttempts: 1, allowPrivate: false }),
      (e) => e instanceof FetchError && e.status === 413,
    );
  });
  test('aborts mid-stream when the body exceeds the cap', async () => {
    globalThis.fetch = async () => streamedResponse(4 * 1024 * 1024);
    await assert.rejects(
      () => fetchText('https://8.8.8.8/feed', { maxBytes: 1024, maxAttempts: 1 }),
      (e) => e.status === 413,
    );
  });
  test('returns a within-cap body', async () => {
    const payload = 'hello';
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => payload,
    });
    const res = await fetchText('https://8.8.8.8/feed', { maxBytes: 1024, maxAttempts: 1 });
    assert.equal(res.body, payload);
  });
});
