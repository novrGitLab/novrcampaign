import { Router } from 'express';
import * as aiJudgementController from '../controllers/aiJudgementController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(aiJudgementController.list));
router.post('/:id/accept', asyncHandler(aiJudgementController.accept));
router.post('/:id/reject', asyncHandler(aiJudgementController.reject));

export default router;
