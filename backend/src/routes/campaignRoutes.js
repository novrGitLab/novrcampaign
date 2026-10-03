import { Router } from 'express';
import * as campaignController from '../controllers/campaignController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(campaignController.getCampaigns));
router.post('/', asyncHandler(campaignController.createCampaign));
router.get('/:id', asyncHandler(campaignController.getCampaign));
router.put('/:id', asyncHandler(campaignController.updateCampaign));
router.delete('/:id', asyncHandler(campaignController.deleteCampaign));

router.post('/:id/duplicate', asyncHandler(campaignController.duplicateCampaign));
router.post('/:id/resend-unsent', asyncHandler(campaignController.resendUnsent));
router.post('/:id/send', asyncHandler(campaignController.sendCampaign));
router.post('/:id/schedule', asyncHandler(campaignController.scheduleCampaign));
router.post('/:id/cancel', asyncHandler(campaignController.cancelCampaign));
router.post('/:id/test', asyncHandler(campaignController.testCampaign));
router.get('/:id/analytics', asyncHandler(campaignController.getCampaignAnalytics));

export default router;
