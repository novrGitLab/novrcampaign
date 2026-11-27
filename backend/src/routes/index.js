import newsroomMedia from './newsroomMedia.js';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';
import contactRoutes from './contactRoutes.js';
import campaignRoutes from './campaignRoutes.js';
import templateRoutes from './templateRoutes.js';
import segmentRoutes from './segmentRoutes.js';
import webhookRoutes from './webhookRoutes.js';
import feedRoutes from './feedRoutes.js';
import publishRoutes from './publishRoutes.js';
import pulseRoutes from './pulseRoutes.js';
import pulseCollectRoutes from './pulseCollectRoutes.js';
import pulseMaintenanceRoutes from './pulseMaintenanceRoutes.js';
import briefingRoutes from './briefingRoutes.js';
import aiJudgementRoutes from './aiJudgementRoutes.js';
import aiRoutes from './aiRoutes.js';
import dedupRoutes from './dedupRoutes.js';

const router = Router();

// Public
router.use('/health', healthRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/auth', authRoutes);
router.use('/media', newsroomMedia);

// Pulse collection trigger — cron/ADMIN-guarded INSIDE the controller, so it
// must be mounted BEFORE the `requireAuth`-wrapped `/pulse` mount below (a
// Vercel cron has no session). Its own guard is the single decision point.
router.use('/pulse/collect', pulseCollectRoutes);

// Pulse retention purge — same guard shape as the collection trigger, mounted
// OUTSIDE `requireAuth` for the same reason (a cron has no session).
router.use('/pulse/maintenance', pulseMaintenanceRoutes);

// Authenticated dashboard endpoints (these carry the Plunk secret server-side)
router.use('/contacts', requireAuth, contactRoutes);
router.use('/campaigns', requireAuth, campaignRoutes);
router.use('/templates', requireAuth, templateRoutes);
router.use('/segments', requireAuth, segmentRoutes);
router.use('/feed', requireAuth, feedRoutes);
router.use('/publish', requireAuth, publishRoutes);
router.use('/pulse', requireAuth, pulseRoutes);
router.use('/briefings', requireAuth, briefingRoutes);
router.use('/ai-judgements', requireAuth, aiJudgementRoutes);
router.use('/ai', requireAuth, aiRoutes);
router.use('/dedup', requireAuth, dedupRoutes);

export default router;
