import { mediaUrl } from './newsroomPhoto.js';
export { publicOrigin } from './newsroomPhoto.js';
import { prisma } from '../utils/prisma.js';
import { isArrestItem } from './novrpulse/project/templates/f7.js';

export const desks = { nigeria: 'NG', africa: 'AF', world: 'GLOBAL' };
export const deskLabel = { NG: 'Nigeria', AF: 'Africa', GLOBAL: 'World' };
export const pageSize = 13;
const orderBy = [{ publishedAt: 'desc' }, { id: 'desc' }];
const select = {
  id: true,
  title: true,
  summary: true,
  whatItMeans: true,
  publishedAt: true,
  canonicalUrl: true,
  cyberRegion: true,
  isThreatIntel: true,
  eventType: true,
  body: true,
  publishItems: {
    where: { tier: 'public', withdrawnAt: null, rejectedAt: null, publishedAt: { not: null } },
    orderBy: { publishedAt: 'desc' },
    select: {
      sectionItems: {
        where: { imageUrl: { not: null }, section: { briefing: { publishedAt: { not: null } } } },
        take: 1,
        select: { imageUrl: true, imageAlt: true, imageCredit: true },
      },
    },
  },
  sources: {
    orderBy: { extractedAt: 'asc' },
    select: { rawDocument: { select: { url: true, source: { select: { name: true } } } } },
  },
};

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function eligibility(region) {
  return {
    isCybersecurity: true,
    reviewStatus: { not: 'dismissed' },
    publishedAt: { lte: new Date() },
    sources: {
      some: {},
      none: { rawDocument: { source: { licenceStatus: { equals: 'denied', mode: 'insensitive' } } } },
    },
    ...(region ? { cyberRegion: region } : {}),
  };
}

export function publicStory(event) {
  if (
    !event?.title?.trim() ||
    isArrestItem(event) ||
    /\barrests?\b/i.test([event.title, event.summary, event.whatItMeans].join(' '))
  )
    return null;
  const source = event.sources[0]?.rawDocument;
  const sourceUrl = safeUrl(event.canonicalUrl) || safeUrl(source?.url);
  if (!sourceUrl || !source?.source?.name) return null;
  const region = event.cyberRegion;
  const photo = event.publishItems
    ?.flatMap((item) => item.sectionItems)
    .find((item) => item.imageAlt && mediaUrl(item.imageUrl));
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    context: event.whatItMeans,
    publishedAt: event.publishedAt.toISOString(),
    href: '/news/' + encodeURIComponent(event.id),
    image: photo ? { url: mediaUrl(photo.imageUrl), alt: photo.imageAlt, credit: photo.imageCredit } : null,
    source: source.source.name,
    sourceUrl,
    region,
    desk: deskLabel[region] || 'Security',
    presentation: {
      tone: region === 'NG' ? 'primary' : region === 'AF' ? 'secondary' : 'neutral',
      emphasis: event.isThreatIntel ? 'italic' : 'roman',
    },
  };
}

export async function listNews({ region, after, limit = pageSize, exclude } = {}) {
  const items = [];
  let cursor = after;
  while (items.length <= limit) {
    const rows = await prisma.npEvent.findMany({
      where: { ...eligibility(region), ...(exclude ? { id: { not: exclude } } : {}) },
      select,
      orderBy,
      take: Math.max(24, limit + 1),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      const story = publicStory(row);
      if (story) items.push(story);
      if (items.length > limit) break;
    }
    if (rows.length < Math.max(24, limit + 1)) break;
    cursor = rows.at(-1).id;
  }
  const more = items.length > limit;
  return { items: items.slice(0, limit), next: more ? items[limit - 1].id : null };
}

export async function findNews(id) {
  const event = await prisma.npEvent.findFirst({ where: { ...eligibility(), id }, select });
  return publicStory(event);
}

export const sitemapSize = 1000;
export function sitemapCount() {
  return prisma.npEvent.count({ where: eligibility() });
}
export async function sitemapStories(chunk) {
  const rows = await prisma.npEvent.findMany({
    where: eligibility(),
    orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
    take: sitemapSize,
    skip: chunk * sitemapSize,
    select: { ...select, publishItems: false },
  });
  return rows.map(publicStory).filter(Boolean);
}
