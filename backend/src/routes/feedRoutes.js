import { Router } from 'express';
import * as feedController from '../controllers/feedController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(feedController.getFeedEntries));
router.post('/', asyncHandler(feedController.createFeedEntry));
router.put('/:id', asyncHandler(feedController.updateFeedEntry));
router.delete('/:id', asyncHandler(feedController.deleteFeedEntry));

export default router;
