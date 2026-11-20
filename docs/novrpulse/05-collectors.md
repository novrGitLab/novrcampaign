# NovrPulse — Phase 1 collectors (regulator/CERT)

Phase 1 · task 9 · 2026-11-09 · **doc reconciled 2026-11-18**

> **Doc status (2026-11-18):** the collectors were later refactored into the
> reusable `@novr/ingest` package (`packages/ingest`). File paths and test
> references below were corrected to match the code as it stands today; the
> original 2026-11-09 run figures are kept as historical evidence and labelled
> where they are no longer current.

The first collectors: the **confirmed-RSS regulator/CERT sources** from the
2026-11-09 probe (register §7) — NCC, NITDA, NDPC. CBN (PDF), ngCERT, EFCC and
NPF-NCCC are deliberately **not** collected yet (see §6).

This implements plan §4: collectors decide *what NovrPulse knows*; they do not
decide meaning. Fetching and parsing are deterministic code. No LLM, no
database, no projection.

## 1. What was built

| File | Role |
|------|------|
| `backend/src/services/novrpulse/sources.js` | source registry (code mirror of the register rows the collectors use) |
| `packages/ingest/src/fetch/index.js` | polite GET: UA, timeout, retry, **5 MB response cap** (was `novrpulse/httpFetch.js`) |
| `packages/ingest/src/parse/rss.js` | pure RSS 2.0 / Atom parser → normalized items (was `novrpulse/feedParser.js`) |
| `packages/ingest/src/pipeline.js` | run enabled collectors, bounded concurrency, canary verdict, health report |
| `backend/src/services/novrpulse/ingest.js` | NovrPulse wiring: `runCollectors` / `collectAndStore` over the engine |
| `backend/scripts/collect.mjs` | CLI (`npm -w backend run collect`) |
| `backend/scripts/collect-store.mjs` | CLI: collect → store (dry run by default, `--commit` to persist) |
| `packages/ingest/test/parse.test.mjs` | parser unit tests (no network) |
| `packages/ingest/test/fetch.test.mjs` | response-size-cap tests (stubbed `fetch`, no network) |
| `backend/test/novrpulseCollector.test.mjs` | NovrPulse consumer wiring: enabled-set scope + canary/registry tests (no network) |

## 2. Running it

```bash
npm -w backend run collect                    # all enabled sources
npm -w backend run collect -- ncc             # restrict to one source id
npm -w backend run collect -- --json          # machine-readable report
npm -w backend run collect -- --out run.json  # write the payload to a file
npm -w backend run collect -- --max-age-days 14  # widen the freshness window
```

The default freshness window is **7 days** (see §4). Exit code is `0` only when
every enabled source is healthy *and fresh*.

Exit code is `0` when every enabled source is healthy **and fresh**, `1`
otherwise — so it can be used as a CI/cron health gate. A live run on 2026-11-09
with the default 7-day window returned (historical — this was the original
3-regulator run, before the enabled set grew):

```
OK    ndpc       ok               1 fresh /  10 seen  (newest 2026-11-06)
FAIL  ncc        stale            0 fresh /  10 seen  (newest 2026-08-12)
FAIL  nitda      stale            0 fresh /  10 seen  (newest 2026-09-15)
Overall: ATTENTION REQUIRED
```

## 3. The canary (plan §3.1)

Every run produces a **canary verdict** so a silent layout change alerts instead
of quietly emptying the feed. A source passes only when:

- it returns at least 1 item,
- **at least half** its items carry a link, and
- at least one item has a title.

Verdict shape: `{ hasItems, hasTitles, linksIntact, hasDates, itemCount, passed }`.
A failing canary returns `status: 'canary_failed'` and logs a warning; the runner
reports the source as unhealthy. The collector never throws on a bad feed — it
reports a status (`ok` / `canary_failed` / `fetch_failed` / `parse_failed` /
`stale` / `disabled`) so one broken source cannot abort the run.

## 4. Freshness ("latest news" is the product)

NovrPulse is a *latest news* platform, so a feed that parses cleanly but carries
nothing recent must **not** look healthy. Two rules enforce this:

- **Items older than the window are dropped.** Default window: **7 days**
  (`--max-age-days` overrides). Undated items are also dropped — an undated item
  cannot be shown to be fresh.
- **A source with zero fresh items is `stale`, not `ok`.** The run reports
  `totalSeen` (items in the feed) and `newestAt` (newest item date) so a stale
  feed is diagnosable, and the overall run is unhealthy.

This caught a real problem on 2026-11-09: **NCC and NITDA feeds were 2–3 months
stale** (NCC newest 2026-08-12, NITDA 2026-09-15); only NDPC (2026-11-06) was
current. RSS alone therefore does **not** give daily freshness for these
regulators — the freshness gate makes that visible instead of silently serving
old news. Closing the gap needs the source-specific work in §6 (PDF/notice
sources, paging via a `last_success_at` watermark).

## 5. What is retained vs. what is written later

Each item carries two distinct text fields:

- `content` — the raw feed text, which for most publisher feeds is the **full
  article body**. Stored verbatim so nothing is lost (NCC items run up to
  ~6,200 chars). This is the publisher's words.
- `summary` — **empty**. NovrPulse's own summary is written by the understanding
  layer (Phase 2). The collector never fabricates one, because a generated
  summary from the raw body would be a close paraphrase (copyright policy §3).

So the full contents are captured; the *summary* is deliberately left blank.

## 6. Deliberately not built yet

| Source | Why not | What it needs |
|--------|---------|---------------|
| CBN | notices are **PDFs** | a dedicated PDF collector (vision extraction, page refs) |
| ngCERT | probe **blocked** (403 WAF) | re-probe from prod IP; advisory/PDF pattern |
| EFCC | no feed (HTML) | HTML collector + defamation rules |
| NPF-NCCC | probe **blocked** (429) | re-probe; HTML collector |

Enabling any of these means editing the markdown register first (source policy
§1) and flipping `enabled: true` in `sources.js`. **Corrected 2026-11-18:** the
enabled set is no longer just the three regulators. It is now **19 feed-backed
sources** (regulators, NG/AF tech and global security), asserted explicitly in
`backend/test/novrpulseCollector.test.mjs` (which pins the 19 ids) so an
accidental enable is still caught. The original `{ncc, ndpc, nitda}` assertion
described only the initial 2026-11-09 regulator subset.

## 7. What this does NOT do (and where it lands)

- **No persistence.** The runner returns items + health; it writes nothing. The
  Phase 1 store step wires the output into Postgres (`raw_document`/`event`),
  dedupe layers and the raw store. Keeping the runner storage-free means the
  collection contract is settled and tested *before* a schema is committed to —
  which is what lets `02-event-schema.md` stay frozen.
- **No dedup, no entities, no function tagging, no summary.** Those are the
  understanding layer (Phase 2) and must not leak into collection (plan §4).
- **No licence enforcement yet.** All registry rows are `licence: 'unknown'`.
  Collection is RSS-only meanwhile, per source policy §1 (HTML scraping of an
  unknown-licence source is forbidden). The licence column still needs filling
  in (register §6).

## 8. Notes for the next step (store)

- Items carry a stable `contentHash` (sha256 of link, or title|date) — this is
  dedupe layer 1 (exact). Layer 2 (SimHash) and layer 3 (semantic) come later.
- `parseFeed` caps at 100 items per feed per run; feeds with more need paging
  via the stored `last_success_at` watermark (not built).
- The collector has no "already seen" memory yet, so a run re-emits the current
  feed window; the store's `content_hash` unique constraint is what makes
  re-ingestion idempotent.
- Store `content` in `raw_document`; leave `event.summary` empty for the
  understanding layer. Never set `publish_item.body` from `content`.

## 9. Dry-run findings (2026-11-09)

A `--out` run over the three regulator feeds (30 items total, before the
freshness window) established:

- **Content is captured.** `content` holds the full publisher text (NCC items up
  to **6,192 chars**, avg 1,650). It is retained for storage but must never be
  projected as NovrPulse copy (copyright policy §3).
- **RSS is a fixed window and two of three feeds are stale.** Items spanned
  **2026-05-20 → 2026-11-06**; with a 7-day window only NDPC yields a fresh item
  (NCC newest 2026-08-12, NITDA 2026-09-15). RSS alone will not deliver daily
  freshness for these regulators — the watermark/paging in the store step, plus
  PDF/notice sources (CBN), are what close that gap.

Field quality was otherwise clean: 30/30 items had a link and a date, and 30
distinct `contentHash` values (no duplicates in this window).
