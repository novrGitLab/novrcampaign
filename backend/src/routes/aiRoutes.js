import { Router } from 'express';
import * as aiDraftController from '../controllers/aiDraftController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// The AI editorial layer (recommend), mounted at /api/ai behind requireAuth.
const router = Router();

router.post('/recommend', asyncHandler(aiDraftController.recommend));

export default router;
