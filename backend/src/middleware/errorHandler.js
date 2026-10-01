import logger from '../utils/logger.js';
import { config } from '../config/env.js';

/**
 * Convert anything thrown downstream into a consistent JSON error body.
 * Operational AppErrors carry a meaningful status; anything else is a 500.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || err.status || 500;
  const isOperational = err.isOperational === true || statusCode < 500;

  const body = {
    error: {
      message: isOperational ? err.message : 'Internal server error',
      ...(err.details ? { details: err.details } : {}),
      ...(config.isProd ? {} : { stack: err.stack }),
    },
  };

  if (statusCode >= 500) {
    logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
  } else {
    logger.warn({ method: req.method, path: req.path, status: statusCode, message: err.message }, 'Request error');
  }

  res.status(statusCode).json(body);
}

/** 404 handler for unmatched routes. */
export function notFound(req, _res, next) {
  const err = new Error(`Not found: ${req.method} ${req.originalUrl}`);
  err.statusCode = 404;
  err.isOperational = true;
  next(err);
}
