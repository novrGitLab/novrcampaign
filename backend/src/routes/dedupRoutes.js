import { Router } from 'express';
import * as dedupController from '../controllers/dedupController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Deterministic blocking preview (free, no LLM, writes nothing).
router.get('/candidates', asyncHandler(dedupController.candidates));
// Block → confirm → record. Dry-run unless `{ "commit": true }`.
router.post('/run', asyncHandler(dedupController.runDedupRequest));

export default router;
