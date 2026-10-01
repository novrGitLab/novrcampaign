import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { config } from './config/env.js';
import logger from './utils/logger.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import routes from './routes/index.js';

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

// Webhook routes must receive the raw body for signature verification
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

app.use(pinoHttp({ logger }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Trust the proxy header so req.ip is real behind Railway/Render/ALB
app.set('trust proxy', 1);

app.use('/api', apiLimiter);
app.use('/api', routes);

// In production the built frontend is served from this same process, so the
// internal tool deploys as a single unit (no separate static host needed).
// On Vercel the CDN serves dist instead — skip it there (VERCEL=1 is automatic).
if (config.isProd && !process.env.VERCEL) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');

  app.use(express.static(frontendDist));
  // SPA fallback — let the client router handle non-/api paths
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use(notFound);
app.use(errorHandler);

export default app;
