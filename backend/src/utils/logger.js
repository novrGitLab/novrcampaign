import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  base: { service: 'novrpulse-backend' },
  // Never log credentials, session cookies, or tokens.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'req.query.token',
      'req.query',
      'password',
      'passwordHash',
      '*.password',
      '*.token',
      'token',
    ],
    censor: '[redacted]',
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
});

export default logger;
