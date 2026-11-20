# NovrPulse — Phase 2: the understanding layer

Phase 2 · 2026-11-09 · **doc reconciled 2026-11-18**

> **Doc status (2026-11-18):** the understanding layer's generic pieces (the LLM
> client and the `analyseItem` orchestration) now live in the `@novr/ingest`
> package (`packages/ingest`); NovrPulse-specific prompts and persistence live in
> the backend consumer. File paths below were corrected to match the code as it
> stands today. The 2026-11-09 live-run findings are retained as historical
> evidence.

Collectors decide *what NovrPulse knows*; the understanding layer decides *how
well we understand it* (plan §4). It reads documents the store already holds and
turns raw text into a usable `event`: a function classification, a summary in our
own words, a severity, and resolved entities. It **never decides what is
ingested.**

## 1. Provider: NVIDIA NIM

The understanding layer is model-driven, so every call goes through a thin
provider-agnostic interface (`packages/ingest/src/llm/index.js`, was
`llm/client.js`) rather than a provider SDK directly.
The first provider is **NVIDIA NIM**, which exposes an OpenAI-compatible API
(`https://integrate.api.nvidia.com/v1`, `POST /v1/chat/completions`), so the
client uses the OpenAI SDK pointed at that base URL.

Models are named **per tier**, so swapping providers or models is a config change,
not a code change:

| Tier | Purpose | Default model | Env var |
|------|---------|---------------|---------|
| `bulk` | tagging, entity extraction, classification | `nvidia/nemotron-3.5-bolt-e4b` | `NP_BULK_MODEL` |
| `frontier` | summaries, F8 analysis | `nvidia/nemotron-3.5-bolt-e4b` | `NP_FRONTIER_MODEL` |

### Model availability (verified 2026-11-09, live)

Most model slugs in NVIDIA's docs are **not callable on the current key**: the
sweep returned **410 Gone** (retired) or **404** (not entitled) for
`meta/llama-3.*`, most `mistralai/*`, `z-ai/glm5.1`, `kimi-k2`, `deepseek-v4`,
and the `llama-3.3-nemotron-super-49b` slug. Two models work:

- **`nvidia/nemotron-3.5-bolt-e4b`** — works, honours `response_format:
  json_object`, returns clean JSON in `content`. **This is the default for both
  tiers.**
- **`nvidia/nemotron-3.5-lightning-30b-a3b`** — works, but is a **reasoning
  model**: its text lands in `reasoning_content` and `content` is empty, so it
  is **unusable for JSON extraction** as-is (our client reads `content`).

`nvidia/nemotron-3-ultra-550b-a55b` exists but timed out (large model). If a
genuinely larger frontier model is wanted later, confirm it responds with JSON in
`content` before setting it.

Note: the free-tier key can list all 84 models via `/v1/models` while most are
not callable — the list is not a reliable entitlement check. Test a slug with a
real chat call before relying on it.


Set `NVIDIA_API_KEY` (`nvapi-...`). When it is unset the layer runs inert: dry
runs and tests work; a `--commit` run throws a clear error rather than failing
silently.

**Structured output only.** Every call passes a JSON schema and the result is
validated before use (`validateSchema`). Non-JSON or off-schema output is
rejected and re-rolled — free text never slips through (plan §3.2).

## 2. What was added

| File | Role |
|------|------|
| `packages/ingest/src/llm/index.js` | provider-agnostic `complete({ tier, system, prompt, schema })`, JSON validation, bounded retry |
| `packages/ingest/src/understand/index.js` | engine orchestration: runs the injected analysers over stored items |
| `backend/src/services/novrpulse/analysers.js` | NovrPulse domain prompts: function tagging, severity floor, entity extraction |
| `backend/src/services/novrpulse/understand/orchestrator.js` | NovrPulse persistence: writes `np_event` / `np_entity` / `np_event_entity`, stores `whatItMeans` |
| `backend/src/services/novrpulse/understand/seedAliases.js` | curated Nigerian entity/alias seed |
| `backend/src/services/novrpulse/understand/index.js` | re-exports the orchestrator + analysers |
| `backend/scripts/understand.mjs` | CLI (`npm -w backend run understand`) |
| `backend/test/novrpulseCollector.test.mjs` | unit tests against a stubbed model (no network) — the dedicated `novrpulseUnderstanding.test.mjs` no longer exists |

Schema additions: `np_entity`, `np_entity_alias`, `np_event_entity` (migration
`20261109200000_np_entities`).

## 3. Running it

```bash
npm -w backend run understand                    # dry run — reports only
npm -w backend run understand -- --seed-aliases  # apply the curated entity seed
npm -w backend run understand -- --commit        # tag + summarise + link (needs API key)
npm -w backend run understand -- --commit --limit 5
```

Default target: events whose `summary` is still empty (not yet understood). This
makes the run **resumable without a queue** — understood work is simply no longer
selected.

## 4. The four understanding steps

**Function tagging** (`analysers.js`, run by the engine's `analyseItem`).
Classifies each event into one or more of the
eight functions. The boundaries are editorial and fuzzy (F1 regulatory vs F7
breaking; F3 education vs F4 campaign) — the plan says tune against a golden set,
which **does not exist yet**, so the prompts encode the rules and the golden set
remains a documented gap. F2 is never assigned (it is a selection from other
views).

**Severity — rules floor + model** (plan §4: "never model-only"). A deterministic
keyword floor can raise severity; the model can propose; `severitySource` records
which won (`rule-floor` | `model`) so an analyst can override later.

**Summarisation** (`analysers.js`) — the copyright-critical step. The publisher's
full text lives in `np_raw_document.body`; this produces an **original** summary
**and a `whatItMeans` layer**, and forbids quoting more than a short phrase or
reproducing sentences (policy §3). Both are persisted onto the event: `summary`
(the "what happened") and `whatItMeans` (the value layer). The real guard is
architectural: neither is the body, and the event always links to the original.

> **Fixed 2026-11-09:** `whatItMeans` was generated on every run and then
> discarded — there was no column for it, and the orchestrator's `body` line was
> a confused no-op. The `np_event.whatItMeans` column was added
> (migration `20261109210000_np_event_what_it_means`) and the orchestrator now
> stores it. This mattered: `whatItMeans` is the product's core value and every
> function template in `03-function-templates.md` has a "what it means" slot.
> Re-running understanding re-processes events whose `whatItMeans` is still
> empty.

**Entity resolution** (`analysers.js` + the orchestrator's alias store) — the moat (plan §3.2). The model proposes
entities; the **curated** `np_entity_alias` table decides. An unknown surface form
creates a **new unapproved entity** (`approvedBy: null`), never an automatic
merge. `GTBank` / `Guaranty Trust` / `GTCO` resolve to one node only via an
approved alias. The seed provides 19 entities / 52 aliases for the regulators,
major banks, fintechs and telcos.

## 5. Confidence floor (policy §6)

Understood events default to `confidence: 'reported'`. The per-function floor is
enforced at **publish** time, not here: F1 requires `confirmed` against the
primary PDF before it may publish, and collection alone never establishes that.
So an F1-tagged event still waits for the F1 review path.

## 6. What is deliberately NOT here

- **No publishing / projection.** This fills `event`; the eight templates and
  `publish_item` are a later step.
- **No embeddings / clustering.** pgvector is not installed on the database, so
  semantic dedupe (layer 3) is deferred until embeddings exist.
- **No human-review console.** `functions`, `severity` and entity links are
  written as current best values; the editor approval UI comes with projection.
- **The golden set.** Nothing here is tuned against real editorial decisions yet,
  because the Phase 0 manual run has not happened. Treat current tagging accuracy
  as unmeasured.

## 7. First live run — findings (2026-11-09)

The first real `--commit` pass over the one stored event (an NDPC awards/summit
story) worked end-to-end. It surfaced three problems, all now fixed:

1. **`whatItMeans` was generated then discarded.** No column existed for it and
   the orchestrator's `body` line was a confused no-op. Fixed: added
   `np_event.whatItMeans` (migration `20261109210000_np_event_what_it_means`) and
   the orchestrator stores it. Re-runs reprocess events whose `whatItMeans` is
   empty.
2. **Severity floor over-fired.** Bare `national` matched "National
   Commissioner", scoring an awards story `severity: 4`. Fixed: the floor is now
   **phrase-based** (`critical national infrastructure`, `ransomware attack`,
   `data breach`, …), not bare words. Live result: **4 → 1**.
3. **Entity extraction pulled ceremony noise.** Royal honorifics (`Oba of …`,
   `Prince …`) and generic roles (`Board Member`, `Executive Director`) were
   extracted. Fixed: tightened the prompt for cyber relevance and added a
   deterministic noise filter (honorific prefixes + generic-role denylist). Live
   result: **18 → 6** entities, all real and relevant.

Also observed: the same agency can link twice (`responsible` + `mentioned`) — by
design, since the link key includes role.

**The golden set still does not exist.** These fixes were made from one item's
output plus general judgement, not from measured editorial decisions. Treat
tagging and severity accuracy as **improved but still unmeasured** until the
Phase 0 manual run produces the golden set.

## 8. Cost note

Bulk work (tagging, entities) runs on the cheap tier; only summaries use the
frontier tier. For 8–30 items a day this is well within low-hundreds monthly. The
sleeper cost remains re-running understanding on prompt changes — the store
already records `extractor_model`/`prompt_version` slots for caching; wiring that
skip is a later optimisation.
