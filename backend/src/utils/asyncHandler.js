/**
 * Wrap an async route handler so a rejected promise is forwarded to `next`
 * instead of becoming an unhandled rejection that kills the process.
 *
 * Express 5 does this natively; Express 4 does not.
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<any>} fn
 * @returns {Function}
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;
