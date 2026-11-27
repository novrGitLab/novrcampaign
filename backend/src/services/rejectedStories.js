import { prisma } from '../utils/prisma.js';
import { BadRequest, Conflict, NotFound, Unprocessable } from '../utils/AppError.js';
import { eligibility } from './publicNews.js';
import { isArrestItem } from './novrpulse/project/templates/f7.js';

const rejected = { OR: [{ isCybersecurity: false }, { reviewStatus: 'dismissed' }] };
const select = {
  id: true, title: true, publishedAt: true, articleVersion: true,
  reviewStatus: true, isCybersecurity: true, screeningDecision: true,
  screeningReason: true, screeningConfidence: true,
  summary: true, whatItMeans: true, body: true, eventType: true,
  sources: {
    orderBy: { extractedAt: 'asc' },
    select: { rawDocument: { select: { source: { select: { name: true, licenceStatus: true } } } } },
  },
};

function restriction(row) {
  if (!row.sources.length) return 'A publisher source is required for article review.';
  if (row.sources.some(({ rawDocument }) => rawDocument.source.licenceStatus?.toLowerCase() === 'denied'))
    return 'The publisher licence excludes this story from article review.';
  if (!row.publishedAt || row.publishedAt > new Date()) return 'A current or past publication date is required.';
  if (isArrestItem(row)) return 'Arrest and accusation coverage requires the separate Breaking News review.';
  return null;
}

export async function rejectedStories(after, search) {
  const rows = await prisma.npEvent.findMany({
    where: { ...rejected, ...(search && { title: { contains: search, mode: 'insensitive' } }) },
    orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    take: 21,
    ...(after && { cursor: { id: after }, skip: 1 }),
    select,
  });
  return {
    items: rows.slice(0, 20).map((row) => ({
      id: row.id, title: row.title, version: row.articleVersion,
      source: row.sources[0]?.rawDocument.source.name ?? null,
      publishedAt: row.publishedAt,
      dismissed: row.reviewStatus === 'dismissed',
      decision: row.isCybersecurity === false ? row.screeningDecision || 'legacy' : null,
      reason: row.isCybersecurity === false ? row.screeningReason : null,
      confidence: row.isCybersecurity === false ? row.screeningConfidence : null,
      restriction: restriction(row),
    })),
    next: rows.length > 20 ? rows[19].id : null,
  };
}

export async function restoreStory(id, version, region, staffId) {
  if (!['NG', 'AF', 'GLOBAL'].includes(region)) throw BadRequest('Choose a valid edition.');
  const row = await prisma.npEvent.findUnique({ where: { id }, select: { ...select, articleDraft: true } });
  if (!row) throw NotFound('Story unavailable.');
  if (row.articleVersion !== version || (row.isCybersecurity !== false && row.reviewStatus !== 'dismissed'))
    throw Conflict('This story changed. Refresh the queue.');
  const hold = restriction(row);
  if (hold) throw Unprocessable(hold);
  const { sources, publishedAt } = eligibility();
  const saved = await prisma.npEvent.updateMany({
    where: { id, ...rejected, articleVersion: version, sources, publishedAt },
    data: {
      isCybersecurity: true, cyberRegion: region, reviewStatus: 'new',
      articleApprovedAt: null, articleApprovedBy: null, articleRegion: null,
      ...(row.articleDraft && { articleDraft: { ...row.articleDraft, region } }),
      restoredAt: new Date(), restoredBy: staffId, publicBriefAttemptedAt: null,
      articleVersion: { increment: 1 },
    },
  });
  if (!saved.count) throw Conflict('This story changed. Refresh the queue.');
  return { id, region, version: version + 1 };
}
