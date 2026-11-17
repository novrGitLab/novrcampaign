import { runPipeline, storeRun } from '@novr/ingest';
import logger from '../../utils/logger.js';
import { enabledCollectorSources, allSources } from './sources.js';
import { novrPulseAdapter } from './adapter.js';

/**
 * NovrPulse ingestion orchestration on top of the generic engine.
 *
 * The engine (`@novr/ingest`) owns fetch → parse → canary → freshness and the
 * idempotent store contract. This module supplies the NovrPulse-specific pieces:
 * the source registry and the Prisma adapter. Nothing here is engine logic.
 */

/**
 * Run collectors over the enabled NovrPulse sources.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.sourceIds]
 * @param {number}   [opts.concurrency=3]
 * @param {number}   [opts.maxAgeDays]
 * @returns {Promise<{ ranAt:string, sources:Array<object>, items:Array<object>, ok:boolean }>}
 */
export async function runCollectors({ sourceIds, concurrency = 3, maxAgeDays } = {}) {
  let sources = enabledCollectorSources();
  if (sourceIds?.length) sources = sources.filter((s) => sourceIds.includes(s.id));
  return runPipeline({ sources, concurrency, maxAgeDays, logger });
}

/**
 * Collect and persist. Idempotent: a repeat run stores nothing new.
 *
 * @returns {Promise<{ report:object, stored:number, skipped:number, events:number }>}
 */
export async function collectAndStore({ sourceIds, concurrency = 3, maxAgeDays } = {}) {
  const report = await runCollectors({ sourceIds, concurrency, maxAgeDays });
  const summary = await storeRun(report, { adapter: novrPulseAdapter, sources: allSources(), logger });
  return { report, ...summary };
}

export default { runCollectors, collectAndStore };
