import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

/**
 * SSRF guard on the operator-configurable LLM base URL.
 *
 * The OpenAI SDK is mocked ONCE at the module boundary (below, before the import
 * of the module under test), so NO network call is made and NO real provider is
 * contacted. We assert on the `baseURL` the SDK was constructed with — that is
 * the value the SSRF guard protects.
 */

const REQUEST_OK = { choices: [{ message: { content: JSON.stringify({ ok: true }) } }] };

/** Every `{ baseURL, apiKey, ... }` the SDK was constructed with, in order. */
const constructions = [];

class MockOpenAI {
  constructor(opts) {
    constructions.push(opts);
    this.chat = { completions: { create: async () => REQUEST_OK } };
  }
}

// Register the module mock before importing the module under test.
mock.module('openai', { defaultExport: MockOpenAI });

const { createLlm, LlmError, isLoopbackUrl } = await import('../src/llm/index.js');

beforeEach(() => {
  constructions.length = 0;
});

const baseConfig = (over = {}) => ({
  apiKey: 'test-key',
  bulkModel: 'bulk',
  frontierModel: 'frontier',
  maxAttempts: 1,
  ...over,
});

const completeOnce = (llm, schema = { type: 'object' }) =>
  llm.complete({ tier: 'bulk', system: 's', prompt: 'p', schema });

describe('llm: baseUrl SSRF guard', () => {
  test('constructs and completes against a valid public https baseUrl', async () => {
    const llm = createLlm(baseConfig({ baseUrl: 'https://integrate.api.nvidia.com/v1' }));
    const result = await completeOnce(llm);

    assert.deepEqual(result, { ok: true });
    assert.equal(constructions.length, 1);
    assert.equal(constructions[0].baseURL, 'https://integrate.api.nvidia.com/v1');
  });

  test('rejects a non-http(s) scheme such as file://', async () => {
    const llm = createLlm(baseConfig({ baseUrl: 'file:///etc/passwd' }));
    await assert.rejects(
      () => completeOnce(llm),
      (e) => e instanceof LlmError && e.configError === true && /Invalid LLM baseUrl/.test(e.message),
    );
    assert.equal(constructions.length, 0, 'client must not be constructed for a bad baseUrl');
  });

  test('rejects a cloud metadata / link-local baseUrl', async () => {
    const llm = createLlm(baseConfig({ baseUrl: 'http://169.254.169.254/v1' }));
    await assert.rejects(
      () => completeOnce(llm),
      (e) => e instanceof LlmError && e.configError === true && /169\.254\.169\.254/.test(e.message),
    );
    assert.equal(constructions.length, 0);
  });

  test('rejects a private RFC1918 baseUrl', async () => {
    const llm = createLlm(baseConfig({ baseUrl: 'http://10.0.0.5/v1' }));
    await assert.rejects(
      () => completeOnce(llm),
      (e) => e instanceof LlmError && e.configError === true,
    );
    assert.equal(constructions.length, 0);
  });

  test('rejects a loopback baseUrl by default', async () => {
    const llm = createLlm(baseConfig({ baseUrl: 'http://localhost:11434/v1' }));
    await assert.rejects(
      () => completeOnce(llm),
      (e) => e instanceof LlmError && e.configError === true && /localhost/.test(e.message),
    );
    assert.equal(constructions.length, 0);
  });

  test('accepts a loopback baseUrl when allowLocalBaseUrl is set', async () => {
    const llm = createLlm(baseConfig({ baseUrl: 'http://localhost:11434/v1', allowLocalBaseUrl: true }));
    const result = await completeOnce(llm);

    assert.deepEqual(result, { ok: true });
    assert.equal(constructions.length, 1);
    assert.equal(constructions[0].baseURL, 'http://localhost:11434/v1');
  });

  test('does not allow a metadata address even with allowLocalBaseUrl', async () => {
    const llm = createLlm(baseConfig({ baseUrl: 'http://169.254.169.254/v1', allowLocalBaseUrl: true }));
    // Opting in to loopback must NOT open the metadata / link-local hole.
    await assert.rejects(
      () => completeOnce(llm),
      (e) => e instanceof LlmError && e.configError === true,
    );
    assert.equal(constructions.length, 0);
  });

  test('a valid client is constructed once and reused across completions', async () => {
    const llm = createLlm(baseConfig({ baseUrl: 'https://example.com/v1' }));
    await completeOnce(llm);
    await completeOnce(llm);

    assert.equal(constructions.length, 1, 'client should be memoised');
  });
});

describe('llm: isLoopbackUrl only matches loopback', () => {
  test('matches loopback hosts', () => {
    for (const u of ['http://localhost:11434/v1', 'http://127.0.0.1:8080/v1', 'http://127.5.5.5/v1', 'http://[::1]:11434/v1']) {
      assert.equal(isLoopbackUrl(u), true, `${u} should be loopback`);
    }
  });

  test('does not match metadata, private, or public hosts', () => {
    for (const u of [
      'http://169.254.169.254/v1',
      'http://10.0.0.5/v1',
      'http://192.168.1.1/v1',
      'https://example.com/v1',
      'not a url',
    ]) {
      assert.equal(isLoopbackUrl(u), false, `${u} must not count as loopback`);
    }
  });
});

describe('llm: contract preserved', () => {
  test('createLlm still throws when apiKey is missing (unconfigured path)', () => {
    assert.throws(() => createLlm({ bulkModel: 'b', frontierModel: 'f' }), /apiKey is required/);
  });

  test('returns the { complete, isConfigured, model } shape', () => {
    const llm = createLlm(baseConfig({ baseUrl: 'https://example.com/v1' }));
    assert.equal(typeof llm.complete, 'function');
    assert.equal(typeof llm.isConfigured, 'function');
    assert.equal(typeof llm.model, 'function');
    assert.equal(llm.isConfigured(), true);
    assert.equal(llm.model('bulk'), 'bulk');
  });

  test('no baseUrl override is passed through (SDK default endpoint)', async () => {
    const llm = createLlm(baseConfig({ baseUrl: undefined }));
    await completeOnce(llm);

    assert.equal(constructions.length, 1);
    assert.equal(constructions[0].baseURL, undefined);
  });
});
