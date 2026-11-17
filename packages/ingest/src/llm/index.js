import OpenAI from 'openai';

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
 * Create an LLM client bound to a config object.
 *
 * @param {object} config
 * @param {string} config.apiKey
 * @param {string} [config.baseUrl]
 * @param {string} config.bulkModel
 * @param {string} config.frontierModel
 * @param {number} [config.maxAttempts=3]
 * @param {number} [config.timeoutMs=60000]
 * @param {number} [config.maxTokens=1024]
 * @param {number} [config.temperature=0.2]
 * @param {object} [config.logger]
 */
export function createLlm(config) {
  if (!config?.apiKey) throw new Error('createLlm: apiKey is required');
  const tierModel = { bulk: config.bulkModel, frontier: config.frontierModel };
  let client = null;

  function getClient() {
    if (!client) client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, timeout: config.timeoutMs });
    return client;
  }

  /**
   * Run a structured completion.
   * @returns {Promise<object>} validated parsed object
   */
  async function complete({ tier = 'bulk', system, prompt, schema, maxTokens }) {
    const model = tierModel[tier] ?? tierModel.bulk;
    if (!model) throw new LlmError(`No model configured for tier "${tier}"`);

    let lastErr;
    for (let attempt = 1; attempt <= (config.maxAttempts ?? 3); attempt += 1) {
      try {
        let res;
        try {
          res = await getClient().chat.completions.create({
            model,
            temperature: config.temperature ?? 0.2,
            max_tokens: maxTokens ?? config.maxTokens ?? 1024,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
          });
        } catch (err) {
          throw new LlmError(`LLM request failed: ${err.message}`, { status: err.status ?? err.response?.status });
        }

        const text = res.choices?.[0]?.message?.content ?? '';
        let parsed;
        try {
          parsed = JSON.parse(extractJson(text));
        } catch {
          throw new LlmError('LLM returned non-JSON output', { raw: text });
        }
        const { ok, errors } = validateSchema(parsed, schema);
        if (!ok) throw new LlmError(`LLM output failed schema: ${errors.join('; ')}`, { raw: text });
        return parsed;
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof LlmError && (err.status === undefined || err.status === 429 || err.status >= 500);
        if (attempt >= (config.maxAttempts ?? 3) || !retryable) break;
        await new Promise((r) => setTimeout(r, Math.min(2000, 300 * 2 ** (attempt - 1))));
      }
    }
    config.logger?.warn?.({ tier, model, message: lastErr?.message }, 'LLM call failed');
    throw lastErr;
  }

  return { complete, isConfigured: () => Boolean(config.apiKey), model: (tier) => tierModel[tier] };
}

export default { createLlm, validateSchema, extractJson, LlmError };
