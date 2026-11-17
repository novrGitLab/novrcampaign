# 08 — Feed

Product rename (NovrCampaign → NovrPulse) + a new top-level **Feed** section for
manually recording the week's cybersecurity updates and inserting them into a
newsletter. This document is the **single STOP**: it is approved before any code
is written.

Scope boundary: this plan does **not** touch the `np_*` intel store, its docs, or
its branding. `docs/novrpulse/01-policies.md` and `02-event-schema.md` were read
for reference only; nothing is built against the event schema.

---

## 0. Investigation report (read-only findings)

**Every place "NovrCampaign/novrcampaign" appears** (case-insensitive):

| # | Location | Kind |
|---|----------|------|
| 1 | `README.md:1` (`# NovrCampaign — …`) | UI/doc string → CHANGE |
| 2 | `README.md:48` (`novrcampaign/` tree) | tree label → CHANGE (cosmetic) |
| 3 | `README.md:91` (`admin@novrcampaign.local`) | seed default email → **DO NOT CHANGE** |
| 4 | `package.json:2` (`"name": "novrcampaign"`) | npm name → **DO NOT CHANGE** |
| 5 | `package-lock.json:2,8` | npm name → **DO NOT CHANGE** (regenerated if pkg name changed) |
| 6 | `frontend/index.html:8` (`<title>NovrCampaign · CyberNovr</title>`) | UI title → CHANGE |
| 7 | `frontend/src/pages/Login.jsx:41` (`<h1>NovrCampaign</h1>`) | UI string → CHANGE |
| 8 | `frontend/src/components/Layout.jsx:154` (`NovrCampaign` project chip) | UI string → CHANGE |
| 9 | `frontend/src/pages/CampaignBuilder.jsx:32` (email signoff "The NovrCampaign team") | UI string → CHANGE |
| 10 | `backend/src/utils/logger.js:7` (`service: 'novrcampaign-backend'`) | logger name → CHANGE |
| 11 | `backend/prisma/schema.prisma:1,149` (comments) | comments → **DO NOT CHANGE** (schemadoc; out of rename scope) |
| 12 | `backend/.env.example:86` (`R2_BUCKET=novrcampaign-drive`) | env default → **DO NOT CHANGE** |
| 13 | `backend/prisma/seed.js:8` (`admin@novrcampaign.local` default) | seed default → **DO NOT CHANGE** |
| 14 | `docs/design-system.md:1,132` | design doc → **DO NOT CHANGE** |
| 15 | `docs/novrpulse/README.md:5` ("NovrCampaign app") | novrpulse doc → **DO NOT CHANGE** |

Notes:
- The `/drive` app's own title is **"Files"** (`frontend/drive/index.html:7`) — no
  product name, so nothing to rename there.
- Logo/favicon: `frontend/public/cybernovr-logo.png` + `cybernovr-logo-white.png`
  are **CyberNovr** brand assets (the parent company), *not* "NovrCampaign"
  assets. There is **no NovrPulse logo/favicon to swap**; keep the CyberNovr logo.
- Example `.env`/`DATABASE_URL` and deployed domains are untouched.

**Is `frontend/src/components/Layout.jsx` shared with the `/drive` bundle?**
No. `frontend/drive/` is a self-contained Vite app (`frontend/drive/src/*`,
`frontend/drive/index.html`, entry `drive-root`, built by
`frontend/vite.drive.config.js`). It imports **none** of `src/components/*`,
`src/hooks/*`, or `src/lib/*` (verified by grep: zero matches). Renaming
`Layout.jsx` cannot affect `/drive`.

**Where can the picker live in CampaignBuilder given RichEmailEditor's
`value`/`onChange` model?**
`RichEmailEditor` is a controlled component: `value` (HTML string) in,
`onChange(html)` out, and it owns the Tiptap instance internally (no exposed
imperative handle). The picker therefore **cannot** call `editor.commands.
insertContentAt(cursor)` directly from `CampaignBuilder`. Two options:
- **(A, chosen — smaller)** Insert into the HTML string in `CampaignBuilder`:
  appending the block to `form.body` and letting RichEmailEditor's existing
  `useEffect` sync it (or, if the editor is focused, the `isFocused` guard skips
  the sync). This needs no change to RichEmailEditor's public API.
- (B) Forward a ref/Tiptap instance out of RichEmailEditor so the picker inserts
  at the true cursor. Larger, touches the editor contract.

The spec asks for "at the cursor". Correctness of "the cursor" for option A:
the editor is a plain controlled `textarea`/Tiptap; when RichEmailEditor is not
the active focus, "the cursor" is undefined and appending is the only sensible
behaviour. To honour "at cursor" without the larger refactor, the picker will
insert **at the current Tiptap selection when the editor is focused**, falling
back to **end-of-body** otherwise. This is delivered by passing a small
`onInsertHtml` callback into RichEmailEditor (a 3-line addition) that uses the
internal `editor` when available — see Phase 3. **State in the plan: if nothing
is focused, the block is appended at the end of the body.**

**Does CampaignBuilder autosave?**
No. There is an explicit **Save draft / Save changes** submit button
(`onSave` → create/update), plus dirty tracking against `savedSnapshot`.
Send/Schedule/Test are blocked while `dirty` (`requireSaved()`). Consequence
for P3: after inserting a feed block the user must **Save**; the insert is only
persisted to Plunk when the body is saved.

**How is test-send triggered?**
The **Test send** ghost button (`CampaignBuilder.jsx:373`) opens the test modal;
`onTest` (`:196`) calls `useTestCampaign().mutateAsync({ id: effectiveId, email:
testRecipient })` → `POST /api/campaigns/:id/test` → `campaignController.
testCampaign` → `plunk.testCampaign`. It is gated by `requireSaved()` and uses
the logged-in user's email (`testRecipient = user?.email`).

---

## 1. Rename map (Task 1) — P1

**CHANGE**
1. `frontend/src/components/Layout.jsx:154` — project chip "NovrCampaign" → "NovrPulse".
2. `frontend/src/pages/Login.jsx:41` — `<h1>NovrCampaign</h1>` → `<h1>NovrPulse</h1>`.
3. `frontend/index.html:8` — title `NovrCampaign · CyberNovr` → `NovrPulse · CyberNovr`.
   Also add a `<meta name="description">` (currently absent) reading
   "NovrPulse — internal cybersecurity newsletter and campaign tool."
4. `frontend/src/pages/CampaignBuilder.jsx:32` — default signoff
   "The NovrCampaign team" → "The NovrPulse team".
5. `backend/src/utils/logger.js:7` — `service: 'novrcampaign-backend'` → `'novrpulse-backend'`.
6. `README.md:1` — title → `# NovrPulse — In-House Email Campaign Platform`.
7. `README.md:48` — tree label `novrcampaign/` → `novrpulse/` (cosmetic only; the
   actual folder path is NOT renamed — see DO NOT CHANGE).
8. **Nav:** add a `Feed` entry to `Layout.jsx` `NAV` (icon `Rss` from lucide) →
   `/feed`. Nav text is part of P1 even though the page arrives in P2 (P1 renders
   the empty state).

**DO NOT CHANGE** (explicitly out of scope)
- npm package names (`package.json`, `backend/`, `frontend/`, `package-lock.json`).
- The repo folder path on disk.
- git remote.
- `DATABASE_URL` / `DIRECT_URL` / db name.
- Deployed domains (`cybernovr.com`, vercel URLs, `/drive` subroutes).
- Plunk project config, Plunk sender/display names, email template display names.
- Import paths and the generated Prisma client.
- Anything under `docs/novrpulse/`, and all `Np*` code / `np_*` tables.
- `backend/prisma/schema.prisma` header/comments and `seed.js` default email.
- `backend/.env.example` `R2_BUCKET` default.
- `docs/design-system.md` (brand/design doc; out of rename scope).
- The CyberNovr logo/favicon assets (parent-brand; no NovrPulse logo exists).

**P1 is one revertable commit** (`chore: rename NovrCampaign → NovrPulse`).
The nav "Feed" entry + empty-state page ship in the same commit as the rename so
the Definition-of-Done for P1 ("sidebar shows Feed; /feed shows the empty state")
is met by a single commit.

**Decision (smaller option):** do NOT rename the workspace folder, npm names, or
git remote. **Follow-up:** rename the on-disk repo folder and npm `name` in a
separate, deliberate change (it churns `package-lock.json` and CI paths).

---

## 2. Storage (Task 2) — P2

**New model `FeedEntry` → table `feed_entry`.** A **separate** model from
`NpEvent`.

Three-line tradeoff:
- Reusing `NpEvent` would give free provenance/tagging, but the intel store is
  **under review** and manual staff entries must never mix with collector data —
  a merge now would corrupt both.
- A separate table is one extra migration and a little duplication, but keeps the
  review surface clean and the blast radius of a rename/redesign tiny.
- Migrating later is one-way (backfill `feed_entry` → `NpEvent`, then drop the
  join rows' meaning); it is trivial while row counts are small, painful once
  newsletters reference entry ids — so decide before volume grows.

Fields:
```
id           String   @id @default(uuid())
sourceType   String   // 'x' | 'news' | 'regulator' | 'other'
sourceName   String
url          String   @unique          // normalised
author       String?
publishedAt  DateTime                   // staff-editable; drives week bucket
title        String
summary      String                     // staff-written, required
status       String   @default("draft") // 'draft' | 'ready' | 'archived'
createdBy    String                     // User.id (no FK; keep additive + loose)
createdAt    DateTime @default(now())
updatedAt    DateTime @updatedAt

@@index([publishedAt(sort: Desc)])
@@index([status])
@@map("feed_entry")
```
No raw pasted-body field. No quote field. No image field. No tags/severity.

**Join table `CampaignFeedEntry` → table `campaign_feed_entry`:**
```
campaignId  String   // Plunk campaign id (string, not a local FK)
entryId     String
entry       FeedEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
insertedAt  DateTime @default(now())
insertedBy  String

@@id([campaignId, entryId])   // = unique(campaignId, entryId)
@@index([entryId])
@@map("campaign_feed_entry")
```
"Used in N campaigns" and "used" are **derived** by counting join rows — never a
stored status. Re-inserting upserts the join row (`upsert` on
`campaignId_entryId`).

Validation (Joi, in the controller):
- Duplicate normalised `url` on **create** → **409/400 with a clear message
  naming the existing entry** (its title). Chosen: **400** (`BadRequest`) via a
  pre-check `findUnique({ where: { url } })`, message
  `This URL is already captured as "<existing title>".`
- Empty `summary` on create → **400** (`Joi.string().trim().min(1).required()`).
- `sourceType` ∈ {x,news,regulator,other}; `status` ∈ {draft,ready,archived};
  `url` `isoDate`-free but `Joi.string().uri()`, `publishedAt` `isoDate()`.

Normalisation: lowercase scheme+host, strip trailing slash, drop common
tracking params (`utm_*`, `fbclid`, `igshid`) and fragment. Shared helper server
side only (`feedWeek`/`normaliseUrl`); the client sends the raw URL and the
server normalises before the uniqueness check.

**Migration:** additive, generated by diffing against the **baseline schema**
(existing models). Created as a hand-written UTF-8 (no BOM) `migration.sql` in a
new timestamped folder, mirroring `20261109200000_np_entities`. **NEVER**
`--from-schema-datasource` against the live DB (it would emit `DROP TABLE` for
`intel_items`, `intel_runs`, `subscribers`,
`ceap_scholarship_applications`). Because P2 is where the first entry is created,
the migration ships in **P2** (P1 has no schema change).

---

## 3. Week (Task 3) — shared helper

- Window: **Monday 00:00:00 – Sunday 23:59:59.999 Africa/Lagos**, keyed on
  `publishedAt`.
- One shared helper computes the window **and** the label so API filter and UI
  label cannot drift. **Backend** helper: `backend/src/services/feedWeek.js`
  (used by the API filter). **Frontend** helper: `frontend/src/lib/feedWeek.js`
  (used by the label + navigator). These are two small, **identical** copies
  (backend and frontend cannot share a module without a bundling change) —
  documented as an accepted duplication, with the **canonical definition stated
  here** and pinned by a backend test (`feedWeek.test.mjs`) plus a frontend unit
  assertion in the same test to prevent drift. *(Chosen: duplicate the ~15-line
  helper; **Follow-up:** hoist to a shared workspace package if a third consumer
  appears.)*
- Implementation uses **date-fns only** (`startOfWeek`/`endOfWeek` with
  `weekStartsOn: 1`, plus `addWeeks`). Nigeria is UTC+1 year-round (no DST), so
  the helper works on the date shifted by a fixed +1h offset; simplest correct
  approach: compute the Monday of `publishedAt` in **Africa/Lagos** using
  `Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos' })` for the date
  parts, then build the window. No new dependency.
- Label: date range, e.g. `10 – 16 Nov 2026` (en-GB day-month). Helper
  `weekLabel(mondayISO)` returns that string.
- Editing `publishedAt` moves an entry between weeks with **no data change** —
  the week is a computed filter, never stored.

---

## 4. Newsletter insertion (Task 4) — P3

- Inserting writes a **snapshot** of rendered HTML into the editor. The entry's
  later edits do NOT change already-inserted text (the HTML is copied in, not
  referenced).
- **If nothing is focused**, the block is **appended at the end of the body**.
  If the editor is focused, it is inserted at the current selection (see §0 for
  the RichEmailEditor contract).
- Re-inserting the same entry into the same campaign is **allowed** — the join
  row is upserted (`@@id([campaignId, entryId])`).
- "Used" is derived from join rows.
- The block contains the **summary** and a **source link line**
  `Source: {sourceName} — <link>`.

**Literal, email-safe HTML example** (table-based, inline styles, escaped text).
All interpolated text is HTML-escaped server-side before it reaches the client
(`&` `<` `>` `"` `'`); the URL is the normalised stored URL:

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 16px 0;">
  <tr>
    <td style="padding:12px 14px;border-left:3px solid #662F8E;background:#F6F1FB;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#0C0C13;">
      <p style="margin:0 0 8px 0;">NCC warns operators over SIM-swap fraud rise.</p>
      <p style="margin:0;font-size:12px;line-height:18px;color:#4E4E61;">
        Source: NCC — <a href="https://www.ncc.gov.ng/notices/sim-swap" style="color:#4451A2;text-decoration:underline;">https://www.ncc.gov.ng/notices/sim-swap</a>
      </p>
    </td>
  </tr>
</table>
```
(The example text above is escaped-safe as written; the same escaping rule applies
to `sourceName`, `summary`, and the display URL.)

The picker's Insert action is a **client-side** render into `form.body`; the
same renderer is used by a "Copy as HTML" follow-up (P4). Chosen: **no server
round-trip** to render — a pure frontend `renderFeedBlock(entry)` returning the
string above. Re-inserting into the campaign also POSTs to
`/api/campaigns/:id/feed-entries` to upsert the join row.

---

## 5. UI/UX spec — P2/P3

### `/feed` default view (P2)
- Default range: **current week**, entries **grouped by day, newest first**.
- **Week navigator**: `prev` / `This week` / `next` (primitives §5).
- **Status filter**: All / Draft / Ready (pill tabs). (`archived` is out of the
  default list → P4 archive view.)
- **Source-type pills**: All / X / News / Regulator / Other.
- **Search box**: matches title + summary (client-side filter over the fetched
  week, or server `?q=`; chosen: **server `?q=`** for consistency with the picker).
- **Row** (`FeedEntryRow`): source pill, relative time ("2h ago" via date-fns
  `formatDistanceToNow`), title, one-line summary (truncated), status badge,
  "used in N campaigns", actions **Edit / Archive / Delete**. Delete asks for
  confirmation (a small confirm `Modal`).
- **Week label** shows the shared-helper range, e.g. `10 – 16 Nov 2026`.

### Capture / edit modal (P2)
- `FeedEntryFormModal` built on **`ui/Modal.jsx`** with `Input` / `Label` /
  `Button` / `Badge`. Not a separate page.
- Fields: URL, sourceType (select), sourceName, author (optional), publishedAt
  (native `datetime-local`), title, summary (textarea, required), status.
- **Pasting a URL** pre-fills:
  - `sourceType`: host is `x.com`/`twitter.com` → `x`; a **known regulator
    host** (hard-coded hostname set: `*.gov.ng`, `ncc.gov.ng`, `cbn.gov.ng`,
    `nitda.gov.ng`, `ndpc.gov.ng`, `cert.gov.ng`) → `regulator`; otherwise
    `news`. **Derived from the hostname alone — no network fetch.**
  - `sourceName`: from the hostname (strip `www.`), title-cased; `x`/`twitter`
    → `X`.
- Empty summary → inline error + 400 surface from the API.

### Empty states
- Use the existing **`EmptyState`** primitive with action
  **"Add this week's first update"** (opens the capture modal).

### CampaignBuilder picker (P3)
- **Right-side collapsible panel inside CampaignBuilder** (not a modal over the
  editor, not a new page). A toggle button in the Email content card header
  ("Feed") shows/hides the panel.
- Same **week navigator** and **search** as `/feed`.
- Lists this week's entries with a summary preview and an **Insert** per entry.
- **No batch insert**: chosen the **smaller** single-insert action; batch insert
  is under **Follow-ups**.

### Components
- **Generic primitives → `frontend/src/components/ui/index.jsx`:**
  - `WeekNavigator` ({ label, onPrev, onNext, onToday }).
  - `SourcePill` (sourceType → small colored pill, using existing `badge`
    classes; no new tokens).
  - `StatusBadge` **only if** `Badge` cannot express draft/ready/archived.
    **Decision:** add three `STATUS_STYLES` keys (`DRAFT` already exists;
    add `READY`, `ARCHIVED`) to the existing `Badge` map rather than a new
    component — **no new `StatusBadge`**.
- **Feed-specific → `frontend/src/components/feed/`:**
  - `FeedEntryRow.jsx`, `FeedEntryFormModal.jsx`, `FeedPickerPanel.jsx`.
  - (The prompt's `components/posts/` has no existing directory; we go straight
    to `components/feed/`. No `posts/` rename is performed — nothing exists to
    rename.)
- **Follow-ups (not done):** extract `WeekNavigator` usage into Templates/pages,
  extract a generic `ConfirmDialog` used by Contacts/delete flows.
- **Not in scope:** CommandPalette entry, public publishing, uploads,
  auto-scraping/fetching, LLM drafting, tagging, scheduling, multi-tenant, STIX,
  pgvector.

---

## 6. Phases of use

Each phase: migration if any → controller (Joi) → route in `routes/index.js`
behind `requireAuth` → TanStack Query hooks → UI → lint + build + tests → demo.

### P1 — "The app is called NovrPulse" (one commit)
- **No migration.** Rename map §1 + nav "Feed" entry + `/feed` page that renders
  the `EmptyState` only.
- Files: `Layout.jsx` (nav + chip), `Login.jsx`, `frontend/index.html`,
  `CampaignBuilder.jsx` (signoff), `backend/src/utils/logger.js`, `README.md`,
  new `frontend/src/pages/Feed.jsx`, `App.jsx` route, `NavItem` icon.
- Demo: log in → sidebar reads **NovrPulse**, shows **Feed**; open `/feed` → empty
  state; browser tab title reads `NovrPulse · CyberNovr`; `/drive` still loads.
- DoD: `grep -ri "novrcampaign"` returns only DO-NOT-CHANGE hits; lint + build
  pass at root; one commit.

### P2 — "Capture"
- **Migration:** `feed_entry` + `campaign_feed_entry` (additive, §2).
- **Controller:** `backend/src/controllers/feedController.js` with Joi schemas;
  routes `backend/src/routes/feedRoutes.js`; registered in `routes/index.js`
  behind `requireAuth`:
  - `GET /api/feed` (query: `weekStart`, `status`, `sourceType`, `q`).
  - `POST /api/feed` (create; duplicate-url & empty-summary guards).
  - `PUT /api/feed/:id` (edit title/summary/status/publishedAt/sourceType/
    sourceName/author/url — re-checks url uniqueness excluding self).
  - `DELETE /api/feed/:id`.
  - `GET /api/feed/week` (optional: returns `{ weekStart, label }` from the
    shared helper — chosen: **yes**, so the UI label is server-sourced and
    cannot drift). *(Smaller: compute label client-side from the same duplicated
    helper. Chosen the server endpoint to make drift impossible.)*
- **Hooks:** `useFeedEntries(params)`, `useFeedWeek(weekStart)` in `queries.js`;
  `useCreateFeedEntry`, `useUpdateFeedEntry`, `useDeleteFeedEntry` in
  `mutations.js` (invalidate `['feed']`).
- **UI:** `Feed.jsx` (grouped list, navigator, filters, search), `FeedEntryRow`,
  `FeedEntryFormModal`, `WeekNavigator` + `SourcePill` primitives, new
  `STATUS_STYLES` keys.
- Demo: add an entry with an `x.com` URL dated this week → appears under the
  correct day, week label matches the helper; edit summary; archive; delete +
  reload; re-add same URL → rejected naming the existing entry; empty summary →
  400; change `publishedAt` to last week → moves out of This week; a VIEWER
  account can create.

### P3 — "Draft"
- **No new migration** (join table ships in P2, unused until now). Controller:
  `POST /api/campaigns/:id/feed-entries` (upsert join row; returns
  `{ used: N }`) and `GET /api/campaigns/:id/feed-entries` (list used entries)
  added to `campaignRoutes.js` → `campaignController.js` (or a small
  `feedController` export). Both behind `requireAuth`.
- **RichEmailEditor:** minimal `onInsertHtml(fn)` wiring (accept an optional
  imperative insert callback) — 3-line addition; fallback append handled in
  `CampaignBuilder`.
- **Hooks:** `useInsertFeedEntry`, `useCampaignFeedEntries`.
- **UI:** `FeedPickerPanel` in CampaignBuilder's Email content card; Insert
  renders `renderFeedBlock(entry)` into `form.body` (cursor-or-append) and POSTs
  the join row.
- Demo: from CampaignBuilder open the Feed panel → same week listed → Insert →
  block at cursor (or appended) with summary + `Source:` line → **Save** →
  **Test send** delivers it rendered → reload draft keeps the block → entry shows
  as used → re-insert does not error.

### P4 — only if justified
Candidates and the cut decision:
- **Archive view** (`/feed?status=archived` or a tab) — **KEEP** if P2 already
  stores `archived`; small (one filter value + one route param). Lowest cost.
- **"Used in N campaigns" on the list page** — **KEEP**: the count is a trivial
  aggregate on the join table already fetched for P3; high demo value.
- **"Copy as HTML"** — **CUT.** It duplicates the insert renderer into the
  clipboard with no persistence, and the same string is already visible via
  Insert + HTML tab. It is the least load-bearing of the three. **(Named cut.)**

Per phase the same gate applies: `npx prisma validate`, `npm run lint`,
`npm run build`, touched backend tests (`node --test`) pass, with explicit
browser demo steps.

---

## 7. Simpler alternatives & future improvements (not implemented)

Easiest first:
1. **URL prefill of title via the existing RSS/feed parser** —
   `backend/src/services/novrpulse/feedParser.js` already parses feeds. Given a
   news URL that is also a feed item, prefill `title`/`author`. **No scraping of
   X.** Easiest, no new deps.
2. **LLM-drafted summary for a human to edit** — reuse the existing
   understanding layer (`backend/src/services/novrpulse/llm` + `understand`).
   The draft is always edited by a person before save. Small, reuses what exists.
3. **RSS capture from the existing 40-source register** —
   `docs/novrpulse/00-source-register.md` + `sources.js` give a curated list;
   pull candidate headlines into `draft` entries for triage.
4. **Tagging entries with the eight NovrPulse functions** — add a `functions
   Int[]` mirroring `NpEvent`, once the intel store review settles.
5. **Scheduling entries into future weeks** — a staff-set `publishWeek` distinct
   from `publishedAt`.
6. **"Copy a whole week into a campaign"** — batch insert of every `ready`
   entry; pairs with a P4 batch action.

**Auto-posting from X/Twitter is not recommended** — paid/limited API access and
reuse restrictions. **Verify pricing and reuse terms before scheduling any such
work.**

**The one thing I would cut** (if forced to drop one item from this whole plan):
the P4 **"Copy as HTML"** action. It is the only item whose value is fully
covered by an already-shipped path (Insert + the HTML tab), so removing it loses
no capability.

---

## 8. Conventions & guardrails (restated)

- **Auth:** every logged-in user (ADMIN/SENDER/VIEWER) may read and write feed
  entries. **No new role rules.** `requireAuth` stays on the route.
- **Prisma migrations:** additive only; diffed against the baseline schema;
  **never** `--from-schema-datasource` against the live DB (that emits `DROP
  TABLE` for `intel_items`, `intel_runs`, `subscribers`,
  `ceap_scholarship_applications`). Files UTF-8, **no BOM**.
- **No new runtime dependencies** (date-fns, lucide-react, TanStack Query, Joi,
  Tiptap are installed).
- **Reuse `ui/index.jsx` primitives**; do not duplicate Card/Button/Input/Badge/
  Modal. Do not restyle existing pages beyond the rename.
- **Do not break:** Plunk integration, Drive (`frontend/drive`, `Drive*`
  tables), `np_*` collectors + understanding layer, campaign send + test-send.
- **Smaller option when in doubt. No speculative fields or "for later" code.**

---

## 9. Approval gate

This is the single STOP. On approval: **P1 first, as one revertable commit**,
then P2 → P3 (→ P4 only if justified), each phase demo-able and gated on
`npx prisma validate` + `npm run lint` + `npm run build` + touched backend tests.
