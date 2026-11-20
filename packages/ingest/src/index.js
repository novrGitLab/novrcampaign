/**
 * @novr/ingest — reusable ingestion engine.
 *
 * Fetch, parse, understand and persist feed/API sources. Consumer-agnostic:
 * all app-specific behaviour is injected (parsers, adapters, prompts, logger).
 * NovrPulse is consumer #1.
 *
 * Typical use:
 *
 *   import { runPipeline, storeRun, createLlm, analyseItem } from '@novr/ingest';
 *
 *   const report = await runPipeline({ sources, logger });
 *   await storeRun(report, { adapter, sources, logger });
 *   const { results } = await analyseItem(item, { analysers, llm });
 */

export { fetchText, assertFetchable, isBlockedAddress, FetchError } from './fetch/index.js';
export { parsers, parseRss, parseWpRest } from './parse/index.js';
export { stripHtml, decodeXmlEntities, parseDate, contentHash } from './parse/item.js';
export {
  collectSource,
  runPipeline,
  filterFresh,
  evaluateCanary,
  MIN_ITEMS,
  DEFAULT_MAX_AGE_DAYS,
} from './pipeline.js';
export {
  SOURCES,
  allSources,
  getSource,
  sourcesByTier,
  enabledCollectorSources,
  registryStats,
} from './sources.js';
export { createLlm, validateSchema, extractJson, LlmError } from './llm/index.js';
export { analyseItem } from './understand/index.js';
export { storeItem, storeRun } from './store/index.js';
