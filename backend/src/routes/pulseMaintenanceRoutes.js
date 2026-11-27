import { Router } from 'express';
import * as pulseController from '../controllers/pulseController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Vercel-cron retention-purge endpoint, mounted at `/api/pulse/maintenance`.
 *
 * It deliberately sits OUTSIDE `requireAuth` (a cron has no session), mirroring
 * `/api/pulse/collect` and `/api/drive/maintenance`: the route carries its own
 * fail-closed guard inside the controller (`purgePulseRetention`), which accepts
 * either the cron bearer secret or an authenticated ADMIN session. There is no
 * session-passthrough middleware here on purpose — the controller is the single
 * decision point.
 */
const router = Router();

router.post('/purge', asyncHandler(pulseController.purgePulseRetention));

export default router;
