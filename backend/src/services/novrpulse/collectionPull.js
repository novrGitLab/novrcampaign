import { storeRun } from '@novr/ingest';

import logger from '../../utils/logger.js';
import config from '../../config/env.js';
import { enabledCollectorSources, allSources } from './sources.js';
import { novrPulseAdapter } from './adapter.js';
import { createCollectionClient } from './collectionClient.js';

/**
 * Pull → store orchestration for the stateless collector (additive Phase 3).
 *
 * This is the CLIENT-side counterpart of the in-app collector in `ingest.js`.
 * It does NOT replace `runCollectors`/`collectAndStore`: those keep fetching
 * sources in-process. This path instead:
 *
 *   1. POST /v1/collections          → start a run on the collector
 *   2. GET  /v1/runs/:runId (poll)   → wait for a terminal status
 *   3. GET  /v1/runs/:runId/items    → page every item to exhaustion
 *   4. storeRun({ items, sources })  → persist through the SAME NovrPulse adapter
 *
 * Idempotency is already guaranteed one layer down (`storeRun`/`storeBatch`
 * dedupe by contentHash, then by canonical URL), so this module adds NO second
 * dedupe — it relies on the engine's contract, exactly like the in-app path.
 */

/** Terminal collector run statuses (mirrors novr-collection/src/runs/runStore.js). */
const TERMINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'evicted']);

/**
 * Poll a run until it reaches a terminal status, or the poll budget is spent.
 *
 * @param {object} client
 * @param {string} runId
 * @param {object} opts
 * @param {number} opts.maxPolls
 * @param {number} opts.intervalMs
 * @returns {Promise<object>} the last run envelope seen
 */
async function awaitTerminal(client, runId, { maxPolls, intervalMs }) {
  let last;
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    last = await client.getRun(runId);
    if (TERMINAL_STATUSES.has(last?.status)) return last;
    if (poll < maxPolls) await sleep(intervalMs);
  }
  const err = new Error(`collection run ${runId} did not reach a terminal status after ${maxPolls} polls`);
  err.code = 'RUN_NOT_TERMINAL';
  err.status = last?.status;
  throw err;
}

/**
 * Page all items out of a run. A terminal run's items are stable, so this reads
 * until `complete` is true (or the collector stops handing back a cursor).
 *
 * @param {object} client
 * @param {string} runId
 * @param {number} pageSize
 * @returns {Promise<Array<object>>}
 */
async function pageAllItems(client, runId, pageSize) {
  const items = [];
  let cursor = null;
  // Bounded so a misbehaving collector can never spin forever.
  const maxPages = 1000;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await client.getRunItems(runId, cursor, pageSize);
    const batch = res?.items ?? [];
    items.push(...batch);
    if (res?.complete || !res?.nextCursor || batch.length === 0) break;
    cursor = res.nextCursor;
  }
  return items;
}

/**
 * Trigger a collector run, pull every item, and persist them through the
 * NovrPulse store adapter.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.sourceIds]      registry slugs to collect (default: all enabled)
 * @param {number}   [opts.maxAgeDays]
 * @param {number}   [opts.pageSize]       page size for item paging (default from config)
 * @param {number}   [opts.maxPolls]       status-poll budget (default from config)
 * @param {number}   [opts.intervalMs]     delay between status polls (default from config)
 * @param {object}   [opts.client]         collector client override (tests)
 * @param {object}   [opts.adapter]        store adapter override (tests)
 * @returns {Promise<{ runId:string, status:string, items:number, stored:number, skipped:number, events:number }>}
 */
export async function pullItemsAndCreateEvents({
  sourceIds,
  maxAgeDays,
  pageSize = config.novrpulse.collection.pageSize,
  maxPolls = config.novrpulse.collection.maxPolls,
  intervalMs = config.novrpulse.collection.pollIntervalMs,
  client,
  adapter = novrPulseAdapter,
} = {}) {
  const api = client ?? createCollectionClient();
  const log = logger;

  const { runId, status: startStatus } = await api.startRun({ sourceIds, maxAgeDays });
  log.info({ runId, startStatus, sourceIds: sourceIds ?? 'all-enabled' }, 'collection run started');

  const run = await awaitTerminal(api, runId, { maxPolls, intervalMs });

  // A 'partial' run (some sources ok, some stale/failed) still carries valid
  // items — never discard them. A 'failed' run is only an error when it truly
  // has nothing to store; if it somehow carries items, prefer storing them (the
  // collector reserves 'failed' for zero-item runs, so the throw is the norm and
  // the store path is a defensive guard, not a silent success).
  if (run.status === 'partial') {
    const failed = (run.sources ?? []).filter((s) => s && s.ok === false).length;
    log.warn({ runId, failed, itemCount: run.itemCount }, 'collection run partial: some sources failed');
  }

  const items = await pageAllItems(api, runId, pageSize);

  if (run.status === 'failed') {
    if (items.length === 0) {
      const err = new Error(run.error ?? 'collection run failed');
      err.code = 'RUN_FAILED';
      err.runId = runId;
      throw err;
    }
    log.warn({ runId, items: items.length }, 'collection run reported failed but returned items: storing them');
  }

  // Sources are resolved from the SHARED engine registry (the collector collects
  // the same registry), so `storeRun` can ensure every parent row exists first.
  const selected = sourceIds?.length
    ? allSources().filter((s) => sourceIds.includes(s.id))
    : enabledCollectorSources();

  const summary = await storeRun({ items, sources: selected }, { adapter, sources: selected, logger: log });

  log.info({ runId, items: items.length, ...summary }, 'collection run pulled and stored');
  return { runId, status: run.status, items: items.length, ...summary };
}

/** Sleep helper for the poll loop. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { pullItemsAndCreateEvents };
