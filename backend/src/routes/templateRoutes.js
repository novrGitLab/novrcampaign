import { Router } from 'express';
import * as templateController from '../controllers/templateController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(templateController.getTemplates));
router.post('/', asyncHandler(templateController.createTemplate));
router.get('/:id', asyncHandler(templateController.getTemplate));
router.patch('/:id', asyncHandler(templateController.updateTemplate));
router.delete('/:id', asyncHandler(templateController.deleteTemplate));
router.post('/:id/duplicate', asyncHandler(templateController.duplicateTemplate));
router.get('/:id/usage', asyncHandler(templateController.getTemplateUsage));

export default router;
