import { Router } from 'express';
import * as briefingController from '../controllers/briefingController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Supporting records (§05 events / §06 opportunities / §02 forum topics).
// Registered before the `/:id` routes so "supporting" is never read as an id.
router.get('/supporting/events', asyncHandler(briefingController.listSupportingEvents));
router.post('/supporting/events', asyncHandler(briefingController.createSupportingEvent));
router.patch('/supporting/events/:id', asyncHandler(briefingController.updateSupportingEvent));
router.delete('/supporting/events/:id', asyncHandler(briefingController.deleteSupportingEvent));

router.get('/supporting/opportunities', asyncHandler(briefingController.listOpportunities));
router.post('/supporting/opportunities', asyncHandler(briefingController.createOpportunity));
router.patch('/supporting/opportunities/:id', asyncHandler(briefingController.updateOpportunity));
router.delete('/supporting/opportunities/:id', asyncHandler(briefingController.deleteOpportunity));

router.get('/supporting/forum-topics', asyncHandler(briefingController.listForumTopics));
router.post('/supporting/forum-topics', asyncHandler(briefingController.createForumTopic));
router.patch('/supporting/forum-topics/:id', asyncHandler(briefingController.updateForumTopic));
router.delete('/supporting/forum-topics/:id', asyncHandler(briefingController.deleteForumTopic));

// Briefing CRUD.
router.get('/', asyncHandler(briefingController.listBriefings));
router.post('/', asyncHandler(briefingController.createBriefing));
router.get('/:id', asyncHandler(briefingController.getBriefing));
// Preview the assembled briefing rendered through the email template. Registered
// on the literal `/preview` suffix so it can never be read as a briefing id.
router.post('/:id/preview', asyncHandler(briefingController.previewBriefing));
// Publish → Preview → Send. Renders the SAME email the preview shows, then
// sends it (a test to one address, or a campaign to a segment) and records a
// publication snapshot. Registered on the literal `/publish` suffix.
router.post('/:id/publish', asyncHandler(briefingController.publishBriefing));
router.patch('/:id', asyncHandler(briefingController.updateBriefing));
router.delete('/:id', asyncHandler(briefingController.deleteBriefing));

// Section state.
router.patch('/:id/sections/:functionId', asyncHandler(briefingController.updateSection));

// Section items. Register `reorder` before the `:itemId` delete so the literal
// path wins, and keep the verbs distinct.
router.post('/:id/sections/:functionId/items', asyncHandler(briefingController.attachSectionItem));
router.patch('/:id/sections/:functionId/items/reorder', asyncHandler(briefingController.reorderSectionItems));
router.delete('/:id/sections/:functionId/items/:itemId', asyncHandler(briefingController.detachSectionItem));

// Manual editorial authoring is RETIRED: the Desk only attaches existing items,
// and editorial content is created in the Editorial Canvas. The route stays
// registered so the endpoint remains documented and discoverable, but the handler
// refuses every call with 410 Gone (AUTHOR_MOVED_TO_CANVAS).
router.post('/:id/sections/:functionId/author', asyncHandler(briefingController.authorSectionItem));

router.patch('/:id/sections/:functionId/items/:itemId/photo', asyncHandler(briefingController.updatePhoto));

export default router;
