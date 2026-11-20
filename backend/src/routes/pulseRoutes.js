import { Router } from 'express';
import * as pulseController from '../controllers/pulseController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/events', asyncHandler(pulseController.listPulseEvents));
router.get('/events/:id', asyncHandler(pulseController.getPulseEvent));
router.patch('/events/:id/review', asyncHandler(pulseController.reviewPulseEvent));

export default router;
