import { prisma } from '../utils/prisma.js';
import { eligibility, publicStory } from './publicNews.js';
import { getLlm } from './novrpulse/understand/orchestrator.js';
import { novrPulseAnalysers } from './novrpulse/analysers.js';
import { isArrestItem } from './novrpulse/project/templates/f7.js';

const emptyBrief = { summary: '', whatItMeans: '' };
const words = (value) => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function phrases(value) {
  const tokens = words(value);
  return tokens.slice(8).map((_, index) => tokens.slice(index, index + 9).join(' '));
}

export function suitableBrief(source, brief) {
  if (
    ![brief?.summary, brief?.whatItMeans].every(
      (value) => typeof value === 'string' && value.trim().length >= 20 && value.length <= 1200,
    )
  )
    return false;
  const text = brief.summary + ' ' + brief.whatItMeans;
  if (
    /<[^>]+>|\b(?:as an ai|language model|source text|the provided (?:text|article)|i cannot|we recommend)\b/i.test(
      text,
    )
  )
    return false;
  const originals = new Set(phrases(source));
  return !phrases(text).some((phrase) => originals.has(phrase));
}

export async function fillNewsroomBriefs({
  limit,
  eventId,
  commit = false,
  summarise = (item) => novrPulseAnalysers.summarise(item, { llm: getLlm() }),
}) {
  const where = { ...eligibility(), ...emptyBrief, ...(eventId && { id: eventId }) };
  const retryBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const available = {
    ...where,
    OR: [{ publicBriefAttemptedAt: null }, { publicBriefAttemptedAt: { lt: retryBefore } }],
  };
  const result = { candidates: 0, saved: 0, skipped: 0, failed: 0 };
  let cursor;
  do {
    const batch = await prisma.npEvent.findMany({
      where: available,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 32,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        body: true,
        publishedAt: true,
        canonicalUrl: true,
        eventType: true,
        cyberRegion: true,
        sources: {
          orderBy: { extractedAt: 'asc' },
          select: { rawDocument: { select: { url: true, body: true, source: { select: { name: true } } } } },
        },
      },
    });
    for (const event of batch) {
      if (!publicStory(event)) continue;
      const source = event.sources.map((s) => s.rawDocument).find((s) => s.body?.trim().length >= 160);
      if (!source || isArrestItem({ body: source.body })) continue;
      if (commit) {
        const claim = await prisma.npEvent.updateMany({
          where: { ...available, id: event.id },
          data: { publicBriefAttemptedAt: new Date() },
        });
        if (!claim.count) continue;
      }
      result.candidates++;
      if (commit) {
        try {
          const brief = await summarise({
            title: event.title,
            content: source.body,
            sourceName: source.source.name,
          });
          if (suitableBrief(source.body, brief) && publicStory({ ...event, ...brief })) {
            const saved = await prisma.npEvent.updateMany({
              where: { ...where, id: event.id },
              data: { summary: brief.summary, whatItMeans: brief.whatItMeans },
            });
            result.saved += saved.count;
          } else result.skipped++;
        } catch {
          result.failed++;
        }
      }
      if (result.candidates >= limit) return result;
    }
    cursor = batch.length === 32 ? batch.at(-1).id : undefined;
  } while (cursor);
  return result;
}
