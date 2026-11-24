import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';
import contactRoutes from './contactRoutes.js';
import campaignRoutes from './campaignRoutes.js';
import templateRoutes from './templateRoutes.js';
import segmentRoutes from './segmentRoutes.js';
import webhookRoutes from './webhookRoutes.js';
import driveRoutes from './driveRoutes.js';
import feedRoutes from './feedRoutes.js';
import publishRoutes from './publishRoutes.js';
import pulseRoutes from './pulseRoutes.js';
import briefingRoutes from './briefingRoutes.js';
import aiJudgementRoutes from './aiJudgementRoutes.js';
import dedupRoutes from './dedupRoutes.js';

const router = Router();

// Public
router.use('/health', healthRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/auth', authRoutes);

// Encrypted file drive — password-only, separate session, DRIVE_ENABLED-gated.
router.use('/drive', driveRoutes);

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
router.use('/dedup', requireAuth, dedupRoutes);

export default router;
