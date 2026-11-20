import OpenAI from 'openai';
import net from 'node:net';

import { assertFetchable, FetchError } from '../fetch/index.js';

/**
 * Provider-agnostic LLM client for the ingestion engine.
 *
 * OpenAI-compatible by design (NVIDIA NIM, OpenAI, Mistral, OpenRouter all
 * expose this shape), so the provider is a config choice:
 *   { apiKey, baseUrl, bulkModel, frontierModel, ... }
 *
 * Two tiers: a cheap `bulk` model for tagging/extraction, a `frontier` model for
 * summaries/analysis. Structured output only: every call passes a JSON schema and
 * the result is validated before it is returned.
 *
 * No app dependencies — config is injected at construction.
 */

export class LlmError extends Error {
  constructor(message, { status, raw } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.raw = raw;
  }
}

/** Validate a value against a minimal schema descriptor (type/required/enum/items). */
export function validateSchema(value, schema) {
  const errors = [];
  check(value, schema, '$', errors);
  return { ok: errors.length === 0, errors };
}

function check(value, schema, path, errors) {
  if (!schema) return;
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key}: missing required`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) check(value[key], sub, `${path}.${key}`, errors);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    if (schema.items) value.forEach((v, i) => check(v, schema.items, `${path}[${i}]`, errors));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') errors.push(`${path}: expected string`);
  } else if (schema.type === 'number') {
    if (typeof value !== 'number') errors.push(`${path}: expected number`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not one of ${JSON.stringify(schema.enum)}`);
  }
}

/** Strip a ```json ... ``` fence if the model wrapped its output. */
export function extractJson(text) {
  if (typeof text !== 'string') return text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return body.trim();
  return body.slice(start, end + 1);
}

/**
 * True only for a strictly loopback base URL. Used to scope the
 * `allowLocalBaseUrl` opt-in to loopback, so it can never permit a
 * link-local/metadata/private address (which the guard also reports as EBADIP).
 */
export function isLoopbackUrl(url) {
  let host;
  try {
    // IPv6 hosts keep their brackets in URL.hostname; strip them before matching.
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
 * Create an LLM client bound to a config object.
 *
 * @param {object} config
 * @param {string} config.apiKey
 * @param {string} [config.baseUrl]
 * @param {boolean} [config.allowLocalBaseUrl=false] opt in to a loopback base URL
 * @param {string} config.bulkModel
 * @param {string} config.frontierModel
 * @param {string} [config.provider] informational label only (never used to branch)
 * @param {string} [config.fallbackModel] one model-string swap attempted after primary exhaustion
 * @param {string} [config.fallbackBaseUrl] optional baseUrl for the fallback attempt
 * @param {string} [config.fallbackApiKey] optional apiKey for the fallback attempt
 * @param {boolean} [config.jsonMode=true] when false, do not send `response_format`
 * @param {boolean} [config.reasoningContentAsText=false] read `reasoning_content` ONLY when content is empty
 * @param {number} [config.maxAttempts=3]
 * @param {number} [config.timeoutMs=60000]
 * @param {number} [config.maxTokens=1024]
 * @param {number} [config.temperature=0.2]
 * @param {object} [config.logger]
 */
export function createLlm(config) {
  if (!config?.apiKey) throw new Error('createLlm: apiKey is required');
  const tierModel = { bulk: config.bulkModel, frontier: config.frontierModel };
  const provider = config.provider || 'openai-compatible';
  const jsonMode = config.jsonMode !== false; // default true

  // Clients are memoised per credential/baseUrl pair so the primary and an
  // optionally-different fallback target each keep a single SDK client.
  const clients = new Map();
  function clientKey({ baseUrl, apiKey }) {
    return `${baseUrl ?? ''}\u0000${apiKey ?? ''}`;
  }

  // Trust boundary: the base URL decides where the API key AND the full text of
  // crawled articles are POSTed. It is operator-configurable, so it is treated as
  // untrusted and re-validated with the same SSRF guard used for crawled feeds.
  // Loopback (e.g. a self-hosted Ollama at http://localhost:11434/v1) is allowed
  // ONLY when explicitly opted in via `allowLocalBaseUrl` — never by default.
  async function assertSafeBaseUrl(baseUrl) {
    if (!baseUrl) return; // no override: the SDK default (public OpenAI) is used
    try {
      await assertFetchable(baseUrl);
      return;
    } catch (err) {
      // Opt-in escape hatch: permit loopback ONLY. The guard collapses every
      // blocked address to EBADIP/EBADHOST, so narrow it here with an explicit
      // loopback check — never let a link-local/metadata/private IP through.
      if (config.allowLocalBaseUrl === true && err instanceof FetchError && isLoopbackUrl(baseUrl)) {
        return;
      }
      const error = new LlmError(`Invalid LLM baseUrl "${baseUrl}": ${err.message}`, { status: err.status });
      error.configError = true; // permanent: do not retry a bad configuration
      throw error;
    }
  }

  async function getClient({ baseUrl, apiKey }) {
    const key = clientKey({ baseUrl, apiKey });
    let client = clients.get(key);
    if (!client) {
      await assertSafeBaseUrl(baseUrl);
      client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: config.timeoutMs });
      clients.set(key, client);
    }
    return client;
  }

  /**
   * Shape one structured `complete()` call's per-call log record.
   * Usage is omitted (never fabricated) when the provider does not report it.
   */
  function logRecord({ model, tier, attempt, startedAt, fallback, finishReason, usage }) {
    const record = {
      provider,
      model,
      tier,
      attempt,
      latencyMs: Date.now() - startedAt,
      finishReason: finishReason ?? null,
      fallback,
    };
    if (usage) record.usage = usage;
    config.logger?.info?.(record, 'LLM call');
  }

  /** Extract prompt/completion token counts only when the provider supplied them. */
  function usageOf(res) {
    const promptTokens = res?.usage?.prompt_tokens;
    const completionTokens = res?.usage?.completion_tokens;
    if (typeof promptTokens !== 'number' && typeof completionTokens !== 'number') return undefined;
    return { promptTokens, completionTokens };
  }

  /** The assistant text, reading `reasoning_content` ONLY when explicitly opted in. */
  function assistantText(res) {
    const message = res?.choices?.[0]?.message ?? {};
    if (config.reasoningContentAsText === true && !message.content && message.reasoning_content) {
      return message.reasoning_content;
    }
    return message.content ?? '';
  }

  /** One request attempt against a specific model/credential target. */
  async function requestOnce({ model, tier, target, system, prompt, schema, maxTokens, attempt }) {
    const client = await getClient(target);
    const startedAt = Date.now();
    let res;
    try {
      const payload = {
        model,
        temperature: config.temperature ?? 0.2,
        max_tokens: maxTokens ?? config.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      };
      // `response_format` is sent only when the model is known to honour it; a
      // reasoning model that ignores it is opted out via `jsonMode: false`.
      if (jsonMode) payload.response_format = { type: 'json_object' };
      res = await client.chat.completions.create(payload);
    } catch (err) {
      throw new LlmError(`LLM request failed: ${err.message}`, { status: err.status ?? err.response?.status });
    }

    const text = assistantText(res);
    let parsed;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      throw new LlmError('LLM returned non-JSON output', { raw: text });
    }
    const { ok, errors } = validateSchema(parsed, schema);
    if (!ok) throw new LlmError(`LLM output failed schema: ${errors.join('; ')}`, { raw: text });
    logRecord({
      model,
      tier,
      attempt,
      startedAt,
      fallback: Boolean(target.fallback),
      finishReason: res.choices?.[0]?.finish_reason,
      usage: usageOf(res),
    });
    return parsed;
  }

  /**
   * Run a structured completion.
   * @returns {Promise<object>} validated parsed object
   */
  async function complete({ tier = 'bulk', system, prompt, schema, maxTokens }) {
    const model = tierModel[tier] ?? tierModel.bulk;
    if (!model) throw new LlmError(`No model configured for tier "${tier}"`);

    // Validate and construct (or reuse) the client before the retry loop, so a
    // bad baseUrl fails fast with its own error instead of being re-wrapped as a
    // transient request failure and retried.
    const primary = { baseUrl: config.baseUrl, apiKey: config.apiKey, fallback: false };
    await getClient(primary);

    const maxAttempts = config.maxAttempts ?? 3;
    let lastErr;
    let exhaustedRetryable = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await requestOnce({ model, tier, target: primary, system, prompt, schema, maxTokens, attempt });
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof LlmError &&
          !err.configError &&
          (err.status === undefined || err.status === 429 || err.status >= 500);
        if (!retryable) break; // definitive failure (400, non-JSON, schema): no retry, no fallback
        if (attempt >= maxAttempts) {
          exhaustedRetryable = true;
          break;
        }
        await new Promise((r) => setTimeout(r, Math.min(2000, 300 * 2 ** (attempt - 1))));
      }
    }

    // Fallback is a single model-string swap, not a provider abstraction: one
    // attempt against another model (same credentials/baseUrl unless the operator
    // supplied an override). Only after the primary is *exhausted* on a retryable
    // failure — never after a definitive error. No chain, no circuit breaker.
    if (exhaustedRetryable && config.fallbackModel && config.fallbackModel !== model) {
      config.logger?.warn?.(
        { fromModel: model, toModel: config.fallbackModel, reason: lastErr?.message },
        'LLM primary exhausted; trying fallback model',
      );
      try {
        return await requestOnce({
          model: config.fallbackModel,
          tier,
          target: {
            // `||` (not `??`): an empty-string override means "use the primary".
            baseUrl: config.fallbackBaseUrl || config.baseUrl,
            apiKey: config.fallbackApiKey || config.apiKey,
            fallback: true,
          },
          system,
          prompt,
          schema,
          maxTokens,
          attempt: maxAttempts + 1,
        });
      } catch (err) {
        lastErr = err;
      }
    }

    config.logger?.warn?.({ tier, model, message: lastErr?.message }, 'LLM call failed');
    throw lastErr;
  }

  return { complete, isConfigured: () => Boolean(config.apiKey), model: (tier) => tierModel[tier] };
}

export default { createLlm, validateSchema, extractJson, LlmError, isLoopbackUrl };
