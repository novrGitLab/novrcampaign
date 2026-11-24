import { Router } from 'express';
import * as publishController from '../controllers/publishController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(publishController.listPublishItems));
router.post('/f7', asyncHandler(publishController.projectF7Items));
router.post('/from-event', asyncHandler(publishController.createItemFromEvent));
router.post('/:id/approve', asyncHandler(publishController.approvePublishItem));
router.post('/:id/withdraw', asyncHandler(publishController.withdrawPublishItem));
router.post('/:id/reject', asyncHandler(publishController.rejectPublishItem));
router.patch('/:id', asyncHandler(publishController.editPublishItem));

export default router;
