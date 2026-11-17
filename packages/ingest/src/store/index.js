/**
 * Generic store: persist normalised items through a consumer-supplied adapter.
 *
 * The engine never touches a database or Prisma directly. A consumer provides an
 * `adapter` with a small, explicit contract, and the store enforces the
 * idempotency and safety invariants common to every consumer:
 *
 *   adapter = {
 *     upsertSource(source)                     -> ensure the source row exists
 *     findRawByHash(contentHash)               -> existing raw doc | null
 *     createRaw(source, item)                  -> created raw doc
 *     findEventByUrl(canonicalUrl)             -> existing event | null
 *     createEvent(source, item, raw)           -> created event
 *     attachEventSource(eventId, rawId)        -> link a source to an event
 *   }
 *
 * The store guarantees:
 *   - **Idempotency.** A repeated run re-emits the feed window; the same item is
 *     never stored twice (checked by content hash, then by canonical URL).
 *   - **Provenance.** A new raw document is always linked to an event.
 *   - **Atomicity is the adapter's concern** (NovrPulse wraps its writes in a
 *     transaction), because the engine cannot know the consumer's storage.
 */

/**
 * Store one item idempotently.
 *
 * @param {object} item  normalised item `{ sourceId, title, link, publishedAt, content, contentHash }`
 * @param {object} params
 * @param {object} params.adapter
 * @param {object} [params.logger]
 * @returns {Promise<{ created:boolean, eventId:string|null, reason?:string }>}
 */
export async function storeItem(item, { adapter, logger } = {}) {
  if (!adapter) throw new Error('storeItem: adapter is required');
  const { sourceId, title, link, publishedAt, content, contentHash } = item;

  if (!contentHash) return { created: false, eventId: null, reason: 'no-content-hash' };
  if (!link) return { created: false, eventId: null, reason: 'no-link' };

  const existing = await adapter.findRawByHash(contentHash);
  if (existing) return { created: false, eventId: null, reason: 'duplicate' };

  const raw = await adapter.createRaw(sourceId, { ...item, title, link, publishedAt, content, contentHash });

  const existingEvent = await adapter.findEventByUrl(link);
  if (existingEvent) {
    await adapter.attachEventSource(existingEvent.id, raw.id);
    return { created: false, eventId: existingEvent.id, reason: 'attached-to-existing-event' };
  }

  const event = await adapter.createEvent(sourceId, { title, link, publishedAt, content }, raw);
  logger?.info?.({ sourceId, eventId: event.id }, 'stored new event');
  return { created: true, eventId: event.id };
}

/**
 * Persist a whole pipeline run.
 *
 * Batched for speed: at daily volume (hundreds of items) storing one item per
 * round-trip is far too slow. The adapter may implement `storeBatch(items)` for a
 * fast path; if it does not, the engine falls back to per-item `storeItem`.
 *
 * @param {object} report  `{ items, sources }` from the pipeline
 * @param {object} params
 * @param {object} params.adapter
 * @param {Array<object>} [params.sources]  source definitions to ensure first
 * @param {object} [params.logger]
 * @returns {Promise<{ stored:number, skipped:number, events:number }>}
 */
export async function storeRun(report, { adapter, sources = [], logger } = {}) {
  if (!adapter) throw new Error('storeRun: adapter is required');

  for (const s of sources) await adapter.upsertSource(s);

  const items = report.items ?? [];

  if (typeof adapter.storeBatch === 'function') {
    const summary = await adapter.storeBatch(items);
    logger?.info?.({ ...summary, items: items.length }, 'store run complete');
    return summary;
  }

  let stored = 0;
  let skipped = 0;
  const eventIds = new Set();
  for (const item of items) {
    const r = await storeItem(item, { adapter, logger });
    if (r.created) stored += 1;
    else skipped += 1;
    if (r.eventId) eventIds.add(r.eventId);
  }

  const summary = { stored, skipped, events: eventIds.size };
  logger?.info?.({ ...summary, items: items.length }, 'store run complete');
  return summary;
}

export default { storeItem, storeRun };
