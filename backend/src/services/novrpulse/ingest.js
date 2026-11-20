import { runPipeline, storeRun } from '@novr/ingest';
import logger from '../../utils/logger.js';
import config from '../../config/env.js';
import { enabledCollectorSources, allSources } from './sources.js';
import { novrPulseAdapter } from './adapter.js';

/**
 * NovrPulse ingestion orchestration on top of the generic engine.
 *
 * The engine (`@novr/ingest`) owns fetch → parse → canary → freshness and the
 * idempotent store contract. This module supplies the NovrPulse-specific pieces:
 * the source registry and the Prisma adapter. Nothing here is engine logic.
 *
 * Two collection paths exist and are selected by `runCollection`:
 *   - in-app  → `runCollectors`/`collectAndStore` (fetch sources in-process)
 *   - collector → `pullItemsAndCreateEvents` (pull over the HMAC v1 API)
 * Exactly ONE path runs per invocation; they must never both write `np_*`.
 */

/**
 * Run collectors over the enabled NovrPulse sources (IN-APP path).
 *
 * @deprecated Pre-cutover path. Scheduled for retirement in Phase 5 once the
 * collector path is the default. Kept fully working and unchanged; select it
 * via `runCollection` (flag OFF) rather than calling it directly.
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
 * Collect and persist (IN-APP path). Idempotent: a repeat run stores nothing new.
 *
 * @deprecated Pre-cutover path. Scheduled for retirement in Phase 5 once the
 * collector path is the default. Kept fully working and unchanged; select it
 * via `runCollection` (flag OFF) rather than calling it directly.
 *
 * @returns {Promise<{ report:object, stored:number, skipped:number, events:number }>}
 */
export async function collectAndStore({ sourceIds, concurrency = 3, maxAgeDays } = {}) {
  const report = await runCollectors({ sourceIds, concurrency, maxAgeDays });
  const summary = await storeRun(report, { adapter: novrPulseAdapter, sources: allSources(), logger });
  return { report, ...summary };
}

/**
 * Select and run exactly ONE collection path for a single invocation.
 *
 * This is the cutover entry point (Phase 4). It reads the server-side switch
 * `config.novrpulse.collection.enabled` (default `false`) and dispatches to
 * EITHER the in-app collector OR the collector-via-API pull — never both — so
 * only one writer ever touches `np_*` per run.
 *
 * A collector failure is allowed to propagate: there is deliberately NO silent
 * fall back to the in-app path, because that would mask the cutover and risk a
 * double write. Failing loudly is the correct behaviour for a misconfigured or
 * unreachable collector.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.sourceIds]
 * @param {number}   [opts.concurrency=3]   in-app path only
 * @param {number}   [opts.maxAgeDays]
 * @param {boolean}  [opts.enabled]         override the flag (tests / CLI)
 * @param {object}   [opts._paths]          injectable path impls for tests;
 *   defaults to the real in-app / collector functions. Never set in production.
 * @param {Function} [opts._paths.inApp]      defaults to `collectAndStore`
 * @param {Function} [opts._paths.collector]  defaults to `pullItemsAndCreateEvents`
 * @returns {Promise<{ path:'in-app'|'collector', [key:string]: unknown }>}
 */
export async function runCollection({ sourceIds, concurrency = 3, maxAgeDays, enabled, _paths } = {}) {
  const useCollector = enabled ?? config.novrpulse.collection.enabled;

  if (useCollector) {
    // Imported lazily so the in-app (default) path never loads the collector
    // client — keeping the OFF behaviour byte-for-byte identical.
    const collector = _paths?.collector ?? (await import('./collectionPull.js')).pullItemsAndCreateEvents;
    const summary = await collector({ sourceIds, maxAgeDays });
    return { path: 'collector', ...summary };
  }

  const inApp = _paths?.inApp ?? collectAndStore;
  const summary = await inApp({ sourceIds, concurrency, maxAgeDays });
  return { path: 'in-app', ...summary };
}

export default { runCollectors, collectAndStore, runCollection };
