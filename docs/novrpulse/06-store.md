# NovrPulse — Phase 1 store

Phase 1 · task 8 · 2026-11-09

One store, eight views (plan §0). Collectors produce items; this is where they
land. The store is **the event store** — `raw_document` (the immutable fetched
artefact) and `event` (the core object the eight projections read), joined by
`event_source` for provenance. It implements `02-event-schema.md`, restricted to
the Phase 1 subset.

## 1. What was added

| File | Role |
|------|------|
| `backend/prisma/schema.prisma` | `NpSource`, `NpRawDocument`, `NpEvent`, `NpEventSource` models |
| `backend/prisma/migrations/20261109180000_add_novrpulse_store/` | the migration (4 new tables, additive only) |
| `backend/src/services/novrpulse/store/index.js` | persist logic: `upsertSource`, `seedSources`, `storeItem`, `storeRun` |
| `backend/scripts/collect-store.mjs` | collect → store, **dry-run by default** |
| `backend/test/novrpulseStore.test.mjs` | persistence + idempotency tests (skip without a DB) |

## 2. Tables (live on Supabase)

| Table | Role |
|-------|------|
| `np_source` | registry mirror of `00-source-register.md`; queryable copy of the code registry |
| `np_raw_document` | immutable fetched artefact; `contentHash` **unique** (dedupe layer 1); holds the raw publisher `body` |
| `np_event` | the core object; `functions[]` is what makes the eight views cheap; `summary` is NovrPulse's own words |
| `np_event_source` | provenance; every event claim traces to a raw document |

Indexes follow the frozen schema: `publishedAt desc`, `(severity, publishedAt)`,
`clusterId`, `raw_document(sourceId, fetchedAt)`, and the unique `contentHash`.

### Deliberately deferred

- **pgvector is not installed** on the database (verified 2026-11-09), so the
  `embedding vector(1536)` column is omitted. It is added with the understanding
  layer, when embeddings actually exist. Enabling pgvector is a Supabase action.
- **Entity, alias, publish_item, correction, alert_rule** tables are not created
  yet — they belong to the understanding and projection layers.

## 3. Running it

```bash
npm -w backend run collect:store                 # DRY RUN — writes nothing
npm -w backend run collect:store -- --commit     # write to the database
```

`collect-store.mjs` is **dry-run by default** so an accidental invocation cannot
write to the live database. Only `--commit` persists.

## 4. Idempotency (the whole point)

The collector has no "already seen" memory, so a repeated run re-emits the
current feed window. Storing must therefore be idempotent, and it is, two ways:

1. **Content hash.** `np_raw_document.contentHash` is unique. If the hash exists,
   the item is skipped — nothing is written.
2. **Canonical URL.** Two sources can carry the same story (different hash, same
   URL). The second attaches to the existing `np_event` via a new
   `np_event_source` row instead of creating a duplicate event. This is a
   **database guarantee**: `np_event.canonicalUrl` carries a unique index
   (nullable, so many NULLs are allowed), not just an application check.

Verified live on 2026-11-09: first `--commit` stored 1 new; the second stored
**0 new, skipped 1 duplicate**; the DB held 1 raw document and 1 event.

### Atomicity

`storeItem` writes the raw document and the event (or attach row) inside a single
`prisma.$transaction`. Without it, a crash between the two writes would leave a
raw document whose unique hash makes every later run treat the item as a
duplicate — a permanently unreachable item.

### Reconcile

`seedSources()` upserts every registry source **and disables** any `np_source`
row whose id is no longer in the registry (`enabled = false`, never deleted, so
its documents survive for audit). This keeps the DB from drifting from the
authoritative allowlist (source policy §6).


## 5. Boundary rules (kept clean)

- **`body` stays on the raw document.** The publisher's full text is retained in
  `np_raw_document.body` (e.g. 1,837 chars for the first stored item) and is
  **never** copied into `event.summary`. `summary` is created empty and is
  written only by the understanding layer (copyright policy §3).
- **No understanding in the store.** No function tagging, entities, severity, or
  embeddings. `functions` is `[]` and `severity` is null on stored events until
  the understanding layer fills them.
- **Confidence defaults to `reported`** — the lowest level — and is only raised
  with evidence.

## 6. A migration hazard worth recording

The first attempt used `prisma migrate diff --from-schema-datasource`, which
compares against the **live database**. Because the DB contains tables Prisma
does not manage (`intel_items`, `intel_runs`, `subscribers`,
`ceap_scholarship_applications`), Prisma emitted **`DROP TABLE` for all four** —
a data-destroying migration. It was caught before applying.

The safe method, now used, diffs a **baseline schema** (existing models only)
against the full schema, producing only additive `np_*` statements. **Never
generate NovrPulse migrations with `--from-schema-datasource` against this DB.**

Also note: a PowerShell `>` redirect wrote the migration as UTF-16 (BOM +
embedded nulls), which Postgres rejected with *"string contains embedded null"*.
Migrations must be written as **UTF-8 without BOM** (use .NET
`UTF8Encoding($false)`, not `Set-Content -Encoding utf8` on PS 5.1).

## 7. What remains after the store

The store closes the collection → persistence gap. Still open: the understanding
layer (entities, function tagging, the LLM summary that fills `event.summary`),
the eight projections and `publish_item`, and the non-RSS collectors. See the
README status table for the live state of the plan's ten tasks.
