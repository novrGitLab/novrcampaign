import { Router } from 'express';
import * as authController from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post(
  '/login',
  authLimiter,
  validate(authController.schemas.loginSchema),
  asyncHandler(authController.login),
);
router.get('/me', requireAuth, asyncHandler(authController.me));

export default router;
