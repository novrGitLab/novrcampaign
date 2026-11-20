/**
 * F7 projection — select eligible events and create draft `PublishItem` rows.
 *
 * This is the ONLY place `PublishItem` rows are created. It runs the gates
 * (`gates.js`) BEFORE each insert and refuses to create a row that fails
 * (02-event-schema.md §2 note 8: floor enforced at creation; default denied).
 *
 * Two safety properties the slice must guarantee:
 *  1. The projection NEVER sets `publishedAt`. It creates approval-pending rows.
 *     F7 arrest items may not be auto-published (01-policies.md §2.7): approval
 *     requires an explicit human action through the approval API.
 *  2. It is dry-run by default (`commit:false`), matching the collect/understand
 *     scripts: a plain call reports what *would* be created and writes nothing.
 *
 * The `PublishItem` model allows a NULL `approvedAt`, so a projected row is an
 * honest DRAFT: `approvedAt` stays null and no approver is recorded until a human
 * signs off through the approval API (`01-policies.md` §2.7). The projecting
 * operator is NOT the approver, so `editorId` is left unset at projection and is
 * written only by the human approve/withdraw endpoints.
 */

import { prisma } from '../../../utils/prisma.js';
import logger from '../../../utils/logger.js';
import { renderF7, isArrestItem } from './templates/f7.js';
import { assertPublishable, GateError } from './gates.js';

/** Tier the projection defaults to. The public tier is the highest-reach surface
 * and therefore subject to the strictest defamation control (§2.5). */
export const DEFAULT_TIER = 'public';

/**
 * Prisma `select` for the fields the F7 renderer reads, plus sources/entities.
 */
const EVENT_SELECT = {
  id: true,
  title: true,
  summary: true,
  whatItMeans: true,
  canonicalUrl: true,
  region: true,
  eventType: true,
  functions: true,
  publishedAt: true,
  sources: { include: { rawDocument: { include: { source: true } } } },
  entities: { include: { entity: true } },
};

/** Normalise a selected event row into the shape the renderer/gates expect. */
export function normaliseEvent(row) {
  const sources = (row.sources ?? []).map((s) => ({
    name: s.rawDocument?.source?.name ?? undefined,
    url: s.rawDocument?.url ?? undefined,
    licenceStatus: s.rawDocument?.source?.licenceStatus ?? undefined,
    paywall: s.rawDocument?.source?.paywall ?? false,
  }));
  const entities = (row.entities ?? []).map((e) => ({
    type: e.entity?.type,
    name: e.entity?.canonicalName,
    role: e.role,
  }));
  return { event: row, sources, entities };
}

/**
 * Build the candidate publish items for a set of events at a given tier.
 * Pure: no I/O. Returns `{ created: [...], refused: [...] }` describing what
 * WOULD be written, with gate failures captured rather than thrown.
 *
 * @param {Array<object>} rows   Raw Prisma event rows (see EVENT_SELECT).
 * @param {object} [opts]
 * @param {'public'|'paid'} [opts.tier]
 * @returns {{ created:Array<object>, refused:Array<object> }}
 */
export function planF7(rows, { tier = DEFAULT_TIER } = {}) {
  const created = [];
  const refused = [];

  for (const row of rows) {
    const { event, sources, entities } = normaliseEvent(row);
    const rendered = renderF7(event, { sources, entities, tier });
    // Gate on EVERY source's licence, not just sources[0] (defect D4).
    const licenceStatuses = sources.map((s) => s.licenceStatus).filter(Boolean);
    const arrest = isArrestItem(event);

    try {
      assertPublishable(event, 7, tier, {
        body: rendered.body,
        licenceStatus: sources[0]?.licenceStatus,
        licenceStatuses,
        sources,
        entities,
      });
    } catch (err) {
      if (err instanceof GateError) {
        refused.push({
          eventId: event.id,
          title: event.title,
          code: err.code,
          message: err.message,
          details: err.details,
        });
        continue;
      }
      throw err;
    }

    created.push({
      eventId: event.id,
      title: event.title,
      functionId: 7,
      tier,
      body: rendered.body,
      templateVersion: rendered.templateVersion,
      requiresHumanApproval: true, // never auto-published (§2.7)
      isArrest: arrest,
    });
  }

  return { created, refused };
}

/**
 * Select eligible F7 events: understood (has a summary), assigned function 7,
 * and not yet projected at the requested tier.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @param {'public'|'paid'} [opts.tier]
 * @returns {Promise<Array<object>>}
 */
export async function selectEligibleF7({ limit = 20, tier = DEFAULT_TIER } = {}) {
  const rows = await prisma.npEvent.findMany({
    where: { functions: { has: 7 }, summary: { not: '' } },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: EVENT_SELECT,
  });

  // Drop events already projected at this tier (idempotent re-runs).
  if (rows.length === 0) return [];
  const existing = await prisma.publishItem.findMany({
    where: { functionId: 7, tier, eventId: { in: rows.map((r) => r.id) } },
    select: { eventId: true },
  });
  const seen = new Set(existing.map((e) => e.eventId));
  return rows.filter((r) => !seen.has(r.id));
}

/**
 * Project eligible F7 events into draft `PublishItem` rows, gated.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @param {'public'|'paid'} [opts.tier]
 * @param {string} [opts.editorId]        Acting operator id, for audit logging only.
 *                                        NOT written to the row (defect D3): the
 *                                        projector is not the approver.
 * @param {boolean} [opts.commit=false]   Dry-run by default.
 * @returns {Promise<{ candidates:number, created:number, refused:number, results:object }>}
 */
export async function projectF7({ limit = 20, tier = DEFAULT_TIER, editorId, commit = false } = {}) {
  const rows = await selectEligibleF7({ limit, tier });
  const { created, refused } = planF7(rows, { tier });

  if (!commit) {
    return { candidates: rows.length, created: 0, refused: refused.length, results: { planned: created, refused } };
  }

  const written = [];
  for (const item of created) {
    try {
      const row = await prisma.publishItem.create({
        data: {
          eventId: item.eventId,
          functionId: item.functionId,
          tier: item.tier,
          body: item.body,
          templateVersion: item.templateVersion,
          // DRAFT row (defect D3): `approvedAt` is left NULL so `deriveStatus`
          // reports `draft`, not `approved`. `editorId` is likewise NOT set — the
          // projector is not the approver. Both are written only by the human
          // approve/withdraw endpoints (`01-policies.md` §2.7). `publishedAt` is
          // intentionally omitted — drafts are never auto-published.
        },
      });
      written.push(row);
    } catch (err) {
      logger.warn({ eventId: item.eventId, message: err.message }, 'F7 projection insert failed');
      refused.push({ eventId: item.eventId, title: item.title, code: 'insert_failed', message: err.message });
    }
  }

  logger.info(
    { candidates: rows.length, created: written.length, refused: refused.length, projectedBy: editorId ?? null },
    'F7 projection complete',
  );
  return { candidates: rows.length, created: written.length, refused: refused.length, results: { written, refused } };
}

export default { projectF7, planF7, selectEligibleF7, normaliseEvent, DEFAULT_TIER };
