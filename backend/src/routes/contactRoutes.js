import { Router } from 'express';
import multer from 'multer';
import * as contactController from '../controllers/contactController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// CSV uploads are held in memory — no disk files to clean up (serverless-safe)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.CSV_MAX_BYTES ?? 5 * 1024 * 1024), files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      ['text/csv', 'text/plain', 'application/vnd.ms-excel'].includes(file.mimetype) ||
      /\.csv$/i.test(file.originalname);
    cb(ok ? null : new Error('Only CSV files are allowed'), ok);
  },
});

router.get('/', asyncHandler(contactController.getContacts));
router.post('/', asyncHandler(contactController.createContact));
router.get('/:id', asyncHandler(contactController.getContact));
router.patch('/:id', asyncHandler(contactController.updateContact));

router.post('/bulk-subscribe', asyncHandler(contactController.bulkSubscribe));
router.post('/bulk-unsubscribe', asyncHandler(contactController.bulkUnsubscribe));
router.post('/bulk-delete', asyncHandler(contactController.bulkDelete));
router.get('/bulk/:jobId', asyncHandler(contactController.getBulkJob));

router.post('/import', upload.single('file'), asyncHandler(contactController.importContacts));
router.get('/import/:jobId', asyncHandler(contactController.getImportJob));

export default router;
