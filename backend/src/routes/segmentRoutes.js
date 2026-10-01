import { Router } from 'express';
import * as segmentController from '../controllers/segmentController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(segmentController.getSegments));
router.post('/', asyncHandler(segmentController.createSegment));
router.get('/:id', asyncHandler(segmentController.getSegment));
router.patch('/:id', asyncHandler(segmentController.updateSegment));
router.delete('/:id', asyncHandler(segmentController.deleteSegment));

router.get('/:id/contacts', asyncHandler(segmentController.getSegmentContacts));
router.post('/:id/members', asyncHandler(segmentController.addSegmentMembers));
router.delete('/:id/members', asyncHandler(segmentController.removeSegmentMembers));
router.post('/:id/refresh', asyncHandler(segmentController.refreshSegment));
router.post('/:id/compute', asyncHandler(segmentController.computeSegment));

export default router;
