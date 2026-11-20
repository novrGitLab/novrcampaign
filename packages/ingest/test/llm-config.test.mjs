import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Provider-flexibility seams inside `createLlm`: config-driven request shaping
 * (`jsonMode`, `reasoningContentAsText`), the single-model-string fallback, and
 * the structured per-call log.
 *
 * The OpenAI SDK is mocked ONCE at the module boundary (below, before the import
 * of the module under test), so NO network call is made and NO real provider is
 * contacted. We assert on the request payload the SDK was handed and on the log
 * records the client emitted.
 */

/** Every `{ baseURL, apiKey }` the SDK was constructed with, in order. */
const constructions = [];
/** Every request payload passed to `chat.completions.create`. */
const requests = [];
/** Programmable queue of behaviours for the next calls. */
let behaviours = [];

const JSON_OK = { choices: [{ message: { content: JSON.stringify({ ok: true }) }, finish_reason: 'stop' }] };

class MockOpenAI {
  constructor(opts) {
    constructions.push(opts);
    this.chat = {
      completions: {
        create: async (payload) => {
          requests.push(payload);
          const next = behaviours.shift() ?? { ok: true, response: JSON_OK };
          if (next.ok) return next.response;
          const err = new Error(next.message ?? 'boom');
          if (next.status !== undefined) err.status = next.status;
          throw err;
        },
      },
    };
  }
}

// Register the module mock before importing the module under test.
mock.module('openai', { defaultExport: MockOpenAI });

const { createLlm } = await import('../src/llm/index.js');

beforeEach(() => {
  constructions.length = 0;
  requests.length = 0;
  behaviours = [];
});

const baseConfig = (over = {}) => ({
  apiKey: 'test-key',
  baseUrl: 'https://example.com/v1',
  bulkModel: 'bulk',
  frontierModel: 'frontier',
  maxAttempts: 1,
  ...over,
});

const completeOnce = (llm, schema = { type: 'object' }) =>
  llm.complete({ tier: 'bulk', system: 's', prompt: 'p', schema });

describe('llm: jsonMode capability', () => {
  test('sends response_format json_object by default', async () => {
    const llm = createLlm(baseConfig());
    await completeOnce(llm);
    assert.deepEqual(requests[0].response_format, { type: 'json_object' });
  });

  test('omits response_format when jsonMode is false', async () => {
    const llm = createLlm(baseConfig({ jsonMode: false }));
    await completeOnce(llm);
    assert.equal('response_format' in requests[0], false, 'response_format must not be sent');
  });
});

describe('llm: reasoningContentAsText capability', () => {
  const reasoningResponse = {
    choices: [{ message: { content: '', reasoning_content: JSON.stringify({ ok: true }) }, finish_reason: 'stop' }],
  };

  test('does not read reasoning_content by default (content empty => throws)', async () => {
    const llm = createLlm(baseConfig());
    behaviours = [{ ok: true, response: reasoningResponse }];
    await assert.rejects(() => completeOnce(llm), /non-JSON output/);
  });

  test('reads reasoning_content only when explicitly opted in', async () => {
    const llm = createLlm(baseConfig({ reasoningContentAsText: true }));
    behaviours = [{ ok: true, response: reasoningResponse }];
    assert.deepEqual(await completeOnce(llm), { ok: true });
  });
});

describe('llm: single-model-string fallback', () => {
  test('falls back to the fallback model after primary exhaustion', async () => {
    const llm = createLlm(baseConfig({ maxAttempts: 1, fallbackModel: 'backup' }));
    behaviours = [
      { ok: false, message: 'primary down', status: 503 },
      { ok: true, response: JSON_OK },
    ];
    const result = await completeOnce(llm);

    assert.deepEqual(result, { ok: true });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].model, 'bulk');
    assert.equal(requests[1].model, 'backup');
  });

  test('does not fall back on a non-retryable error (e.g. 400)', async () => {
    const llm = createLlm(baseConfig({ maxAttempts: 3, fallbackModel: 'backup' }));
    behaviours = [{ ok: false, message: 'bad request', status: 400 }];
    await assert.rejects(() => completeOnce(llm), /bad request/);
    assert.equal(requests.length, 1, 'a 400 must not retry or fall back');
  });

  test('does not fall back when the fallback model equals the primary', async () => {
    const llm = createLlm(baseConfig({ maxAttempts: 1, fallbackModel: 'bulk' }));
    behaviours = [{ ok: false, message: 'down', status: 500 }];
    await assert.rejects(() => completeOnce(llm), /down/);
    assert.equal(requests.length, 1);
  });

  test('does not fall back when no fallback model is configured', async () => {
    const llm = createLlm(baseConfig({ maxAttempts: 1 }));
    behaviours = [{ ok: false, message: 'down', status: 500 }];
    await assert.rejects(() => completeOnce(llm));
    assert.equal(requests.length, 1);
  });
});

describe('llm: structured per-call log', () => {
  function captureLogger() {
    const info = [];
    const warn = [];
    return { logger: { info: (rec, msg) => info.push({ rec, msg }), warn: (rec, msg) => warn.push({ rec, msg }) }, info, warn };
  }

  test('emits one structured log per successful call, with usage when reported', async () => {
    const { logger, info } = captureLogger();
    const llm = createLlm(baseConfig({ provider: 'nvidia-nim', logger }));
    behaviours = [
      {
        ok: true,
        response: {
          choices: [{ message: { content: JSON.stringify({ ok: true }) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 22 },
        },
      },
    ];
    await completeOnce(llm);

    assert.equal(info.length, 1);
    const { rec, msg } = info[0];
    assert.equal(msg, 'LLM call');
    assert.equal(rec.provider, 'nvidia-nim');
    assert.equal(rec.model, 'bulk');
    assert.equal(rec.tier, 'bulk');
    assert.equal(rec.attempt, 1);
    assert.equal(rec.fallback, false);
    assert.equal(rec.finishReason, 'stop');
    assert.deepEqual(rec.usage, { promptTokens: 11, completionTokens: 22 });
    assert.equal(typeof rec.latencyMs, 'number');
  });

  test('omits usage when the provider does not report it', async () => {
    const { logger, info } = captureLogger();
    const llm = createLlm(baseConfig({ logger }));
    await completeOnce(llm);

    assert.equal(info.length, 1);
    assert.equal('usage' in info[0].rec, false, 'usage must be omitted, never fabricated');
  });

  test('logs the fallback attempt with fallback:true and warns on the swap', async () => {
    const { logger, info, warn } = captureLogger();
    const llm = createLlm(baseConfig({ maxAttempts: 1, fallbackModel: 'backup', logger }));
    behaviours = [
      { ok: false, message: 'primary down', status: 503 },
      { ok: true, response: JSON_OK },
    ];
    await completeOnce(llm);

    assert.equal(info.length, 1);
    assert.equal(info[0].rec.model, 'backup');
    assert.equal(info[0].rec.fallback, true);

    const swap = warn.find((w) => w.msg === 'LLM primary exhausted; trying fallback model');
    assert.ok(swap, 'a fallback warning must be logged');
    assert.equal(swap.rec.fromModel, 'bulk');
    assert.equal(swap.rec.toModel, 'backup');
    assert.equal(swap.rec.reason, 'LLM request failed: primary down');
  });
});

describe('llm: fallback target credentials', () => {
  test('reuses the primary credentials when no fallback override is given', async () => {
    const llm = createLlm(baseConfig({ maxAttempts: 1, fallbackModel: 'backup' }));
    behaviours = [
      { ok: false, message: 'down', status: 503 },
      { ok: true, response: JSON_OK },
    ];
    await completeOnce(llm);

    assert.equal(constructions.length, 1, 'same baseUrl/key must reuse one client');
  });

  test('an empty-string fallback override still reuses the primary credentials', async () => {
    const llm = createLlm(
      baseConfig({ maxAttempts: 1, fallbackModel: 'backup', fallbackBaseUrl: '', fallbackApiKey: '' }),
    );
    behaviours = [
      { ok: false, message: 'down', status: 503 },
      { ok: true, response: JSON_OK },
    ];
    await completeOnce(llm);

    assert.equal(constructions.length, 1, 'empty overrides must fall through to the primary client');
    assert.equal(requests[1].model, 'backup');
  });

  test('constructs a distinct client when a fallback baseUrl/key is given', async () => {
    const llm = createLlm(
      baseConfig({
        maxAttempts: 1,
        fallbackModel: 'backup',
        fallbackBaseUrl: 'https://integrate.api.nvidia.com/v1',
        fallbackApiKey: 'fallback-key',
      }),
    );
    behaviours = [
      { ok: false, message: 'down', status: 503 },
      { ok: true, response: JSON_OK },
    ];
    await completeOnce(llm);

    assert.equal(constructions.length, 2);
    assert.equal(constructions[1].baseURL, 'https://integrate.api.nvidia.com/v1');
    assert.equal(constructions[1].apiKey, 'fallback-key');
  });

  test('the SSRF guard also covers a fallback baseUrl', async () => {
    const llm = createLlm(
      baseConfig({ maxAttempts: 1, fallbackModel: 'backup', fallbackBaseUrl: 'http://169.254.169.254/v1' }),
    );
    behaviours = [{ ok: false, message: 'primary down', status: 503 }];
    // The fallback baseUrl is validated on the fallback attempt and must be refused.
    await assert.rejects(() => completeOnce(llm));
    assert.equal(constructions.length, 1, 'only the primary client may be constructed');
  });
});
