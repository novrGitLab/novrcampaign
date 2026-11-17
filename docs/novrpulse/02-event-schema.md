# NovrPulse — Data Model (frozen)

Phase 0 artefact · v1 · 2026-11-09 · **frozen before collector code** (plan task 7)

One store, eight views, three tiers. This schema is the interface between
collection, understanding and projection. Freeze it now; changing it after
ingestion starts is expensive.

Target: **Postgres + `pgvector`** (plan §6). JSONB for extracted fields,
`tsvector` for full-text, `pgvector` for embeddings — one datastore.

> Notation: `[]` = array, `[a|b]` = enum. `→` = foreign key. Types are
> illustrative SQL/Prisma, not final DDL.

---

## 1. Tables

### source
Registry mirror of the register CSV/markdown. One row per allowlisted source.

```
source(
  id                pk,
  name              text,
  url               text,
  region            text,              -- 'NG' | 'GH' | 'ZA' | 'AF' | ...
  function_ids      int[],             -- which of the 8 functions it feeds
  type              [rss|html|pdf|api],
  licence           text,
  licence_status    [verified|unknown|restricted|denied],
  paywall           bool,
  has_rss           bool,
  rate_limit        text,              -- e.g. '1 req / 2s'
  reliability       numeric,           -- 0..1, updated by health job
  approved_by       text,
  last_success_at   timestamptz,
  canary_ok         bool,
  created_at        timestamptz
)
```

### raw_document
Immutable fetched artefact. Content-addressed by hash. Never modified; a
re-fetch creates nothing new if the hash matches.

```
raw_document(
  id              pk,
  source_id       → source.id,
  content_hash    text unique,         -- sha256 of normalized bytes
  url             text,
  fetched_at      timestamptz,
  content_type    text,
  storage_key     text,                -- S3/R2 key; regulator PDFs kept long
  http_status     int,
  fetch_error     text null
)
```

### event
The core object. **One event, eight views.** `functions[]` is what makes the
eight projections cheap.

```
event(
  id              pk,
  title           text,
  summary         text,                -- NovrPulse's own words (copyright policy)
  body            text,                -- longer derived text; never a source body
  published_at    timestamptz,         -- source publication time
  canonical_url   text,                -- the one link we point at
  language        text,                -- 'en' | 'fr' | ...
  region          text,
  event_type      [advisory|incident|breach|arrest|fraud|policy|vulnerability|event|opportunity],
  functions       int[],               -- 1..8, one or more
  severity        int,                 -- 0..5; rules floor + model + override
  severity_source [rule|model|override],
  confidence      [reported|confirmed|claimed],
  cluster_id      → cluster.id null,
  embedding       vector(1536) null,   -- pgvector
  search_tsv      tsvector,            -- generated from title+summary+body
  created_at      timestamptz
)
```

### cluster
Near-dup / semantic grouping. Five outlets carrying the same CBN notice become
one cluster, one canonical event, many sources.

```
cluster(
  id            pk,
  canonical_event_id → event.id,
  simhash       bigint,                -- layer-2 near-dup
  member_count  int,
  created_at    timestamptz
)
```

### event_source
Provenance. **Every claim in an event must trace to here** (plan §3.1).

```
event_source(
  event_id        → event.id,
  raw_document_id → raw_document.id,
  extractor_model text,                -- e.g. 'vision-model-vX'
  prompt_version  text,
  page_ref        text,                -- page/section in a regulator PDF
  confidence      [reported|confirmed|claimed],
  extracted_at    timestamptz,
  pk (event_id, raw_document_id)
)
```

> `(extractor_model, prompt_version)` is used to **skip re-extraction**, not just
> to audit it: cache extracted structure per `raw_document.content_hash` keyed by
> model+prompt version. Re-running the extractor only when the version changes
> is what keeps vision-model cost bounded.

### entity
The moat (plan §3.2). Curated, not model-only.

```
entity(
  id              pk,
  type            [org|sector|actor|malware|agency|person_role|location],
  canonical_name  text,
  country         text,
  identifiers     jsonb,               -- e.g. {rc_number, ticker, cbn_code}
  aliases         text[],              -- denormalized; canonical list in entity_alias
  description     text,
  merged_into     → entity.id null,    -- merge path; historical rows repoint
  created_at      timestamptz
)
```

### entity_alias
Curated alias resolution with approval. `GTBank` / `Guaranty Trust` / `GTCO`
resolve to one node.

```
entity_alias(
  alias       text,                    -- normalized, lowercased
  entity_id   → entity.id,
  approved_by text,
  created_at  timestamptz,
  pk (alias)
)
```

### event_entity
```
event_entity(
  event_id    → event.id,
  entity_id   → entity.id,
  role        [mentioned|affected|actor|responsible],
  pk (event_id, entity_id, role)
)
```

### publish_item
The published artefact, kept **separate** from the event so a post can be
corrected without mutating the underlying record (plan §5).

```
publish_item(
  id               pk,
  event_id         → event.id,
  function_id      int,                -- 1..8
  tier             [public|analyst|client],
  body             text,               -- rendered from the function template
  template_version text,               -- see 03-function-templates.md
  confidence       [reported|confirmed|claimed],  -- must meet the function floor
  editor_id        text,
  approved_at      timestamptz,
  published_at     timestamptz null,
  withdrawn_at     timestamptz null
)
```

### alert_rule
Tenant alerting (banks/fintechs). Routing is **deterministic** (plan §4).

```
alert_rule(
  id            pk,
  tenant_id     text,
  sectors       text[],
  functions     int[],
  severity_min  int,
  entity_ids    int[],                 -- match on resolved entities, not strings
  channel       [email|webhook|api],
  active        bool,
  created_at    timestamptz
)
```

### correction
First-class (plan §5). **Never a silent edit.**

```
correction(
  id               pk,
  publish_item_id  → publish_item.id,
  reason           text,
  corrected_by     text,
  redelivered_at   timestamptz null,   -- Phase 2: correction pushes to subscribers
  at               timestamptz
)
```

### audit_log
```
audit_log(
  id      pk,
  actor   text,
  action  text,                        -- 'source.added' | 'item.published' | 'entity.merged' | ...
  object  text,                        -- id or reference
  at      timestamptz
)
```

---

## 2. Design notes that must not be lost

1. **`functions[]` on the event is the whole architecture.** It turns one store
   into eight views. Do not create per-function tables.
2. **`publish_item` is separate from `event` on purpose.** Correct a post without
   mutating the record it came from.
3. **`correction` is first-class and pushes.** It is not an afterthought; see
   `01-policies.md` §4.
4. **Provenance is mandatory, not optional.** An event with no `event_source` row
   is a bug; reject it on ingest.
5. **Extraction is cached by `content_hash` + model + prompt version.** Use
   `event_source.extractor_model/prompt_version` to *skip* work, not just audit.
6. **Entity merge is a designed path, not an ad-hoc fix.** `entity.merged_into`
   lets you merge/split without corrupting historical events. Build the merge
   operation (repoint `event_entity`, add alias, set `merged_into`) before you
   ingest the first document — retrofitting resolution onto a live event store
   is painful.
7. **Alert matching is on `entity_ids`, not strings.** String matching on
   "GTBank" would miss "GTCO"; entity resolution is what makes alerts correct.
8. **Confidence floor is enforced at `publish_item` creation**, per
   `01-policies.md` §6. Default publish action is denied if below floor.

---

## 3. Indexes to add now (not later)

- `event (published_at desc)`, `event (severity desc, published_at desc)`
- `event using gin (functions)` — the "eight views" query
- `event using gin (search_tsv)` — full-text
- `event using ivfflat/hnsw (embedding vector_cosine_ops)` — semantic cluster +
  "related items"
- `raw_document (content_hash)` unique, `raw_document (source_id, fetched_at desc)`
- `event_source (event_id)`, `event_source (raw_document_id)`
- `entity_alias (alias)` unique
- `event_entity (entity_id)`, `event_entity (event_id)`
- `publish_item (function_id, tier, published_at desc)`
- `alert_rule (tenant_id, active)`

---

## 4. Explicitly out of scope for this schema

- **STIX export.** Only if a customer asks (plan §7, Phase 3). Do not model it now.
- **Multi-tenancy beyond `tenant_id` on `alert_rule`.** Reuse the NovrGRC
  tenancy model (plan §6) if it fits; do not build a second auth system.
- **Users / sessions.** Owned by the existing app, not this schema.
- **Per-request translation.** Translate once at ingest into `language`, not per
  read (plan §4).
