import { Router } from 'express';
import * as publishController from '../controllers/publishController.js';
import * as aiDraftController from '../controllers/aiDraftController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(publishController.listPublishItems));
router.post('/', asyncHandler(publishController.createManualItem));
router.post('/f7', asyncHandler(publishController.projectF7Items));
router.post('/from-event', asyncHandler(publishController.createItemFromEvent));
router.post('/ai-draft', asyncHandler(aiDraftController.aiDraft));
router.post('/:id/approve', asyncHandler(publishController.approvePublishItem));
router.post('/:id/withdraw', asyncHandler(publishController.withdrawPublishItem));
router.post('/:id/reject', asyncHandler(publishController.rejectPublishItem));
router.patch('/:id', asyncHandler(publishController.editPublishItem));

export default router;
