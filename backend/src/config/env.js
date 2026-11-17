import dotenv from 'dotenv';

dotenv.config();

function required(key, fallback) {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
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
    secret: required('JWT_SECRET', 'dev_secret_change_me'),
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
  // NVIDIA NIM exposes an OpenAI-compatible API, so the client uses the OpenAI
  // SDK pointed at the NIM base URL. Models are named per tier so the provider
  // stays swappable: change a model string, not the call sites.
  novrpulse: {
    llm: {
      // When no API key is set the client runs in an inert state so non-LLM code
      // and tests still work; a real call throws a clear error.
      apiKey: process.env.NVIDIA_API_KEY || '',
      baseUrl: process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1',

      // Cheap/fast tier: bulk tagging, entity extraction, classification.
      // Verified working on the NIM key 2026-11-09 (clean JSON via response_format).
      bulkModel: process.env.NP_BULK_MODEL || 'nvidia/nemotron-3.5-bolt-e4b',

      // Frontier tier: summaries, and F8 CyberIntel analysis. Defaults to the
      // same model until a verified larger one is chosen: most other NIM slugs
      // returned 410 (retired) or 404 (not entitled) on the current key, and
      // `nemotron-3.5-lightning` is a REASONING model whose text lands in
      // `reasoning_content`, not `content` — unusable for JSON extraction.
      frontierModel: process.env.NP_FRONTIER_MODEL || 'nvidia/nemotron-3.5-bolt-e4b',

      maxAttempts: asInt('NP_LLM_MAX_ATTEMPTS', 3),
      timeoutMs: asInt('NP_LLM_TIMEOUT_MS', 60_000),
      maxTokens: asInt('NP_LLM_MAX_TOKENS', 1024),
      temperature: Number(process.env.NP_LLM_TEMPERATURE ?? 0.2),
    },
  },
};

export default config;
