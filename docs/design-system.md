# NovrCampaign Design System — “Cyber Premium”

Brand base sampled from the CyberNovr logo (`frontend/public/cybernovr-logo.png`):
**Blue `#4451A2` · Purple `#662F8E` · Red `#EB2027` · Ink `#0C0C13`**

Role assignment (per brief): **Purple = primary**, Blue = secondary/trust,
Red = accent/alert (sparingly). Aesthetic: Linear / Vercel / Raycast —
professional, sharp, premium. Internal tool: no billing UI required.

---

## 1. Design tokens

### 1.1 Color scales (HEX)

| Step | Purple (primary) | Blue (secondary) | Red (accent) | Neutral (violet-tinted gray) |
|------|------------------|------------------|--------------|------------------------------|
| 50   | `#F6F1FB` | `#EEF0F9` | `#FDECEC` | `#F7F7F9` |
| 100  | `#EBDFF4` | `#DCE0F2` | `#FAD6D7` | `#F0F0F4` |
| 200  | `#D8BFE9` | `#B9C2E4` | `#F4A9AC` | `#E2E2E9` |
| 300  | `#BC94D8` | `#8E9AD3` | `#EC7376` | `#C9C9D4` |
| 400  | `#9A67BE` | `#646FBF` | `#F04444` | `#A8A8B8` |
| 500  | `#7E43A6` | `#4E59B0` | `#EB2027` | `#84849A` |
| 600  | `#662F8E` | `#4451A2` | `#C8161D` | `#63637A` |
| 700  | `#552778` | `#38437F` | `#A51218` | `#4E4E61` |
| 800  | `#452062` | `#2E3766` | `#871014` | `#33333F` |
| 900  | `#38204F` | `#272D54` | `#6E1115` | `#1E1E26` |
| 950  | `#231130` | `#151838` | `#420609` | `#121218` |

Base samples sit at Purple-600, Blue-600, Red-500.

### 1.2 Semantic mapping

| Token | Light | Dark | Usage |
|---|---|---|---|
| `success` | `#16A34A` on `#E9F9EF` | `#4ADE80` on `rgba(74,222,128,.12)` | Delivered, subscribed, valid |
| `warning` | `#B45309` on `#FEF3E2` | `#FBBF24` on `rgba(251,191,36,.12)` | Scheduled, MX-risky, MX skipped |
| `error` / `danger` | `#C8161D` text on `#FDECEC` | `#F87171` on `rgba(248,113,113,.12)` | Bounced, complained, destructive |
| `info` | `#4451A2` on `#EEF0F9` | `#93A0E8` on `rgba(147,160,232,.14)` | Connected, queued, sending |
| `primary` CTA | `#662F8E` bg, white text | `#9A67BE` bg, `#231130` text | Main actions only |

Red rule: **never** large backgrounds, never success-adjacent. Dots, badges,
destructive buttons, urgency counts only.

### 1.3 Gradients

| Name | Stops | Use |
|---|---|---|
| `brand-bar` | `#4451A2 → #662F8E → #EB2027` (90deg) | 4px brand hairline under logo, login divider, wizard progress fill |
| `primary-glow` | `#662F8E → #4451A2` (135deg) | Hero panels, empty-state illustration washes |
| `chart-area` | `#662F8E` 32% → transparent | Area charts |
| `chart-area-2` | `#4451A2` 28% → transparent | Secondary area series |

### 1.4 Text contrast (WCAG AA, normal text ≥ 4.5:1)

| Pair | Ratio | Pass |
|---|---|---|
| White on Purple-600 `#662F8E` | ≈ 7.6:1 | AAA |
| White on Purple-700 | ≈ 9.3:1 | AAA |
| White on Blue-600 `#4451A2` | ≈ 7.0:1 | AAA |
| White on Red-500 `#EB2027` | ≈ 4.2:1 | AA large/UI only — body text must use Red-600 `#C8161D` (≈ 6.0:1) |
| Neutral-700 on white | ≈ 7.5:1 | AAA (body text) |
| Neutral-500 on white | ≈ 3.9:1 | Captions/meta only (≥ 12px de-emphasized) |

### 1.5 Dark mode palette

| Token | Value |
|---|---|
| `bg` | `#0C0C13` (brand ink) |
| `surface` / `surface-2` | `#15151E` / `#1C1C27` |
| `border` | `rgba(255,255,255,.10)` |
| `text` / `text-dim` | `#F4F4F6` / `rgba(244,244,246,.60)` |
| `primary` | Purple-400 `#9A67BE` (bg), `#231130` text on it |
| `accent-glow` | radial Blue-600 30% / Purple-600 26% / Red-500 10% (cf. Login page) |

Dark surfaces never use Red fills; destructive stays outline/ghost in dark.

### 1.6 Typography

- **Family:** Inter, system fallback (body + headings). Mono: `ui-monospace, SFMono-Regular, Menlo`.
- Load via `@fontsource-variable/inter` (Vite-friendly, no Google Fonts dependency).

| Token | Size / Weight / Leading / Tracking |
|---|---|
| `h1` page title | 24px / 700 / 32px / -0.02em |
| `h2` section | 18px / 600 / 28px / -0.01em |
| `h3` card title | 16px / 600 / 24px / -0.01em |
| `body` | 14px / 400 / 22px / 0 |
| `body-sm` | 13px / 400 / 20px / 0 |
| `caption` | 12px / 400–500 / 16px / 0 |
| `overline` | 11px / 600 / 16px / +0.08em uppercase (table headers, eyebrows) |

Headings always `tracking-tight`; numbers tabular (`tabular-nums`).

### 1.7 Spacing, grid, containers

- Base 4px. Scale: `1=4, 2=8, 3=12, 4=16, 6=24, 8=32, 12=48, 16=64`.
- Page: `max-w-[1400px]`, `p-6` (mobile) → `p-8` (desktop), vertical rhythm 32px sections.
- Content grid 12-col, gutter 24px; cards `gap-4/6`.
- Breakpoints: `sm 640 · md 768 · lg 1024 · xl 1440`.
- Sidebar: **240px expanded / 64px collapsed** (icon rail), collapsible at `lg`, hidden + hamburger below `lg`, bottom-nav optional on mobile (internal tool: hamburger suffices).

### 1.8 Elevation, radius, z-index

- Shadows: `sm 0 1px 2px rgba(18,18,24,.06)` · `md 0 4px 12px -2px rgba(18,18,24,.10)` ·
  `lg 0 12px 32px -8px rgba(18,18,24,.18)` · `xl 0 24px 64px -12px rgba(18,18,24,.28)`.
- Radius: `sm 6 · md 8 · lg 12 · full 9999`. Buttons `md`, inputs `md`, cards `lg`.
- Z: `dropdown 40 · sticky-header 30 · modal 50 · toast 60 · tooltip 70`.

### 1.9 Iconography

- **Lucide** (already in use — keep). Sizes: `14` inline · `16` default UI · `20` empty states · `24+` feature art.
- Colors: `text-muted-foreground` default; active nav white; destructive contexts Red-600; info contexts Blue-600. Never multicolor icons.

---

## 2. App shell

```
┌──────────┬──────────────────────────────────────────────┐
│ SIDEBAR  │  TOPBAR: breadcrumb · search · bell · avatar │
│ 240px    ├──────────────────────────────────────────────┤
│ dark ink │  PAGE HEADER: title + desc + [actions]       │
│          │  ┌────────────────────────────────────────┐  │
│          │  │ content (max-w-1400, p-8)              │  │
│ user     │  └────────────────────────────────────────┘  │
└──────────┴──────────────────────────────────────────────┘
```

### 2.1 Sidebar (dark `#0C0C13`, white text)

- Top: white logo (`/cybernovr-logo-white.png`, h-8) → `NovrCampaign` + `INTERNAL` pill → 4px `brand-bar` gradient hairline.
- Groups: **Build** (Dashboard, Campaigns, Templates, Segments), **Audience** (Contacts), **Insights** (Reports), **System** (Settings — future). Collapsed Admin items hidden until built (no dead links).
- Item: `px-3 py-2 rounded-md text-sm`; active `bg-Purple-600 text-white`; hover `bg-white/10`; icons 16px.
- Red dot badges: failed sends count on Campaigns, bounce-spike flag on Reports. Counts in `bg-Red-500` pill, max 3 chars (`99+`).
- Bottom: provider status card (`bg-white/5`, Plunk Connected badge) + user row (email, role) + logout icon button.
- Collapse toggle at sidebar foot; state in `localStorage`.

### 2.2 Topbar (light, `border-b`, sticky)

- Left: breadcrumb (`Workspace / Section / Page`, last item semibold).
- Center-left: global search `⌘K` (searches campaigns, contacts, templates, segments; keyboard navigable).
- Right: bell with Red-500 count badge → dropdown (send failures, bounce spikes, Plunk key issues); avatar dropdown (profile email read-only, theme toggle, logout). No billing links (internal).

### 2.3 Content patterns

- Page header: `h1` + 1-line muted description + right-aligned actions (primary + secondary max).
- Sub-pages use pill tabs under the header (Analytics uses: Overview · Recipients · Links).
- Tables: sticky header, `overline` 11px headers, row hover, right-aligned numerics, pagination footer.

---

## 3. Page specs

### A. Dashboard (exists — reskin)

- KPI row (4 stat cards, `lg:grid-cols-4`): Emails sent · Open rate · Click rate · Contacts. Card: label caption, 28px semibold tabular value, delta chip (green up / Red-600 down), 16px icon top-right in Purple-100 tile.
- Performance area chart (Purple-600 line, `chart-area` fill; Blue-600 second series for previous period, dashed). Tooltip: dark card, white text.
- Two-column: Recent campaigns table (name, status badge, sent, open%) + right rail Quick actions (New campaign, Add contacts, New segment) and Automation status (future: placeholder card “No workflows yet”).
- Skeletons: shimmer stat cards + chart block. Empty: “No campaigns yet” with primary CTA.

### B. Contacts (exists — reskin + keep flows)

- Header actions: Add contact (secondary) · Paste a list (secondary) · Import CSV (primary-purple).
- Table: checkbox, email (semibold) + name sub, status badge, added date; bulk bar appears on selection (Unsubscribe / Delete-danger / Add-to-segment).
- Detail (exists via `PATCH /:id` — surface it): drawer from row click — profile card, subscribed toggle, `data.*` fields, segment memberships, activity timeline (future: needs `/v1/track` + events API).
- Segmentation builder = `ConditionBuilder` (exists) — keep purple active states.
- Import wizard (exists as modal): keep 3-state (drop → report → done); style report tiles per semantic map.

### C. Campaign builder (exists — reskin, keep Tiptap)

- Convert to 4-step wizard shell reusing current sections: **1 Details** (name, subject, type, audience+segment picker) → **2 Design** (`RichEmailEditor`: Write/HTML/Preview tabs, template gallery start) → **3 Review & test** (checklist: unsubscribe present, segment count, test send) → **4 Schedule** (Send now / Later datetime / Best-time + Batches — disabled with “needs tracking” tooltips).
- Editor toolbar: ghost icon buttons, active Purple-100; token insert buttons (`{{firstName}}`, unsubscribe) as outlined chips.
- No drag-and-drop builder (out of scope — Tiptap + HTML is the builder).

### D. Automations (future)

- Canvas: dark-dot grid, node cards (trigger=Purple left edge, action=Blue, condition=amber, exit=gray), bezier connectors, minimap, settings drawer right. Status pill Active-green / Paused-gray. Backend prerequisite: `/workflows` proxy.

### E. Templates (exists — reskin)

- Grid cards (3-col): rendered thumbnail (scaled `srcDoc` iframe, pointer-events-none), name, type badge, hover overlay (Use / Duplicate / Delete). Keep create modal with `RichEmailEditor`.

### F. Transactional (future)

- Table of `TRANSACTIONAL` templates + “Logs” tab (needs `/v1/send` wrapper) + API snippet panel (copyable `curl` with masked key).

### G–I. SMS / Landing / Forms

- Not planned (no provider). Spec reserved: SMS composer = textarea + 160-char segments counter + phone mockup; Forms = field list + embed-code panel. Build only if a provider is chosen.

### J. Reports (extend CampaignAnalytics)

- Globalcompare: campaign multi-select → overlaid open/click lines; link-level table (URL, clicks, unique); device/client donut (Purple/Blue/amber/slate); geo map (future); export CSV button; global date-range picker driving all charts.

### K–L. Integrations / Settings (future)

- Integrations: grid of provider cards (Plunk connected-green; others gray “Not configured”). Settings: sender identity (read-only `info@cybernovr.com` + domain verify status), team (seeded users table, no invites), theme toggle, danger zone (none — internal).

---

## 4. Component library

| Component | Variants / states | Rules |
|---|---|---|
| Button | `primary` Purple-600→700 hover · `secondary` white/border · `danger` Red-500/600 · `ghost` · `outline`; sizes `sm/md` | One primary per view; danger needs confirm |
| Input/Select/Textarea | default, error (Red-500 ring + message), disabled; `h-10`, radius-md | Labels 14px medium above; hints 12px muted below |
| Checkbox/Radio/Switch | Purple-600 checked; focus ring Purple-600/30 | 16px boxes, 14px labels |
| Modal | `sm 420 · md 560 · lg 720` | Overlay `rgba(12,12,19,.55)` + blur 2px; enter: fade+scale 150ms; Esc/backdrop close; danger modals Red-600 confirm |
| Drawer | right 420px (contact detail, settings) | Same overlay; slide 200ms |
| Table | sortable headers (arrow), selectable rows, pagination | Numerics right + tabular; status via Badge |
| Card | `stat` · `content` (header+body) · `action` (hover ring) | `bg-card border radius-lg shadow-sm` |
| Tabs | underline (page) · pill (filters) | Active: Purple-600 text + 2px indicator |
| Dropdown/Tooltip/Popover | dark tooltip (`#1E1E26`, white 12px) | 4px offset, 150ms fade |
| Toast | success/error/warning/info, bottom-right stack | Auto-dismiss 5s, action slot, slide-in 200ms |
| Progress/Steps | `brand-bar` fill; wizard steps numbered circles | Current Purple-600, done green check |
| Badge/Tag | status map (§1.2); counts Red-500 pill | Max 3 chars + `99+` |
| Avatar | initials, Purple-100 bg Purple-700 text | Stacked `-space-x-2` |
| Empty state | 40px muted icon wash, title, 1-line desc, primary CTA | One per view, never bare tables |
| Skeleton | shimmer `linear-gradient(90deg, transparent, white/60, transparent)` | Match layout blocks |
| Date/time pick | native `datetime-local` styled `.input` | Always store ISO; display local |
| Upload zone | dashed border-2, drag: Purple-200 bg Purple-50 | 5MB note inline |
| Rich editor | toolbar ghost buttons, Purple-100 active | Token chips outlined (§C) |

Focus states (global): `:focus-visible { outline: 2px solid #662F8E; outline-offset: 2px }`
(dark: `#9A67BE`).

---

## 5. Chart theme (Recharts)

- Palette order: Purple-600 `#662F8E` · Blue-500 `#4451A2` · amber `#D97706` · slate `#84849A` · Red-500 `#EB2027` (loss/bounce only).
- Line: `strokeWidth 2.5`, dotless, `animationDuration 600`. Area: gradient fills §1.3.
- Donut: `innerRadius 62%`, segment stroke = card bg 2px, center total label.
- Heatmap (future): Blue-100 → Blue-600 → Purple-700 scale.
- Tooltip: `contentStyle { background:#1E1E26, border:none, radius:8, color:#fff, fontSize:12 }`.
- Grid: `stroke #E2E2E9` (dark: `rgba(255,255,255,.08)`), axis tick 11px Neutral-500, no Y axis line.
- Legend: 12px dots 8px, bottom.

## 6. Responsive

| Breakpoint | Sidebar | Content | Adaptations |
|---|---|---|---|
| ≥1440 | 240 expanded, collapsible | 1400 max, 4-col KPIs | Full tables |
| 1024–1439 | Collapsible (persist) | 3-col KPIs | Editor toolbar wraps |
| 768–1023 | Hidden, hamburger overlay | 2-col KPIs | Tables → horizontal scroll; wizard steps compact |
| <768 | Hidden | 1-col stacked | Header actions collapse into menu; charts height 220; modals fullscreen |

## 7. Motion

- Tokens: `fast 120ms · base 180ms · slow 260ms`, `ease-out` standard; sidebar width 200ms.
- Page: content fade+rise 8px on route change (respect `prefers-reduced-motion`).
- Modals/toasts/drawers per §4. Charts animate on mount only. Buttons: `active:scale-[.98]`. Drag zones: border pulse on dragover.

## 8. Vite implementation guide

- **Approach:** Tailwind v4 (CSS-first, `@tailwindcss/vite` plugin) + `@theme` tokens; `components/ui/*` primitives; class-based dark via `@custom-variant dark` with toggle in avatar menu → `document.documentElement.classList`.
- **Token organization:** `@theme` color/font/animate tokens in `index.css` (`--color-brand-*`, `--color-primary`, …); `.dark` overrides the same vars so dark mode flips values without class churn. No `tailwind.config.js`, no `postcss.config.js`.

```css
/* index.css */
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
@theme {
  --color-primary: #662f8e; /* ← purple takes over from blue */
  --color-brand-blue: #4451a2;
  --color-brand-purple: #662f8e;
  --color-brand-red: #eb2027;
  --color-brand-ink: #0c0c13;
  --font-display: "Space Grotesk Variable", "Space Grotesk", Inter, system-ui, sans-serif;
}
.dark { --color-primary: #9a67be; color-scheme: dark; /* + surface overrides */ }
:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }
```

- **Folder structure:** `components/ui/` (primitives) · `components/charts/` (themed Recharts wrappers: `AreaChartCard`, `DonutCard`, `ChartTooltip`) · `components/layout/` (Sidebar, Topbar, PageHeader) · `pages/` unchanged names.
- **Rollout order (no functionality change):** ① tokens+config (primary blue→purple) ② shell (sidebar/topbar) ③ primitives ④ pages A→C→E→B→J ⑤ dark toggle ⑥ motion pass.
- **Note:** switching `primary` to purple recolors all CTAs app-wide — verify `CampaignBuilder` schedule/send and `Login` against §1.4 contrast (white on Purple-600 = AAA ✓).
