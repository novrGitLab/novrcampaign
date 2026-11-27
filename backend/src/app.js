import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { config } from './config/env.js';
import logger from './utils/logger.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import routes from './routes/index.js';
import publicRoutes from './routes/publicRoutes.js';

const app = express();

app.disable('x-powered-by');
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Email previews render remote images (e.g. the CyberNovr logo URL),
    // including inside sandboxed srcDoc iframes that inherit this policy.
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'https:'],
      },
    },
  }),
);

// Webhook routes must receive the raw body for signature verification. Capture
// the raw bytes for /api/webhooks REGARDLESS of content type, before the JSON
// parser runs, so an HMAC covers the exact bytes Plunk signed. The JSON parser
// still runs for every other route below.
app.use('/api/webhooks', express.raw({ type: '*/*', limit: '2mb' }));

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
    limit: '2mb',
  }),
);

app.use(
  cors({
    origin: config.frontendUrl.split(',').map((o) => o.trim()),
    credentials: true,
  }),
);

app.use(pinoHttp({ logger, serializers: { req: req => ({ method: req.method, path: req.url?.split('?')[0] }), res: res => ({ statusCode: res.statusCode }) } }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && (req.cookies.pulse_staff || req.cookies.pulse_access_request || req.headers.origin)) {
    const origins = config.frontendUrl.split(',').map(value => value.trim());
    if (!origins.includes(req.headers.origin) || req.get('sec-fetch-site') === 'cross-site') return res.sendStatus(403);
  }
  return next();
});
app.use('/api/public', apiLimiter);
app.use(publicRoutes);

app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});


app.use('/api', apiLimiter);
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
