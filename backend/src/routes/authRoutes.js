import { Router } from 'express';
import { start, callback, logout, me } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/oidc/start', authLimiter, asyncHandler(start));
router.get('/oidc/callback', authLimiter, asyncHandler(callback));
router.post('/logout', asyncHandler(logout));
router.get('/me', requireAuth, me);
export default router;
