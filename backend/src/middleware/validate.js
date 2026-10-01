/**
 * Validate `req.body` (or `req.query`) against a Joi schema.
 *
 * @param {import('joi').Schema} schema
 * @param {'body'|'query'|'params'} [source]
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      presence: 'required',
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      const err = new Error('Validation failed');
      err.statusCode = 422;
      err.isOperational = true;
      err.details = details;
      return next(err);
    }

    req[source] = value;
    return next();
  };
}
