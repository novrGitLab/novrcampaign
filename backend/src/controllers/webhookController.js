import crypto from 'node:crypto';
import { config } from '../config/env.js';
import logger from '../utils/logger.js';
import { handleWebhookEvent } from '../services/emailService.js';

/**
 * Verify the webhook came from our own Plunk workflow.
 *
 * Plunk posts from a Workflow Webhook step; we accept either a shared secret in
 * the `x-plunk-webhook-secret` header or an HMAC-SHA256 signature over the raw
 * body (`x-plunk-signature`) when the workflow is configured to sign payloads.
 *
 * @param {object} req
 * @returns {boolean}
 */
function verifyWebhook(req) {
  const secret = config.plunk.webhookSecret;

  // No secret configured → accept, but fail loudly in production logs
  if (!secret) {
    if (config.isProd) logger.error('PLUNK_WEBHOOK_SECRET not set — accepting unverified webhook');
    return true;
  }

  const headerSecret = req.headers['x-plunk-webhook-secret'];
  if (headerSecret && headerSecret.length === secret.length) {
    if (crypto.timingSafeEqual(Buffer.from(headerSecret), Buffer.from(secret))) return true;
  }

  const signature = req.headers['x-plunk-signature'];
  if (signature && req.rawBody) {
    const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    const provided = signature.replace(/^sha256=/, '');
    if (provided.length === expected.length) {
      return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    }
  }

  return false;
}

/**
 * POST /api/webhooks/plunk
 *
 * Plunk posts events as JSON, e.g.
 * { "event": "email.bounce", "email": "bad@example.com", "bounceType": "Permanent", "campaignId": "cmp_..." }
 *
 * In the thin BFF these are observability + alerting only — Plunk itself
 * already suppresses hard bounces/complaints and honors unsubscribes.
 */
export async function handlePlunkWebhook(req, res) {
  if (!verifyWebhook(req)) {
    logger.warn({ ip: req.ip }, 'Rejected webhook with invalid signature');
    return res.status(401).json({ error: { message: 'Invalid webhook signature' } });
  }

  const payload = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];

  for (const event of payload) {
    try {
      results.push(await handleWebhookEvent(event));
    } catch (err) {
      logger.error({ err: err.message, event }, 'Webhook event handling failed');
      results.push({ handled: false, error: err.message });
    }
  }

  // Always 200 so Plunk doesn't retry a permanently-bad payload forever
  return res.status(200).json({ received: results.length, results });
}
