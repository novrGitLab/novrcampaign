import { prisma } from '../../utils/prisma.js';
import { detectLanguage } from '@novr/ingest';

/**
 * NovrPulse store adapter for the @novr/ingest engine.
 *
 * The engine never imports Prisma; it calls this adapter, which maps the neutral
 * {@link import('@novr/ingest').NormalisedItem} contract onto the NovrPulse
 * `np_*` tables. Keeps the reusable engine decoupled from this schema.
 *
 * Writes that must be atomic are wrapped in a transaction here, because
 * atomicity depends on the storage, not on the engine.
 */

/** Ensure a registry source exists. Idempotent upsert. */
async function upsertSource(source) {
  const data = {
    name: source.name,
    url: source.url,
    region: source.region,
    functions: source.functions ?? [],
    type: source.type,
    licence: source.licence ?? 'unknown',
    licenceStatus: source.licence ?? 'unknown',
    paywall: Boolean(source.paywall),
    hasRss: Boolean(source.hasRss),
    feedUrl: source.feedUrl ?? null,
    enabled: Boolean(source.enabled),
  };
  return prisma.npSource.upsert({ where: { id: source.id }, update: data, create: { id: source.id, ...data } });
}

async function findRawByHash(contentHash) {
  return prisma.npRawDocument.findUnique({ where: { contentHash } });
}

async function createRaw(sourceId, item) {
  return prisma.npRawDocument.create({
    data: { sourceId, contentHash: item.contentHash, url: item.link, contentType: 'text/html', body: item.content ?? null },
  });
}

async function findEventByUrl(canonicalUrl) {
  return prisma.npEvent.findFirst({ where: { canonicalUrl } });
}

async function createEvent(sourceId, item, raw) {
  // Created in a transaction so a raw document never exists without its event.
  return prisma.$transaction(async (tx) => {
    return tx.npEvent.create({
      data: {
        title: item.title || '(untitled)',
        summary: '',
        whatItMeans: '',
        publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
        canonicalUrl: item.link,
        // Script-based detection over the collected title (summary is empty at
        // collection). Flag only — see the note in `storeBatch`. A source that
        // becomes predominantly non-English may later warrant per-source
        // auto-disable; that is NOT done here.
        language: detectLanguage(`${item.title || ''} `),
        functions: [],
        sources: { create: { rawDocumentId: raw.id } },
      },
    });
  });
}

async function attachEventSource(eventId, rawDocumentId) {
  return prisma.npEventSource.upsert({
    where: { eventId_rawDocumentId: { eventId, rawDocumentId } },
    update: {},
    create: { eventId, rawDocumentId },
  });
}

/**
 * Fast batched store. At daily volume (hundreds of items) per-item round-trips
 * are far too slow, so this pre-fetches existing hashes and URLs in two queries,
 * then bulk-inserts the new ones inside a single transaction.
 *
 * Idempotency is preserved: duplicates are filtered before insert (by content
 * hash), and items whose canonical URL already has an event attach to it instead
 * of creating a duplicate.
 */
async function storeBatch(items) {
  const list = items ?? [];
  if (!list.length) return { stored: 0, skipped: 0, events: 0 };

  const hashes = list.map((i) => i.contentHash).filter(Boolean);
  const urls = list.map((i) => i.link).filter(Boolean);

  const [existingRaw, existingEvents] = await Promise.all([
    prisma.npRawDocument.findMany({ where: { contentHash: { in: hashes } }, select: { contentHash: true } }),
    prisma.npEvent.findMany({ where: { canonicalUrl: { in: urls } }, select: { id: true, canonicalUrl: true } }),
  ]);

  const seenHashes = new Set(existingRaw.map((r) => r.contentHash));
  const eventByUrl = new Map(existingEvents.map((e) => [e.canonicalUrl, e.id]));

  let stored = 0;
  let skipped = 0;
  const touched = new Set();

  await prisma.$transaction(
    async (tx) => {
      for (const item of list) {
        if (!item.contentHash || !item.link || seenHashes.has(item.contentHash)) {
          skipped += 1;
          continue;
        }
        seenHashes.add(item.contentHash);

        const raw = await tx.npRawDocument.create({
          data: {
            sourceId: item.sourceId,
            contentHash: item.contentHash,
            url: item.link,
            contentType: 'text/html',
            body: item.content ?? null,
          },
        });

        const existingEventId = eventByUrl.get(item.link);
        if (existingEventId) {
          await tx.npEventSource.create({ data: { eventId: existingEventId, rawDocumentId: raw.id } });
          touched.add(existingEventId);
          skipped += 1;
          continue;
        }

        const event = await tx.npEvent.create({
          data: {
            title: item.title || '(untitled)',
            summary: '',
            whatItMeans: '',
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
            canonicalUrl: item.link,
            // Detection is script-based on the collected title (+ summary, which
            // collection leaves empty). The understanding layer may later fill
            // `summary`; the backfill script recomputes `language` from both.
            // NOTE: a source that becomes PREDOMINANTLY non-English is a case
            // the owner may later want to auto-disable per source; this change
            // only FLAGS non-English events and never disables a source.
            language: detectLanguage(`${item.title || ''} `),
            functions: [],
            sources: { create: { rawDocumentId: raw.id } },
          },
        });
        eventByUrl.set(item.link, event.id);
        touched.add(event.id);
        stored += 1;
      }
    },
    { timeout: 60_000 },
  );

  return { stored, skipped, events: touched.size };
}

export const novrPulseAdapter = {
  upsertSource,
  findRawByHash,
  createRaw,
  findEventByUrl,
  createEvent,
  attachEventSource,
  storeBatch,
};

export default novrPulseAdapter;
