import { analyseItem, createLlm } from '@novr/ingest';
import { prisma } from '../../../utils/prisma.js';
import config from '../../../config/env.js';
import logger from '../../../utils/logger.js';
import { novrPulseAnalysers, normaliseAlias } from '../analysers.js';

/**
 * NovrPulse understanding orchestration on top of the generic engine.
 *
 * The engine's `analyseItem` runs the injected analysers; this module owns the
 * NovrPulse-specific persistence (writes to np_event / np_entity / np_event_entity).
 *
 * Default target: events whose summary is still empty — resumable without a queue.
 */

let _llm = null;
function getLlm() {
  if (!_llm) {
    const c = config.novrpulse.llm;
    _llm = createLlm({
      apiKey: c.apiKey,
      baseUrl: c.baseUrl,
      provider: c.provider,
      bulkModel: c.bulkModel,
      frontierModel: c.frontierModel,
      fallbackModel: c.fallbackModel,
      fallbackBaseUrl: c.fallbackBaseUrl,
      fallbackApiKey: c.fallbackApiKey,
      jsonMode: c.jsonMode,
      reasoningContentAsText: c.reasoningContentAsText,
      allowLocalBaseUrl: c.allowLocalBaseUrl,
      maxAttempts: c.maxAttempts,
      timeoutMs: c.timeoutMs,
      maxTokens: c.maxTokens,
      temperature: c.temperature,
      logger,
    });
  }
  return _llm;
}

export function isConfigured() {
  return Boolean(config.novrpulse.llm.apiKey);
}

/** Resolve one entity mention to an id, creating an unapproved entity if new. */
async function resolveEntity(mention) {
  const alias = normaliseAlias(mention.name);
  if (!alias) throw new Error('resolveEntity: empty name');
  const existing = await prisma.npEntityAlias.findUnique({ where: { alias } });
  if (existing) return existing.entityId;
  const entity = await prisma.npEntity.create({
    data: { type: mention.type, canonicalName: mention.name.trim(), aliases: { create: { alias, approvedBy: null } } },
  });
  logger.info({ alias, entityId: entity.id }, 'new unapproved entity proposed');
  return entity.id;
}

/** Understand one stored event by id. */
export async function understandEvent(eventId, deps = {}) {
  const event = await prisma.npEvent.findUnique({
    where: { id: eventId },
    include: { sources: { include: { rawDocument: true } } },
  });
  if (!event) throw new Error(`event not found: ${eventId}`);

  const rawDoc = event.sources[0]?.rawDocument;
  const item = {
    sourceId: rawDoc?.sourceId,
    title: event.title,
    content: rawDoc?.body || '',
    sourceName: rawDoc?.url || '',
  };

  const llm = deps.llm || getLlm();
  const { results, errors } = await analyseItem(item, {
    analysers: deps.analysers || novrPulseAnalysers,
    llm,
  });

  const tag = results.classify || {};
  const summary = results.summarise || {};
  const entities = results.extractEntities || [];

  await prisma.npEvent.update({
    where: { id: event.id },
    data: {
      summary: summary.summary ?? '',
      whatItMeans: summary.whatItMeans ?? '',
      functions: tag.functions ?? [],
      eventType: tag.eventType ?? null,
    },
  });

  let linked = 0;
  let proposed = 0;
  for (const m of entities) {
    const before = await prisma.npEntityAlias.findUnique({ where: { alias: normaliseAlias(m.name) } });
    const entityId = await resolveEntity(m);
    if (!before) proposed += 1;
    await prisma.npEventEntity.upsert({
      where: { eventId_entityId_role: { eventId: event.id, entityId, role: m.role } },
      update: {},
      create: { eventId: event.id, entityId, role: m.role },
    });
    linked += 1;
  }

  return {
    eventId: event.id,
    functions: tag.functions ?? [],
    eventType: tag.eventType,
    summaryLength: (summary.summary ?? '').length,
    whatItMeansLength: (summary.whatItMeans ?? '').length,
    entitiesLinked: linked,
    entitiesProposed: proposed,
    errors,
  };
}

/** Run understanding over stored events not yet understood. */
export async function runUnderstanding({ limit = 20, commit = false, deps = {} } = {}) {
  if (commit && !isConfigured() && !deps.llm) {
    throw new Error('no AI provider is configured; cannot run the understanding layer');
  }
  const candidates = await prisma.npEvent.findMany({
    where: { OR: [{ summary: '' }, { whatItMeans: '' }] },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: { id: true, title: true },
  });
  if (!commit) return { candidates: candidates.length, processed: 0, results: [] };

  const results = [];
  for (const c of candidates) {
    try {
      results.push(await understandEvent(c.id, deps));
    } catch (err) {
      logger.warn({ eventId: c.id, message: err.message }, 'understanding failed for event');
      results.push({ eventId: c.id, error: err.message });
    }
  }
  logger.info({ candidates: candidates.length, processed: results.length }, 'understanding run complete');
  return { candidates: candidates.length, processed: results.length, results };
}

export default { understandEvent, runUnderstanding, isConfigured };
