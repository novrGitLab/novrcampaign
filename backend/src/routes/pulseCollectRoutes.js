import { Router } from 'express';
import * as pulseController from '../controllers/pulseController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Vercel-cron collection endpoint, mounted at `/api/pulse/collect`.
 *
 * It deliberately sits OUTSIDE `requireAuth` (a cron has no session), mirroring
 * `/api/pulse/maintenance`: the route carries its own fail-closed guard inside
 * the controller (`runPulseCollection`), which accepts either the cron bearer
 * secret or an authenticated ADMIN session. There is no session-passthrough
 * middleware here on purpose — the controller is the single decision point.
 */
const router = Router();

router.post('/run', asyncHandler(pulseController.runPulseCollection));

export default router;
