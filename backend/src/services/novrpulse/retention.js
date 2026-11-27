import { prisma } from '../../utils/prisma.js';
import logger from '../../utils/logger.js';

/**
 * NovrPulse daily retention purge.
 *
 * Collected news is raw evidence for the understanding/editorial layers. Once a
 * new day's collection has landed, the PREVIOUS days' still-UNPUBLISHED events
 * are no longer needed: if an old story becomes relevant again the publisher
 * republishes it and the collector picks it up fresh (owner decision 2026-11-27).
 * So the retention window is a single day.
 *
 * Two things are kept FOREVER:
 *   - every event that has been PUBLISHED (it is referenced by editorial work), and
 *   - the raw source documents ("source citations") that back a surviving event
 *     (provenance / audit).
 *
 * This service is deliberately conservative: it never deletes a row an editorial
 * or training record still references, and it refuses to run a delete that looks
 * like a broken filter / clock bug (the mass-deletion guard).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the purge cutoff = the start of the retention window.
 *
 * Rule (documented): with `retentionDays = 1`, everything strictly older than
 * the START OF TODAY (UTC) is eligible — i.e. anything NOT from the current UTC
 * calendar day. In general:
 *
 *   cutoff = startOfUtcDay(now - (retentionDays - 1) * 24h)
 *
 * For retentionDays = 1 this is `startOfUtcDay(now)` = today 00:00:00.000Z, so
 * an event with `publishedAt < cutoff` is from a previous day and is purged.
 * For retentionDays = 2 the window covers today plus yesterday (cutoff =
 * yesterday 00:00Z), and so on. `retentionDays` must be a positive integer.
 *
 * The comparison is strict (`publishedAt < cutoff`): an event stamped exactly at
 * the cutoff instant belongs to the retained window, not the purge.
 *
 * @param {number} retentionDays
 * @param {Date} now
 * @returns {Date} cutoff instant (UTC)
 */
export function computeCutoff(retentionDays, now) {
  const days = Math.trunc(retentionDays);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(`retentionDays must be a positive integer, got ${retentionDays}`);
  }
  const anchor = new Date(now.getTime() - (days - 1) * MS_PER_DAY);
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
}

/**
 * The PROTECTED set — ids of every `np_event` that MUST NOT be deleted because
 * an editorial or training record still references it:
 *
 *   1. `publish_item.eventId`              — the editorial piece for the event
 *   2. `publish_item_event.eventId`        — the join for multi-event pieces
 *   3. `ai_judgement.eventId`              — append-only training ledger (primary)
 *   4. `ai_judgement.counterpartEventId`   — the dedup counterpart of a judgement
 *
 * Returns a de-duplicated array of event ids. The queries select DISTINCT ids.
 */
async function collectProtectedEventIds() {
  const [publishedEventIds, joinedEventIds, judgedEventIds, counterpartEventIds] =
    await Promise.all([
      prisma.publishItem.findMany({
        where: { eventId: { not: null } },
        select: { eventId: true },
        distinct: ['eventId'],
      }),
      prisma.publishItemEvent.findMany({
        select: { eventId: true },
        distinct: ['eventId'],
      }),
      prisma.aiJudgement.findMany({
        where: { eventId: { not: null } },
        select: { eventId: true },
        distinct: ['eventId'],
      }),
      prisma.aiJudgement.findMany({
        where: { counterpartEventId: { not: null } },
        select: { counterpartEventId: true },
        distinct: ['counterpartEventId'],
      }),
    ]);

  const protectedIds = new Set();
  for (const row of publishedEventIds) if (row.eventId) protectedIds.add(row.eventId);
  for (const row of joinedEventIds) if (row.eventId) protectedIds.add(row.eventId);
  for (const row of judgedEventIds) if (row.eventId) protectedIds.add(row.eventId);
  for (const row of counterpartEventIds) if (row.counterpartEventId) protectedIds.add(row.counterpartEventId);

  return [...protectedIds];
}

/**
 * Purge collected news older than the retention window, keeping published events
 * (and their source documents) forever.
 *
 * Delete order (respecting FKs):
 *   1. Candidate `np_event` ids: `publishedAt < cutoff` AND `id NOT IN protected`.
 *   2. Delete those `np_event` rows — cascades remove `np_event_source` and
 *      `np_event_entity` (both are `onDelete: Cascade` from the event).
 *   3. Delete `np_raw_document` rows that are now ORPHANED (no `np_event_source`
 *      still references them) AND whose `fetchedAt < cutoff`. A document still
 *      referenced by a surviving event is never deleted.
 *
 * `dryRun` (default TRUE) counts only and deletes NOTHING. `dryRun:false` runs
 * the deletes inside a single transaction.
 *
 * Mass-deletion guard: if the protected set is EMPTY and the candidates equal
 * ALL events (i.e. the filter would wipe the entire table), the function REFUSES
 * and throws — a guard against a catastrophic mass deletion from a broken
 * filter/clock. A legitimate empty-table or empty-window purge has no candidates
 * (or a non-zero protected set) and is unaffected.
 *
 * @param {object} [opts]
 * @param {number} [opts.retentionDays=1]
 * @param {Date}   [opts.now=new Date()]
 * @param {boolean} [opts.dryRun=true]
 * @returns {Promise<{cutoff: string, candidates: number, eventsDeleted: number,
 *   documentsDeleted: number, protected: number, dryRun: boolean}>}
 */
export async function purgeStaleNews({ retentionDays = 1, now = new Date(), dryRun = true } = {}) {
  const cutoff = computeCutoff(retentionDays, now);

  const protectedIds = await collectProtectedEventIds();
  // Eligible cybersecurity stories have stable public URLs in the archive.
  const notInArchive = { OR: [{ isCybersecurity: null }, { isCybersecurity: false }, { reviewStatus: 'dismissed' }] };

  // 1. Candidate events: older than the cutoff and not referenced by any
  //    editorial/training record.
  const candidateRows = await prisma.npEvent.findMany({
    where: {
      publishedAt: { lt: cutoff },
      id: { notIn: protectedIds },
      ...notInArchive,
    },
    select: { id: true },
  });
  const candidateIds = candidateRows.map((r) => r.id);

  // Mass-deletion guard: no protected rows AND the candidate set is the whole
  // table → almost certainly a broken filter/time bug. Refuse rather than wipe.
  const totalEvents = await prisma.npEvent.count();
  if (protectedIds.length === 0 && candidateIds.length > 0 && candidateIds.length === totalEvents) {
    throw new Error(
      `Refusing to purge: all ${totalEvents} events are candidates and none are protected — ` +
        'this looks like a broken retention filter or clock bug, not a real purge.',
    );
  }

  if (dryRun) {
    return {
      cutoff: cutoff.toISOString(),
      candidates: candidateIds.length,
      eventsDeleted: 0,
      documentsDeleted: 0,
      protected: protectedIds.length,
      dryRun: true,
    };
  }

  // 2. Delete the candidate events (cascades np_event_source + np_event_entity),
  //    then 3. the now-orphaned raw documents, in ONE transaction so a partial
  //    purge can never leave dangling source links.
  const result = await prisma.$transaction(async (tx) => {
    const eventsDeleted = candidateIds.length
      ? (await tx.npEvent.deleteMany({ where: { id: { in: candidateIds }, ...notInArchive } })).count
      : 0;

    // Orphaned = no surviving np_event_source still points at the document.
    // Only documents fetched before the cutoff are eligible; a document that a
    // surviving event still needs is kept regardless of age.
    const orphanedDocs = await tx.npRawDocument.findMany({
      where: {
        fetchedAt: { lt: cutoff },
        eventSources: { none: {} },
      },
      select: { id: true },
    });
    const orphanDocIds = orphanedDocs.map((d) => d.id);

    const documentsDeleted = orphanDocIds.length
      ? (await tx.npRawDocument.deleteMany({ where: { id: { in: orphanDocIds } } })).count
      : 0;

    return { eventsDeleted, documentsDeleted };
  });

  logger.info(
    {
      cutoff: cutoff.toISOString(),
      eventsDeleted: result.eventsDeleted,
      documentsDeleted: result.documentsDeleted,
      protected: protectedIds.length,
    },
    'NovrPulse retention purge complete',
  );

  return {
    cutoff: cutoff.toISOString(),
    candidates: candidateIds.length,
    eventsDeleted: result.eventsDeleted,
    documentsDeleted: result.documentsDeleted,
    protected: protectedIds.length,
    dryRun: false,
  };
}

export default purgeStaleNews;
