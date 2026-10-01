import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

/**
 * Basic abuse protection for the login endpoint (single-team gate, no registration).
 * The Plunk API budget is governed separately in utils/providerRateLimiter.js.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.env === 'test',
  message: { error: { message: 'Too many auth attempts, please try again later' } },
});

/** General API limiter (per IP). */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.env === 'test',
  message: { error: { message: 'Too many requests, please slow down' } },
});
