# NovrPulse — Phase 0 artefacts

Docs-first output of Phase 0, per the v2 build plan (2026-11-09), plus the first
Phase 1 collectors (task 9). No schema migrations, and no changes to the existing
NovrCampaign app: the collectors live entirely under `backend/src/services/novrpulse/`
and are additive. These documents are the interfaces the build implements.

| # | Artefact | Answers plan task |
|---|----------|-------------------|
| [00](00-source-register.md) | Source register (42 rows) + `has_rss` / `licence_status` / `paywall` | tasks 2, 3, 4 |
| [01](01-policies.md) | Source, defamation & contempt, copyright, correction policies (+ data protection, confidence floors) | task 5 |
| [02](02-event-schema.md) | Frozen `Event` schema and related tables | task 7 |
| [03](03-function-templates.md) | The eight function projection templates + cadence + confidence floors | task 7 |
| [04](04-phase0-plan.md) | The two-week manual run, golden set, exit criteria, Phase 1 kill criterion | tasks 1, 6, 10 |
| [05](05-collectors.md) | Phase 1 regulator/CERT collectors: how to run, canary semantics, freshness, what's not built | task 9 |
| [06](06-store.md) | Phase 1 event store: tables, idempotency, dry-run/commit, the migration hazard | task 8 |
| [07](07-understanding.md) | Phase 2 understanding layer: NIM client, tagging, summarisation, entities, alias seed | Phase 2 |
| [08](08-source-register-review.md) | Review of `NovrPulse_Sources.xlsx` (30 sources) + re-verified endpoints | review |

## Architecture: reusable ingestion engine

The collectors/store/understand code was extracted into **`@novr/ingest`**
(`packages/ingest`) — a consumer-agnostic engine (fetch → parse → understand →
persist) with all app-specific behaviour injected. **NovrPulse is consumer #1.**
The engine has no app dependencies (no Prisma, no config file, no logger) and is
reusable by NovrGRC/NovrCampaign or any future consumer. See
`packages/ingest/README.md`.

NovrPulse-specific pieces now live in the backend consumer:
`sources.js` (registry), `adapter.js` (np_* storage), `analysers.js` (domain
prompts), `ingest.js` + `understand/orchestrator.js` (wiring).

## Status of the plan's first ten tasks

| Task | Status |
|------|--------|
| 1. Decide which tier funds Phase 1–2 | **open** — recommendation recorded in `04` §6 |
| 2. Confirm DefenseCERT status, or drop from F3 | **open** — flagged in `00` §1 row 8; unverified |
| 3. Add `has_rss`, `licence_status`, `paywall` | **done** — columns added |
| 4. Probe all 42 sites for RSS | **done 2026-11-09** — 21 feeds confirmed; 9 WAF-blocked rows need a prod-IP re-probe (`00` §7) |
| 5. Write the four policies before first post | **done** — `01` |
| 6. Run eight functions manually for two weeks | **open** — routine + golden set defined in `04` |
| 7. Freeze the Event schema and eight templates | **done** — `02`, `03` |
| 8. Stand up Postgres + pgvector + raw store | **partial** — store tables live on Supabase and persisting idempotently (`06`); pgvector not installed, added with the understanding layer |
| 9. Build collectors for the 8 regulator/CERT sources | **partial** — 3 regulator RSS collectors live (NCC, NITDA, NDPC) with a 7-day freshness gate; CBN/ngCERT/EFCC/NPF-NCCC still need PDF/HTML/re-probe. *(Updated 2026-11-17: beyond the original 3 regulators, the enabled set has since grown to 19 feed-backed sources across regulators, NG/AF tech and global security — see `00` §"Registry stats" and `sources.js`.)* |
| 10. Pick house style + one-line pitch | **partial** — pitch recorded in `04` §4; style written during the run |

## Four changes to the v2 plan, folded in here

These came out of review and are now reflected in the artefacts — flag them if
you disagree:

1. **Entity-resolution merge path is designed, not deferred.** `02` adds
   `entity.merged_into` and a merge operation, because retrofitting resolution
   onto a live event store is painful.
2. **Extraction is cached, not just audited.** `02` uses `content_hash` + model +
   prompt version to *skip* re-extraction — this is the sleeper cost control on
   vision-model PDF parsing.
3. **Defamation structural mitigation.** `01` §2.5 and `03` F7: the public tier
   omits names in arrest items; names, if warranted, go to the analyst tier.
4. **Per-function confidence floors + a concrete Phase 1 kill criterion.** `01`
   §6 and `04` §5 — otherwise the confidence field is decoration and the
   "15 sources" rule is unfalsifiable.

## What is deliberately not here

- Any code, migration, or dependency (Phase 1).
- STIX / multi-tenancy beyond `tenant_id` (Phase 3, only if a customer asks).
- Verified RSS/licence/paywall values (those are the probe pass, plan task 4).
