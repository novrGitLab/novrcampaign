# NovrPulse — Engineering Assessment

**Date:** 2026-11-17 · **Type:** read-only baseline assessment · **Author:** Kilo
**Status:** recommendations only — **no code, schema, or dependency changes made.**
Awaiting operator approval before any implementation.

---

## 0. How this was produced

Per the toolkit's mandatory lifecycle, this assessment **inspected before judging**
and **did not modify anything**. Evidence is `file:line`; every command was run and
its real result is reported.

**Commands run (exact) and results:**

| Command | Result |
| --- | --- |
| `npm test` (root) | `@novr/ingest`: 38 pass / 0 fail; `backend`: 49 pass / 0 fail |
| `npm run lint` (root) | backend, frontend, `@novr/ingest` all clean, `--max-warnings 0` |
| `git ls-files \| measure` | 145 tracked files |
| `git ls-files "*.ts" "*.tsx" "tsconfig*"` | **0** — no TypeScript in the project |

**Not run:** no integration/e2e against a live database (none available locally);
no `npm audit`; no production access. These are called out where they matter rather
than assumed.

**Independent review:** two read-only passes (security; architecture/testing) were
run as separate agents, then key claims were re-verified directly against source
before inclusion.

---

## 1. What NovrPulse actually is (baseline)

An internal email-campaign dashboard ("thin BFF") over the **Plunk** API, plus an
**encrypted file drive**, plus an in-progress **news ingestion product** (NovrPulse).

```
npm workspaces:  backend (Express + Prisma) · frontend (React/Vite) · packages/ingest
deploy:          Vercel (vercel.json) · DB: Supabase Postgres via Prisma
auth:            JWT (dashboard) + cookie session (drive) — two separate systems
tests:           node --test (no framework)
```

**Layering:** `routes → controllers → services → prisma` is real and mostly respected.
**Frontend:** `components / pages / hooks / lib` with TanStack Query.
**Engine:** `packages/ingest` is a genuinely reusable, dependency-injected engine;
`backend/src/services/novrpulse/*` is a clean consumer of it.

**Important tooling-context note:** the toolkit's standards assume a **TypeScript +
Supabase-RLS + Zod** stack. This project is **JavaScript (ESM) + Prisma + Joi**.
Rules like "TypeScript strict mode is required", "validate with Zod", and "RLS on
every exposed table" therefore need interpreting rather than transcribing:

- **No TypeScript** — `20-typescript.md` cannot be satisfied without a
  project-wide migration. Treat as a deliberate, documented project decision
  (AGENTS.md "Codebase section"), not silent non-compliance.
- **No RLS is *correct* here.** RLS is required for tables exposed through
  PostgREST to `anon`/`authenticated`. But this database is reached **only**
  server-side through Prisma; there is no Supabase client or PostgREST exposure.
  So RLS is **not the applicable control** and its absence is not a finding. The
  applicable control is server-side authorization, which does exist.
- **Joi, not Zod** — same purpose (boundary validation). Joi is established here;
  swapping it would be churn without value.

---

## 2. Architecture and code quality

**Strengths**
- The `packages/ingest` engine is the healthiest code in the repo: no app imports,
  everything injected (`store/index.js:34`, `pipeline.js:80`), clean consumer
  boundary (`backend/src/services/novrpulse/adapter.js`, `analysers.js`).
- Backend layering is real; services do not import Express; `AppError`/`logger`
  are leaf modules with no circular dependencies.
- Frontend uses one data-fetching library consistently (TanStack Query).
- Schema has deliberate index coverage (`schema.prisma`: `@@unique([canonicalUrl])`,
  `@@index([publishedAt(sort: Desc)])`, `@@unique([fileId, index])`, etc.).

**Findings**

| # | Severity | Location | Issue |
| --- | --- | --- | --- |
| A1 | high | `backend/src/controllers/driveController.js:33-413` | 431-line **god-controller**: password policy, auth lockout, upload-quota math, GCM integrity re-decrypt, streaming download, cron — all in one file. Hard to review; the security-critical parts are not isolated. |
| A2 | medium | `backend/src/controllers/campaignController.js:141-208` | `resendUnsent` is a full domain algorithm (event pagination, audience reconstruction, segment creation) living in a controller. Untested. |
| A3 | medium | `feedController.js:55-189`, `campaignController.js:224-262`, `healthRoutes.js:10-27` | Controllers and a route handler query Prisma directly, bypassing any service layer. |
| A4 | medium | `middleware/validate.js` vs in-controller `schema.validateAsync` | **Two** validation mechanisms; the middleware is wired into only 2 of ~9 routes (`authRoutes.js:13`, `driveRoutes.js:24,33`). Also inconsistent status codes: `validate.js:21` returns 422, tests assert 400. |
| A5 | low | `backend/src/config/env.js:39` | Stale comment ("SQLite keeps the internal deployment dependency-free") contradicts the Postgres schema. `README.md:3` says "NovrPulse" but `package.json` name is still `novrcampaign`. |
| A6 | low | `backend/src/services/novrpulse/understand/seedAliases.js` | Dead code: `seedAliases`/`ENTITY_SEED` are never imported anywhere — the intended "entity moat" seed is unwired. |

**Frontend**
- `frontend/src/pages/Contacts.jsx:535-583` — `PasteListModal` hand-rolls a
  concurrency pool, dedupe, and direct `api()` calls, bypassing the
  `hooks/mutations.js` layer and duplicating server-side validation.
- `frontend/src/pages/CampaignBuilder.jsx:96-190` — dirty-tracking + template
  hydration logic inline in the component.

---

## 3. Security vulnerabilities

Reported with severity, `file:line`, evidence, exploitation, remediation. All were
traced to source, not inferred from a summary.

### S1 — `critical` — JWT signing secret falls back to a hardcoded default
**`backend/src/config/env.js:45`** (used at `middleware/auth.js:15`, `authController.js:17`)
```js
secret: required('JWT_SECRET', 'dev_secret_change_me'),
```
`required()` only throws when the value is `undefined`; a hardcoded fallback means a
missing `JWT_SECRET` silently signs tokens with a publicly-known key. There is **no
boot-time rejection** of the default in production.
**Exploitation:** forge `jwt.sign({ sub: '<known-user-id>' }, 'dev_secret_change_me')`
→ `requireAuth` checks only the signature and that `sub` exists → full dashboard
access (contacts, bulk-delete, campaign sends).
**Remediation:** in production, fail closed at boot when `JWT_SECRET` is missing or
shorter than 32 chars; remove the fallback for prod. Add `algorithms: ['HS256']` to
`jwt.verify` (currently unpinned, `auth.js:15`) and `algorithm: 'HS256'` to `sign`.

### S2 — `critical` — Webhook verification fails **open** when the secret is unset
**`backend/src/controllers/webhookController.js:20-23`**
```js
if (!secret) { if (config.isProd) logger.error(...); return true; }
```
`PLUNK_WEBHOOK_SECRET` defaults to `''` (`env.js:57`), so an unset secret means
**any** POST to `/api/webhooks/plunk` is accepted.
**Exploitation:** POST forged `email.bounce` / `email.complaint` events to poison
suppression/alerting state with no credential.
**Remediation:** fail **closed** — return `false` when the secret is missing, and
refuse to start in production without it. (The timing-safe comparison itself is
correct: `timingSafeEqual` after a length check, HMAC over `req.rawBody`.)

### S3 — `high` — Default seeded admin credentials in source
**`backend/prisma/seed.js:8-9`** → `admin@novrcampaign.local` / `admin12345`
(defaults), and the plaintext password is **logged**.
**Exploitation:** any deployment that ran `db:setup` without overriding
`SEED_PASSWORD` has a live known admin account.
**Remediation:** require `SEED_PASSWORD` with no default, enforce the drive's
password policy, stop logging the password.

### S4 — `medium` — Drive CSRF allowlist includes the request's own `Host`
**`backend/src/middleware/driveAuth.js:52-63`** — `allowed` contains `req.get('host')`.
The real protection is `SameSite=Strict` on the session cookie
(`driveSession.js:68`); the origin check adds ~nothing against non-browser clients.
**Remediation:** compare strictly against `config.frontendUrl` hosts only; drop
`req.get('host')`. Keep `SameSite=Strict`; add a double-submit CSRF token for
mutating drive endpoints.

### S5 — `medium` — Rate limiting is per-process in-memory
**`backend/src/middleware/rateLimiter.js:8-25`**, `app.js:60` (`trust proxy: 1`).
On Vercel/serverless each instance has its own counter → distributed brute-force
bypasses the login limit. Dashboard login also lacks a per-account lockout (the
drive has one).
**Remediation:** add per-account lockout to dashboard login (mirror the drive),
and either a shared rate-limit store or a documented exact `trust proxy` hop count.
Note the toolkit's own guidance: do not add Redis without a demonstrated need —
start with the lockout, escalate to a shared store only if the topology requires it.

### S6 — `low` — Drive download-token expiry not type-validated
**`backend/src/services/driveToken.js:36`** — `Number(expires) < Date.now()` is
`false` for `NaN`. Only exploitable if `DRIVE_TOKEN_SECRET` leaks.
**Fix:** `const exp = Number(expires); if (!Number.isFinite(exp) || exp < Date.now()) return null;`

### S7 — `low` — `CRON_SECRET` compared with non-constant-time `!==`
**`backend/src/controllers/driveController.js:391-393`** — use the existing
`timingSafeEqualString`, matching the rest of the drive.

**Verified clean:** injection (no string-built SQL; the only `$queryRawUnsafe` is
Prisma-generated or dev boilerplate), SSRF (no server fetch of user-supplied URLs),
mass assignment (Joi `stripUnknown`; `role` never client-supplied), secret redaction
in logs (`logger.js:9-24`), drive crypto (AES-256-GCM, per-chunk IV, KEK/recovery
wrapping — sound), user enumeration (generic messages on both logins), and
server-side authz on dashboard routes.

**Not verified (stated honestly):** no `npm audit` was run; no live exploitation was
attempted; S1–S3 are judged from source only.

---

## 4. Performance and optimisation

**Findings**

| # | Severity | Location | Issue |
| --- | --- | --- | --- |
| P1 | medium | `git ls-files` root | 3 MB `.docx`, `.pdf`, `.xlsx` committed at repo root — inflates clone/CI, not build-affecting. |
| P2 | low | `backend/src/utils/providerRateLimiter.js` | In-process fixed-window only (correct per toolkit §6 until measured otherwise). |
| P3 | low | `frontend/src/pages/*` | Inconsistent UX (some `window.alert`, some inline banners) — not a perf issue, but untestable paths. |

**Positives:** outbound Plunk calls are bounded with backoff + `Retry-After`
honoring; the drive **streams** downloads (does not buffer); the ingest engine
bounds fetch size (5 MB cap) and concurrency; schema indexes match real predicates.
No N+1 was found in the reviewed controllers.

**No optimisation is recommended without measurement.** Per `performance-standards.md`,
every change below needs a stated before/after metric first. The one safe,
evidence-based cleanup is P1 (repo weight), which is not a code change.

---

## 5. Component reusability

| # | Severity | Location | Issue |
| --- | --- | --- | --- |
| R1 | medium | `backend/src/services/feedWeek.js:15-48` ↔ `frontend/src/lib/feedWeek.js:12-34` | Week math duplicated across workspaces (deliberate mirror, but two sources of truth). |
| R2 | medium | `campaignController.js:25`, `segmentController.js:24`, `templateController.js:18`, `plunkService.js:606`, `frontend/hooks/queries.js:6` | The "unwrap messy Plunk list envelope" pattern is re-implemented in **5** places. |
| R3 | low | `frontend/src/pages/Feed.jsx:115-157` ↔ `components/feed/FeedPickerPanel.jsx:57-74` | Week-navigator + filter-pill pattern duplicated. |
| R4 | low | `frontend/src/components/feed/FeedPickerPanel.jsx:8-15` | `escapeHtml` (a generic util) lives in a component file. |
| R5 | low | `backend/package.json:48` + `packages/ingest/package.json:19` | `openai` declared in **both**; the engine owns the client, so backend's direct dep is unnecessary. |

The reuse **procedure** (`architecture-standards.md §4`) says don't abstract until a
second use exists — R2 already has five uses, which clears the bar.

---

## 6. Testing coverage

**Suite:** `node --test` only. **38** engine tests + **49** backend tests, all passing.

| Covered well | Gaps (high-risk, untested) |
| --- | --- |
| Ingest engine: SSRF guards, size caps, parsers, pipeline statuses, store contract (memory adapter) | **Dashboard auth** (`authController`, `requireAuth`, JWT) — none |
| Drive crypto (GCM round-trip, tamper), download token, 60s tokens | **Webhook signature verification** (`webhookController.js:16-40`) — none |
| Feed week math, Joi schemas, NovrPulse registry/analysers | **NovrPulse `storeBatch` DB idempotency** (`adapter.js:81-148`) — never tested against a DB |
| | **Drive `driveController` quota math, `completeUpload`** — untested |
| | **`campaignController.resendUnsent`** — untested |

**Test-quality issues**
- `driveAuth.test.mjs:97` and `driveE2E.test.mjs:103` **silently skip** without a
  live Postgres → green CI can hide zero drive coverage.
- Env-order fragility: drive tests must set `process.env` before `import()`
  because `config` freezes on first import.
- LLM stubs (`novrpulseCollector.test.mjs:72`) never exercise the retry /
  schema-failure branches of `createLlm`.

No tests fail. **No test was weakened or invented.** Every number above came from
`npm test`.

---

## 7. Technical debt

**Committed junk / artefacts**
- `backend/scripts/tmp-probe.mjs`, `tmp-intel.mjs` (uses `$queryRawUnsafe`), `tmp-e2e.mjs` — ad-hoc debug scripts.
- Root: `AGENTS.md.bak.20261117213711` (0 bytes), `Cybersecurity Newsletter October week 1.docx` (3 MB), `INTEL POOL SPEC.pdf`, `NovrPulse_Sources.xlsx`.
- Stale Prisma generate temps: `backend/src/generated/prisma/query_engine-windows.dll.node.tmp{19708,27212}` (generated dir is gitignored; the temp files are local cruft).

**Dead / unwired code**
- `seedAliases.js` (never called), `config.redisUrl` (`env.js:42`, comment says Redis was dropped), `runUnderstanding`/`understandEvent` (no `src` caller).

**Inconsistent error handling**
- Two validation strategies (A4); frontend mixes `window.alert` and inline banners
  (`Feed.jsx:87`, `Contacts.jsx:111`, `CampaignBuilder.jsx:271`).

**Dependency hygiene**
- `openai` duplicated (R5); `pino-pretty` is a dev transport but sits in
  `dependencies`.

---

## 8. Recommended improvements (NOT yet implemented)

Ranked by risk-reduction ÷ effort. **Nothing here is done; this awaits approval.**

| Priority | Item | Why first | Effort |
| --- | --- | --- | --- |
| **P0** | **S1** fail-closed `JWT_SECRET` + pin algorithm | Forgeable admin tokens; one-line boot guard | S |
| **P0** | **S2** fail-closed webhook secret | Credential-free event injection | S |
| **P0** | **S3** remove default seed password | Known live admin credential | S |
| **P1** | Tests for **webhook verify** and **dashboard auth** | Security-critical, currently zero coverage | M |
| **P1** | Tests for **`storeBatch` DB idempotency** | The engine's core invariant, unverified against a DB | M |
| **P1** | **S4/S6/S7** drive hardening | Same-origin, token-expiry, constant-time | S |
| **P2** | Split **`driveController`** (A1) into services | Reviewability of security-critical code | M |
| **P2** | Unify validation (A4) on the `validate` middleware | Removes a class of gaps | M |
| **P3** | Remove committed junk + dead code (A6, §7) | Cheap hygiene | S |
| **P3** | De-duplicate Plunk unwrap (R2) and `openai` dep (R5) | Reuse + weight | S |

**Deliberately NOT recommended now** (would be churn or unproven):
- A TypeScript migration (project-wide; a project decision, not a finding).
- Adding Redis / a shared rate-limit store before S5's lockout is tried.
- Any performance micro-optimisation (no measurement exists).
- RLS (not the applicable control without PostgREST exposure).

---

## 9. Summary

The project is **functionally solid and lint/test clean**, with an exceptionally
clean reusable engine and honest layering. The dominant risk is **three
fail-open / default-secret issues (S1–S3)** that can each grant full access or
allow forged events, and a **near-total absence of tests on the security-critical
auth and webhook paths**. The 431-line drive controller is the main maintainability
debt. No structural rewrite is warranted; the P0 fixes are small and high-impact.

**Status: assessment complete. No files changed. Awaiting approval before any
implementation.**
