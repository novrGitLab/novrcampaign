import { Router } from 'express';
import { createHash } from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import Joi from 'joi';
import { prisma } from '../utils/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { BadRequest, AppError } from '../utils/AppError.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fields: 0, fileSize: 5 * 1024 * 1024 },
});

router.get(
  '/files/:hash.webp',
  asyncHandler(async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.hash)) return res.sendStatus(404);
    const image = await prisma.newsroomImage.findUnique({ where: { hash: req.params.hash } });
    if (!image) return res.sendStatus(404);
    return res
      .type('image/webp')
      .set('Cache-Control', 'public,max-age=31536000,immutable')
      .send(Buffer.from(image.bytes));
  }),
);
router.post(
  '/upload',
  requireAuth,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw BadRequest('Choose a JPEG, PNG or WebP photograph.');
    let bytes;
    try {
      const input = sharp(req.file.buffer, { limitInputPixels: 24_000_000 });
      const { format } = await input.metadata();
      if (!['jpeg', 'png', 'webp'].includes(format)) throw new Error();
      bytes = await input
        .rotate()
        .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      throw BadRequest('Choose a JPEG, PNG or WebP photograph under 24 megapixels.');
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    await prisma.newsroomImage.upsert({ where: { hash }, create: { hash, bytes }, update: {} });
    return res.status(201).json({ url: '/api/media/files/' + hash + '.webp' });
  }),
);
router.get(
  '/photos',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { value: q, error } = Joi.string().trim().min(2).max(80).required().validate(req.query.q);
    if (error) throw BadRequest('Enter a photo search term.');
    if (!process.env.PEXELS_API_KEY)
      throw new AppError(503, 'Photo search is unavailable. Upload a photograph instead.');
    const url = new URL('https://api.pexels.com/v1/search');
    url.search = new URLSearchParams({ query: q, per_page: '6', orientation: 'landscape' });
    const result = await fetch(url, {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!result.ok) throw new AppError(503, 'Photo search is temporarily unavailable.');
    const { photos } = await result.json();
    return res.json({
      photos: photos.map((p) => ({
        url: p.src.large,
        thumb: p.src.small,
        alt: p.alt,
        credit: p.photographer + ' / Pexels',
        page: p.url,
      })),
    });
  }),
);
export default router;
