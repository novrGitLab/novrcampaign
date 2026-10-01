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
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
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
};

export default config;
