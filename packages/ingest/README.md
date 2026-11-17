# @novr/ingest

A reusable ingestion engine: **fetch → parse → understand → persist** for any
feed or API source. It is consumer-agnostic — all app-specific behaviour is
injected — so the same engine can back NovrPulse, a NovrGRC advisory digest, a
news monitor, or anything else. **NovrPulse is consumer #1.**

Location: `packages/ingest` (npm workspace). Depends only on `openai`; no app
code, no database, no config file.

## Why it exists

The first NovrPulse collectors were written inside the app and coupled to its
`prisma`, `logger` and `env`. This package separates the **generic engine** from
the **consumer**: the engine owns fetching, parsing, canaries, freshness,
structured LLM calls to a JSON schema, and the idempotent store contract. A
consumer owns the source registry, the domain prompts, the storage adapter and
the entity policy.

## Public API

```js
import {
  runPipeline, storeRun, collectSource,        // pipeline + store
  createLlm, analyseItem,                       // LLM + understanding
  parseRss, parseWpRest, contentHash,           // parsing helpers
  fetchText, assertFetchable, isBlockedAddress, // fetch + SSRF guards
} from '@novr/ingest';
```

### Collect

```js
const report = await runPipeline({
  sources: [{ id: 'x', type: 'rss', feedUrl: 'https://…', enabled: true }],
  logger,
  maxAgeDays: 7,        // default 7
  concurrency: 3,
});
// report = { ranAt, ok, items: [...], sources: [{ sourceId, ok, status, itemCount, totalSeen, newestAt }] }
```

Statuses are never thrown, always reported: `ok | canary_failed | fetch_failed |
parse_failed | stale | no_parser | disabled`.

### Store (idempotent, adapter-injected)

```js
await storeRun(report, { adapter, sources, logger });
```

The `adapter` contract:

```js
{
  upsertSource(source),
  findRawByHash(contentHash),
  createRaw(sourceId, item),
  findEventByUrl(url),
  createEvent(sourceId, item, raw),
  attachEventSource(eventId, rawDocumentId),
}
```

The engine guarantees: never store the same content hash twice; never create a
duplicate event for the same canonical URL (it attaches instead); never leave a
raw document without a linked event. **Atomicity is the adapter's job**, because
only the adapter knows the storage.

### Understand (analysers injected)

```js
const llm = createLlm({ apiKey, baseUrl, bulkModel, frontierModel });
const { results, errors } = await analyseItem(item, {
  llm,
  analysers: {
    classify: (item, { llm }) => …,   // your schema + prompt
    summarise: (item, { llm }) => …,
    extractEntities: (item, { llm }) => …,
  },
});
```

The engine runs the analysers (bounded concurrency), validates every model
response against your JSON schema, and captures per-analyser failures in
`errors` instead of throwing.

### Fetch (security by default)

```js
await fetchText(url, { maxBytes, timeoutMs, maxAttempts, logger });
```

- **SSRF guard**: blocks loopback, private, link-local, CGNAT, cloud metadata
  (169.254.169.254) and non-HTTP(S) schemes; re-checks after DNS resolution so a
  hostname resolving to an internal IP is refused.
- **Size cap**: streams the body with a running byte count and aborts past it.
- **Timeout + bounded retries** with backoff.

## Adding a new consumer

1. **Source registry** — an array of `{ id, type, feedUrl, enabled, … }`.
2. **Adapter** — implement the six contract methods against your storage.
3. **Analysers** — your domain prompts and rules (optional; skip if you only need
   collection).
4. **Call the engine** — `runPipeline` → `storeRun` → `analyseItem`.

No engine change is required to add a consumer, a new feed format (register a
parser keyed by `type`), or a new model provider (OpenAI-compatible base URL).

## Design rules

- The engine decides **what it can understand**, never what is ingested. It reads
  sources a consumer's registry names.
- Models produce **structured output only**, validated before use.
- Failures are **statuses, not exceptions**, so one bad source cannot abort a run.
- **No secrets in code**; config is injected at construction.

## Tests

```bash
npm -w @novr/ingest test
```

Unit tests only, no network: parsers, SSRF/size guards, pipeline statuses, the
store contract (in-memory adapter), schema validation, and analyser orchestration.
