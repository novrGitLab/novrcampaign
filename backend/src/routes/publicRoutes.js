import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';
import {
  findNews,
  listNews,
  desks,
  publicOrigin,
  sitemapCount,
  sitemapStories,
  sitemapSize,
} from '../services/publicNews.js';
import { prisma } from '../utils/prisma.js';
import { config } from '../config/env.js';
import { digest, opaqueToken } from '../services/staffSession.js';
import { addSegmentMembers, createContact, sendConfirmation } from '../services/plunkService.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
const uuid = Joi.string().uuid().required();
const pages = ['/', ...Object.keys(desks).map((desk) => '/edition/' + desk)];
function message(res, title, status = 200) {
  return res.status(status).json({ message: title });
}

router.get(
  '/api/public/news',
  asyncHandler(async (req, res) => {
    const { desk, after } = req.query;
    if (desk !== undefined && (typeof desk !== 'string' || !Object.hasOwn(desks, desk)))
      return res.sendStatus(404);
    if (after !== undefined && uuid.validate(after).error) return res.sendStatus(400);
    return res.json(await listNews({ region: desks[desk], after }));
  }),
);
router.get(
  '/api/public/news/:id',
  asyncHandler(async (req, res) => {
    const story = uuid.validate(req.params.id).error ? null : await findNews(req.params.id);
    if (!story) return res.status(404).json({ error: { message: 'Story unavailable' } });
    const { items: related } = await listNews({ region: story.region, exclude: story.id, limit: 3 });
    return res.json({ story, related });
  }),
);
function xml(res, tag, entries) {
  return res
    .type('application/xml')
    .set('Cache-Control', 'public,max-age=300')
    .send(
      '<?xml version="1.0" encoding="UTF-8"?><' +
        tag +
        ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        entries.join('') +
        '</' +
        tag +
        '>',
    );
}
router.get(
  '/api/public/sitemap',
  asyncHandler(async (_req, res) => {
    const count = await sitemapCount();
    const chunks = Math.max(1, Math.ceil(count / sitemapSize));
    return xml(
      res,
      'sitemapindex',
      Array.from(
        { length: chunks },
        (_, index) => '<sitemap><loc>' + publicOrigin + '/sitemaps/' + index + '.xml</loc></sitemap>',
      ),
    );
  }),
);
router.get(
  '/api/public/sitemap/:chunk',
  asyncHandler(async (req, res) => {
    if (!/^\d{1,8}$/.test(req.params.chunk)) return res.sendStatus(404);
    const chunk = Number(req.params.chunk);
    if (chunk && chunk * sitemapSize >= (await sitemapCount())) return res.sendStatus(404);
    const stories = await sitemapStories(chunk);
    const urls = chunk === 0 ? pages.map((path) => '<url><loc>' + publicOrigin + path + '</loc></url>') : [];
    urls.push(
      ...stories.map(
        (story) =>
          '<url><loc>' +
          publicOrigin +
          story.href +
          '</loc><lastmod>' +
          story.publishedAt +
          '</lastmod></url>',
      ),
    );
    return xml(res, 'urlset', urls);
  }),
);
router.post(
  '/api/public/subscribe',
  limit,
  asyncHandler(async (req, res) => {
    const { value: email, error } = Joi.string()
      .trim()
      .lowercase()
      .email({ tlds: false })
      .max(254)
      .required()
      .validate(req.body?.email);
    if (error) return message(res, 'Check the email address', 400);
    if (!config.novrpulse.pulseSegment || !config.plunk.apiKey)
      return message(res, 'Subscriptions are temporarily unavailable', 503);
    const token = opaqueToken(),
      expiresAt = new Date(Date.now() + 86400000);
    await prisma.newsletterConfirmation.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const hash = digest(token);
    const retryAfter = new Date(expiresAt.getTime() - 600000);
    const claimed = await prisma.$executeRaw`
      INSERT INTO "newsletter_confirmation" ("email", "hash", "expiresAt")
      VALUES (${email}, ${hash}, ${expiresAt})
      ON CONFLICT ("email") DO UPDATE
        SET "hash" = EXCLUDED."hash", "expiresAt" = EXCLUDED."expiresAt"
        WHERE "newsletter_confirmation"."expiresAt" < ${retryAfter}
    `;
    if (claimed === 1) {
      try {
        await sendConfirmation(email, publicOrigin + '/subscribe/confirm#' + token);
      } catch {
        await prisma.newsletterConfirmation.deleteMany({ where: { hash: digest(token) } });
        return message(res, 'Email delivery is temporarily unavailable', 503);
      }
    }
    return message(res, 'Check your inbox');
  }),
);
router.post(
  '/api/public/subscribe/confirm',
  limit,
  asyncHandler(async (req, res) => {
    const token = req.body?.confirmation;
    const record =
      typeof token === 'string' && /^[\w-]{43}$/.test(token)
        ? await prisma.newsletterConfirmation.findUnique({ where: { hash: digest(token) } })
        : null;
    if (!record || record.expiresAt < new Date()) return message(res, 'Confirmation link expired', 400);
    try {
      await addSegmentMembers(config.novrpulse.pulseSegment, {
        emails: [record.email],
        createMissing: true,
        subscribed: false,
      });
      await createContact({ email: record.email, subscribed: true });
    } catch {
      return message(res, 'Subscription could not be confirmed', 503);
    }
    await prisma.newsletterConfirmation.deleteMany({ where: { hash: record.hash } });
    return message(res, 'Subscription confirmed');
  }),
);
export default router;
