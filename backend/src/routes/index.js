import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';
import contactRoutes from './contactRoutes.js';
import campaignRoutes from './campaignRoutes.js';
import templateRoutes from './templateRoutes.js';
import segmentRoutes from './segmentRoutes.js';
import webhookRoutes from './webhookRoutes.js';

const router = Router();

// Public
router.use('/health', healthRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/auth', authRoutes);

// Authenticated dashboard endpoints (these carry the Plunk secret server-side)
router.use('/contacts', requireAuth, contactRoutes);
router.use('/campaigns', requireAuth, campaignRoutes);
router.use('/templates', requireAuth, templateRoutes);
router.use('/segments', requireAuth, segmentRoutes);

export default router;
