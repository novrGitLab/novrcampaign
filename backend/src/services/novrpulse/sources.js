/**
 * NovrPulse source registry — thin re-export shim.
 *
 * The registry (42 sources, `allSources`/`getSource`/`sourcesByTier`/
 * `enabledCollectorSources`/`registryStats`) now lives in the shared engine
 * `@novr/ingest` so the in-app collector and the standalone collector share ONE
 * authority with ZERO copies. This module re-exports the engine symbols so
 * existing NovrPulse consumers (`ingest.js`, `scripts/sources.mjs`, tests) keep
 * working unchanged.
 *
 * @typedef {'rss'|'html'|'pdf'|'api'|'json'} SourceType
 * @typedef {'verified'|'unverified'|'dead'|'no-feed'|'blocked'} SourceStatus
 * @typedef {object} Source
 * @property {string} id            stable slug
 * @property {string} name
 * @property {string} url           primary site URL
 * @property {string} region        'NG' | 'GH' | 'KE' | 'ZA' | 'AF' | 'GLOBAL'
 * @property {number} tier          1=identity regulator, 2=local spine, 3=press, 4=global filler
 * @property {number[]} functions   NovrPulse functions this source feeds (1..8)
 * @property {SourceType} type
 * @property {boolean} hasRss
 * @property {string} licence       licence status ('unknown' until verified)
 * @property {boolean} paywall
 * @property {string} owner
 * @property {boolean} enabled
 * @property {string} status
 * @property {string} [feedUrl]
 * @property {string} [note]
 */

export {
  SOURCES,
  allSources,
  getSource,
  sourcesByTier,
  enabledCollectorSources,
  registryStats,
} from '@novr/ingest';

export { default } from '@novr/ingest/sources';
