import { Router } from 'express';
import { config } from '../config/env.js';
import { prisma } from '../utils/prisma.js';

const router = Router();

/**
 * GET /api/health — liveness + dependency probes.
 */
router.get('/', async (_req, res) => {
  const checks = { api: 'ok' };

  const [db] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`]);

  checks.database = db.status === 'fulfilled' ? 'ok' : 'degraded';
  checks.plunk = config.plunk.apiKey ? 'configured' : 'not-configured';

  const healthy = checks.database === 'ok';

  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    env: config.env,
    uptime: Math.round(process.uptime()),
    checks,
    time: new Date().toISOString(),
  });
});

export default router;

