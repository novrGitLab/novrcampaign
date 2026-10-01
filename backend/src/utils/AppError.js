/**
 * Application-level error with an HTTP status code.
 * Thrown by controllers/services; normalized by the error handler middleware.
 */
export class AppError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   * @param {object} [details]
   */
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true;
    if (details) this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static BadRequest(message, details) {
    return new AppError(400, message || 'Bad request', details);
  }
  static Unauthorized(message) {
    return new AppError(401, message || 'Unauthorized');
  }
  static Forbidden(message) {
    return new AppError(403, message || 'Forbidden');
  }
  static NotFound(message) {
    return new AppError(404, message || 'Not found');
  }
  static Conflict(message, details) {
    return new AppError(409, message || 'Conflict', details);
  }
  static Unprocessable(message, details) {
    return new AppError(422, message || 'Unprocessable entity', details);
  }
  static TooManyRequests(message) {
    return new AppError(429, message || 'Too many requests');
  }
  static Internal(message) {
    return new AppError(500, message || 'Internal server error');
  }
}

// Named exports for a functional call style (`throw BadRequest(...)`)
export const BadRequest = AppError.BadRequest;
export const Unauthorized = AppError.Unauthorized;
export const Forbidden = AppError.Forbidden;
export const NotFound = AppError.NotFound;
export const Conflict = AppError.Conflict;
export const Unprocessable = AppError.Unprocessable;
export const TooManyRequests = AppError.TooManyRequests;
export const Internal = AppError.Internal;
