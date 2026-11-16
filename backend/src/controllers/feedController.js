import Joi from 'joi';
import { prisma } from '../utils/prisma.js';
import { BadRequest, NotFound } from '../utils/AppError.js';
import { weekRange, weekLabel, parseWeekStart } from '../services/feedWeek.js';

const SOURCE_TYPES = ['x', 'news', 'regulator', 'other'];
const STATUSES = ['draft', 'ready', 'archived'];

const createSchema = Joi.object({
  sourceType: Joi.string().valid(...SOURCE_TYPES).required(),
  sourceName: Joi.string().trim().min(1).max(200).required(),
  url: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(2000).required(),
  author: Joi.string().trim().max(200).allow('', null),
  publishedAt: Joi.string().isoDate().required(),
  title: Joi.string().trim().min(1).max(300).required(),
  summary: Joi.string().trim().min(1).max(5000).required(),
  status: Joi.string().valid(...STATUSES).default('draft'),
});

const updateSchema = createSchema.fork(
  ['sourceType', 'sourceName', 'url', 'publishedAt', 'title', 'summary'],
  (s) => s.optional(),
);

/**
 * Normalise a URL for dedupe: lowercase scheme+host, drop tracking params and
 * the fragment, strip a trailing slash. Non-parseable values pass through as-is
 * (Joi has already checked they are URIs).
 */
export function normaliseUrl(raw) {
  try {
    const u = new URL(raw.trim());
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    const drop = [];
    for (const key of u.searchParams.keys()) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid'].includes(key)) {
        drop.push(key);
      }
    }
    drop.forEach((k) => u.searchParams.delete(k));
    let out = u.toString();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return raw.trim();
  }
}

/**
 * GET /api/feed — this week's (or a given week's) entries.
 * Query: weekStart (ISO), status, sourceType, q
 */
export async function getFeedEntries(req, res) {
  const anchor = parseWeekStart(req.query.weekStart) ?? new Date();
  const { start, end } = weekRange(anchor);

  const where = { publishedAt: { gte: start, lte: end } };

  if (req.query.status) {
    const statuses = String(req.query.status).split(',');
    if (!statuses.every((s) => STATUSES.includes(s))) {
      throw BadRequest('status must be one of draft, ready, archived');
    }
    where.status = { in: statuses };
  }
  if (req.query.sourceType) {
    const types = String(req.query.sourceType).split(',');
    if (!types.every((t) => SOURCE_TYPES.includes(t))) {
      throw BadRequest('sourceType must be one of x, news, regulator, other');
    }
    where.sourceType = { in: types };
  }
  if (req.query.q) {
    const q = String(req.query.q).trim();
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
      ];
    }
  }

  const entries = await prisma.feedEntry.findMany({
    where,
    orderBy: { publishedAt: 'desc' },
    include: { _count: { select: { campaignLinks: true } } },
  });

  return res.json({
    entries: entries.map(serializeEntry),
    week: { start: start.toISOString(), end: end.toISOString(), label: weekLabel(anchor) },
  });
}

/**
 * POST /api/feed — create an entry. Blocks duplicate URL (naming the existing
 * entry) and empty summary (Joi → 400).
 */
export async function createFeedEntry(req, res) {
  const value = await createSchema.validateAsync(req.body, { stripUnknown: true });
  const url = normaliseUrl(value.url);

  const existing = await prisma.feedEntry.findUnique({ where: { url } });
  if (existing) {
    throw BadRequest(`This URL is already captured as "${existing.title}".`, {
      entryId: existing.id,
    });
  }

  const entry = await prisma.feedEntry.create({
    data: {
      sourceType: value.sourceType,
      sourceName: value.sourceName,
      url,
      author: value.author || null,
      publishedAt: new Date(value.publishedAt),
      title: value.title,
      summary: value.summary,
      status: value.status,
      createdBy: req.user.id,
    },
    include: { _count: { select: { campaignLinks: true } } },
  });

  return res.status(201).json({ entry: serializeEntry(entry) });
}

/**
 * PUT /api/feed/:id — edit an entry (re-checks URL uniqueness excluding self).
 */
export async function updateFeedEntry(req, res) {
  const value = await updateSchema.validateAsync(req.body, { stripUnknown: true });

  const current = await prisma.feedEntry.findUnique({ where: { id: req.params.id } });
  if (!current) throw NotFound('Feed entry not found');

  const data = {};
  if (value.sourceType !== undefined) data.sourceType = value.sourceType;
  if (value.sourceName !== undefined) data.sourceName = value.sourceName;
  if (value.author !== undefined) data.author = value.author || null;
  if (value.publishedAt !== undefined) data.publishedAt = new Date(value.publishedAt);
  if (value.title !== undefined) data.title = value.title;
  if (value.summary !== undefined) data.summary = value.summary;
  if (value.status !== undefined) data.status = value.status;

  if (value.url !== undefined) {
    const url = normaliseUrl(value.url);
    if (url !== current.url) {
      const clash = await prisma.feedEntry.findUnique({ where: { url } });
      if (clash && clash.id !== current.id) {
        throw BadRequest(`This URL is already captured as "${clash.title}".`, { entryId: clash.id });
      }
    }
    data.url = url;
  }

  const entry = await prisma.feedEntry.update({
    where: { id: current.id },
    data,
    include: { _count: { select: { campaignLinks: true } } },
  });

  return res.json({ entry: serializeEntry(entry) });
}

/**
 * DELETE /api/feed/:id
 */
export async function deleteFeedEntry(req, res) {
  const current = await prisma.feedEntry.findUnique({ where: { id: req.params.id } });
  if (!current) throw NotFound('Feed entry not found');
  await prisma.feedEntry.delete({ where: { id: current.id } });
  return res.status(204).send();
}

function serializeEntry(entry) {
  const { _count, ...rest } = entry;
  return {
    ...rest,
    publishedAt: entry.publishedAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    usedInCampaigns: _count?.campaignLinks ?? 0,
  };
}

export { createSchema, updateSchema };
