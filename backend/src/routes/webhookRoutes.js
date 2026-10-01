import { Router } from 'express';
import * as webhookController from '../controllers/webhookController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Plunk posts events here; signature verification happens in the controller
router.post('/plunk', asyncHandler(webhookController.handlePlunkWebhook));

export default router;
