import dotenv from 'dotenv';

dotenv.config();

function required(key, fallback) {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Known placeholder/example secrets that must never be accepted as real in
 * production. Compared case-insensitively after trimming.
 */
const INSECURE_SECRETS = new Set([
  'dev_secret_change_me',
  'replace_with_a_long_random_string',
  'changeme',
  'secret',
  'your_secret_here',
]);

/**
 * Validate a secret and fail closed in production.
 *
 * Rejects (in production) a secret that is missing, whitespace-padded, too
 * short, low-entropy, or a known placeholder. The value is **never** included
 * in the thrown message or logs — only the variable name and the requirement.
 *
 * Exported so it can be unit-tested in isolation (the frozen `config` object
 * makes the module hard to re-import with different env values).
 *
 * @param {string} key
 * @param {object} [opts]
 * @param {number} [opts.minLength=32]
 * @param {string} [opts.fallback]   dev-only fallback used when not in production
 * @param {boolean} [opts.allowInsecure]  when true (non-production), the
 *   fallback is permitted and a warning is logged
 * @param {boolean} [opts.warn]      set false to suppress the dev warning (tests)
 * @returns {string}
 */
export function validatedSecret(key, { minLength = 32, fallback = '', allowInsecure = false, warn = true } = {}) {
  const raw = process.env[key];
  const present = typeof raw === 'string' && raw.trim() !== '';

  if (!present) {
    if (allowInsecure) {
      if (warn) {
        // eslint-disable-next-line no-console
        console.error(
          `[config] ${key} is not set; using an insecure development fallback. This is refused in production.`,
        );
      }
      return fallback;
    }
    throw new Error(`Missing required environment variable: ${key} (must be set in production)`);
  }

  // Reject whitespace padding: a padded value is a misconfiguration and would
  // otherwise pass the length/entropy checks with a guessable core.
  const value = raw;
  if (value !== value.trim()) {
    throw new Error(`${key} must not contain leading or trailing whitespace`);
  }

  const distinct = new Set(value).size;
  const placeholder = INSECURE_SECRETS.has(value.toLowerCase());

  if (placeholder || value.length < minLength || distinct < 5) {
    if (allowInsecure) {
      if (warn) {
        // eslint-disable-next-line no-console
        console.error(
          `[config] ${key} is weak (placeholder, shorter than ${minLength} chars, or low entropy). Allowed only outside production.`,
        );
      }
      return value;
    }
    // Deliberately does not echo the offending value.
    throw new Error(
      `${key} is insecure: it must be at least ${minLength} characters, avoid known placeholders, and not be repeated characters`,
    );
  }

  return value;
}

function asInt(key, fallback) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function asExpiry(key, fallback) {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) return raw;

  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`${key} must be a positive whole number of days (e.g. 7 or 7d), got "${raw}"`);
  }
  return `${days}d`;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: asInt('PORT', 4000),

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  // SQLite keeps the internal deployment dependency-free (a single file)
  databaseUrl: required('DATABASE_URL', 'file:./dev.db'),

  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  jwt: {
    secret: validatedSecret('JWT_SECRET', {
      minLength: 32,
      fallback: 'dev_secret_change_me',
      allowInsecure: process.env.NODE_ENV !== 'production',
    }),
    expiresIn: asExpiry('JWT_EXPIRES_IN', '7d'),
  },

  // ── Plunk (email provider) ─────────────────────────────────────────────────
  // Plunk Cloud uses https://next-api.useplunk.com; a self-hosted deployment
  // points this at its own domain instead.
  plunk: {
    apiKey: process.env.PLUNK_API_KEY || '',
    baseUrl: process.env.PLUNK_BASE_URL || 'https://next-api.useplunk.com',
    // Secret expected in the `x-plunk-webhook-secret` header on
    // /api/webhooks/plunk (Plunk webhooks come from a Workflow Webhook step)
    webhookSecret: process.env.PLUNK_WEBHOOK_SECRET || '',
    rateLimit: {
      max: asInt('PLUNK_RATE_LIMIT_MAX', 480),
      windowMs: asInt('PLUNK_RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000),
    },
  },

  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

  // Contact sync batching (Plunk bulk-subscribe accepts up to 1,000 IDs)
  syncBatchSize: asInt('SYNC_BATCH_SIZE', 500),

  // ── Encrypted file drive ────────────────────────────────────────────────────
  // Password-only private drive. Files are encrypted at rest in an R2 bucket;
  // the DB and bucket hold ciphertext only. See README "File drive" section.
  drive: {
    // When false the drive routes 404 and new sessions are refused; existing
    // files stay intact and become readable again when re-enabled.
    enabled: (process.env.DRIVE_ENABLED ?? 'false').toLowerCase() === 'true',

    // 32-byte Key Encryption Key (base64) — wraps per-file data keys. Losing it
    // is survivable ONLY if the recovery key is available.
    kek: process.env.DRIVE_KEK || '',

    // Drive-wide recovery key (base58). Also wraps every data key so files can
    // be recovered if the KEK is lost. Printed once at setup; keep it offline.
    recoveryKey: process.env.DRIVE_RECOVERY_KEY || '',

    // Separate secret for signing short-lived per-file download tokens.
    tokenSecret: process.env.DRIVE_TOKEN_SECRET || '',

    // Bearer secret Vercel sends to the cron maintenance endpoint.
    cronSecret: process.env.CRON_SECRET || '',

    // Server-side salt for HMAC-hashing client IPs in the audit log.
    ipHashSalt: process.env.DRIVE_IP_SALT || '',

    sessionHours: asInt('DRIVE_SESSION_HOURS', 2),
    maxFailedAttempts: asInt('DRIVE_MAX_FAILED_ATTEMPTS', 5),
    lockoutMinutes: asInt('DRIVE_LOCKOUT_MINUTES', 15),
    minPasswordLength: asInt('DRIVE_MIN_PASSWORD_LENGTH', 16),

    maxFileBytes: asInt('DRIVE_MAX_FILE_BYTES', 500 * 1024 * 1024),
    maxTotalBytes: asInt('DRIVE_MAX_TOTAL_BYTES', 2 * 1024 * 1024 * 1024),
    chunkBytes: asInt('DRIVE_CHUNK_BYTES', 4 * 1024 * 1024),

    auditRetentionDays: asInt('DRIVE_AUDIT_RETENTION_DAYS', 90),
    partialUploadHours: asInt('DRIVE_PARTIAL_UPLOAD_HOURS', 24),

    // Cloudflare R2 (S3-compatible). Empty values put storage in an inert state
    // where non-storage code can still be exercised and unit-tested.
    r2: {
      accountId: process.env.R2_ACCOUNT_ID || '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      bucket: process.env.R2_BUCKET || '',
      endpoint: process.env.R2_ENDPOINT || '',
    },
  },

  // ── NovrPulse understanding layer (LLM) ──────────────────────────────────────
  // Any OpenAI-compatible endpoint works (NVIDIA NIM, OpenAI, Mistral, OpenRouter,
  // a self-hosted Ollama). `NP_LLM_*` are the current names; the legacy
  // NVIDIA/NIM vars are kept as fallbacks so existing deployments keep working.
  // `provider` is an informational label only — all targets speak the same
  // OpenAI-compatible protocol, so no call site branches on it.
  novrpulse: {
    llm: {
      // When no API key is set the client runs in an inert state so non-LLM code
      // and tests still work; a real call throws a clear error.
      apiKey: process.env.NP_LLM_API_KEY || process.env.NVIDIA_API_KEY || '',
      baseUrl: process.env.NP_LLM_BASE_URL || process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      provider: process.env.NP_LLM_PROVIDER || 'nvidia-nim',

      // Cheap/fast tier: bulk tagging, entity extraction, classification.
      // Verified working on the NIM key 2026-11-09 (clean JSON via response_format).
      bulkModel: process.env.NP_BULK_MODEL || 'nvidia/nemotron-3.5-bolt-e4b',

      // Frontier tier: summaries, and F8 CyberIntel analysis. Defaults to the
      // same model until a verified larger one is chosen: most other NIM slugs
      // returned 410 (retired) or 404 (not entitled) on the current key, and
      // `nemotron-3.5-lightning` is a REASONING model whose text lands in
      // `reasoning_content`, not `content` — unusable for JSON extraction.
      frontierModel: process.env.NP_FRONTIER_MODEL || 'nvidia/nemotron-3.5-bolt-e4b',

      // Optional single fallback: on primary retry exhaustion the client makes
      // ONE attempt against this model (same credentials unless overridden).
      fallbackModel: process.env.NP_LLM_FALLBACK_MODEL || '',
      fallbackBaseUrl: process.env.NP_LLM_FALLBACK_BASE_URL || '',
      fallbackApiKey: process.env.NP_LLM_FALLBACK_API_KEY || '',

      // Some models ignore `response_format` (a reasoning model returns its text
      // in `reasoning_content`). Set false to stop sending it. Reading
      // `reasoning_content` as the answer is a SEPARATE explicit opt-in — never
      // silent — and the schema/JSON validation remains the correctness backstop.
      jsonMode: (process.env.NP_LLM_JSON_MODE ?? 'true').toLowerCase() !== 'false',
      reasoningContentAsText: (process.env.NP_LLM_REASONING_AS_TEXT ?? 'false').toLowerCase() === 'true',

      // Allow a loopback baseUrl (e.g. a self-hosted Ollama at
      // http://localhost:11434/v1). Off by default; loopback is the ONLY case the
      // opt-in permits (metadata/link-local/private addresses stay blocked).
      allowLocalBaseUrl: (process.env.NP_LLM_ALLOW_LOCAL_BASE_URL ?? 'false').toLowerCase() === 'true',

      maxAttempts: asInt('NP_LLM_MAX_ATTEMPTS', 3),
      timeoutMs: asInt('NP_LLM_TIMEOUT_MS', 60_000),
      maxTokens: asInt('NP_LLM_MAX_TOKENS', 1024),
      temperature: Number(process.env.NP_LLM_TEMPERATURE ?? 0.2),
    },

    // ── NovrPulse collector client (stateless novr-collection service) ─────────
    // Pulse calls the collector over its frozen HMAC v1 API to trigger runs and
    // page results. The secret is referenced by env var NAME (`apiKey`) and
    // resolved at call time; it is never logged. An empty `baseUrl`/secret puts
    // the client in an inert state so tests and non-collector code still work.
    collection: {
      // ── Cutover switch (Phase 4) ──────────────────────────────────────────
      // Selects exactly ONE collection path per run:
      //   false (default) → in-app collector (`collectAndStore` in ingest.js)
      //   true            → pull from the standalone collector over HMAC v1
      //                     (`pullItemsAndCreateEvents` in collectionPull.js)
      // Off by default: with no config change the system behaves EXACTLY as
      // before the cutover. Flipping it to `true` is the only change needed to
      // switch the path. Tests may override the resolved value at the call site.
      enabled: (process.env.NP_COLLECTION_ENABLED ?? 'false').toLowerCase() === 'true',

      baseUrl: process.env.NP_COLLECTION_BASE_URL || 'http://localhost:4100',
      consumerId: process.env.NP_COLLECTION_CONSUMER_ID || '',
      keyId: process.env.NP_COLLECTION_KEY_ID || '',
      // NAME of the env var holding the shared HMAC secret (never the value).
      apiKey: 'NP_COLLECTION_SECRET',
      timeoutMs: asInt('NP_COLLECTION_TIMEOUT_MS', 15_000),

      // Bearer secret Vercel sends to the collection cron endpoint
      // (/api/pulse/collect/run). When empty the secret path is closed and
      // only an ADMIN session may trigger a run — fail closed either way.
      cronSecret: process.env.NP_COLLECT_CRON_SECRET || '',

      // Paging/polling knobs for pullItemsAndCreateEvents.
      pageSize: asInt('NP_COLLECTION_PAGE_SIZE', 100),
      maxPolls: asInt('NP_COLLECTION_MAX_POLLS', 60),
      pollIntervalMs: asInt('NP_COLLECTION_POLL_INTERVAL_MS', 1000),
    },
  },
};

export default config;
