# NovrPulse — Source Register

Phase 0 artefact · v2.0 · 2026-11-17

The register is the **authoritative allowlist**. Nothing is collected unless it
has a row here, and every row has a named `approved_by` and a recorded licence
status. Version-control this file; changes go through the source policy
(`01-policies.md`).

**v2.0** adopts the operator's `NovrPulse_Sources.xlsx` (30 sources) as the
spine, adds the 12 sources already integrated, and records the endpoint
verification from `08-source-register-review.md`. The old 40-row flat list is
superseded.

## How to read this register

Columns:

- `has_rss` — `yes` / `no` / `blocked` (feed may exist but a WAF rejected the probe).
- `status` — `verified` (endpoint confirmed live) · `unverified` (not tested) ·
  `dead` (feed exists but stopped publishing) · `no-feed` (none found) ·
  `blocked` (WAF/TLS/timeout).
- `enabled` — whether the collector runs today.
- `licence` — `unknown` until checked. **Never treat `unknown` as permission.**
- `paywall` — whether content sits behind a paywall.
- `tier` — 1 identity (regulators) · 2 local spine (NG/AF tech) · 3 press ·
  4 global filler.

Collection is **RSS/API-only** while licences are `unknown`; HTML scraping of an
unknown-licence source is forbidden (policy §1).

> **Rule:** a feed existing is not a feed working. Every "verified" site below was
> re-tested on 2026-11-17; several of the sheet's "Estimated RSS feeds" turned out
> dead or missing (see `08-source-register-review.md`).

---

## Tier 1 — Nigerian regulators & CERTs (the identity / unique value)

| # | Source | Functions | Type | has_rss | status | enabled | licence | paywall | Notes |
|---|--------|-----------|------|---------|--------|---------|---------|---------|-------|
| 1 | CBN | 1, 7 | pdf | no | no-feed | no | unknown | no | Notices are PDFs — needs a PDF collector |
| 2 | NCC | 1, 7 | rss | yes | verified | **yes** | unknown | no | `/rss.xml` works but often stale; freshness gate handles it |
| 3 | NITDA | 1, 3, 7 | rss | yes | verified | **yes** | unknown | no | `/feed/` fresh |
| 4 | NDPC | 1, 7 | rss | yes | verified | **yes** | unknown | no | `/feed` works; can be stale |
| 5 | ngCERT | 7, 8 | html | blocked | blocked | no | unknown | no | 403 WAF; re-probe from prod IP |
| 6 | EFCC | 7 | html | no | no-feed | no | unknown | no | No feed. Arrest items — defamation policy |
| 7 | NPF-NCCC | 7 | html | blocked | blocked | no | unknown | no | 429; arrest items — defamation policy |
| 8 | Cybersafe Foundation | 3, 6 | html | no | unverified | no | unknown | no | NGO; confirm URL/feed |
| — | CSA Ghana | 1, 7 | html | no | no-feed | no | unknown | no | Home OK, no feed; West Africa |
| — | KE-CIRT/CC | 1, 7 | rss | yes | **dead** | no | unknown | no | Feed froze 2021-03 — do not enable |
| — | Africa CERT | 5, 8 | rss | yes | **dead** | no | unknown | no | Feed ~11 months stale — do not enable |
| — | DefenseCERT | 3 | — | — | unverified | no | unknown | — | Public site unconfirmed; do not use for F3 |

## Tier 2 — Nigerian / African tech (the local spine)

| # | Source | Functions | Type | has_rss | status | enabled | licence | paywall | Notes |
|---|--------|-----------|------|---------|--------|---------|---------|---------|-------|
| 9 | Techpoint Africa | 4, 7, 8 | api | yes | verified | **yes** | unknown | no | WP REST, no key; fresh daily |
| 10 | TechCabal | 4, 7, 8 | rss | yes | verified | **yes** | unknown | no | Fresh daily |
| 11 | Techeconomy | 7, 8 | rss | yes | verified | **yes** | unknown | no | `/feed.xml` (not `/feed`); fresh |
| 12 | Tech Digest NG | 7, 8 | rss | yes | verified | **yes** | unknown | no | Fresh; re-reports advisories |
| 13 | ITEdgeNews Africa | 4, 7, 8 | api | yes | verified | **yes** | unknown | no | WP REST (no XML feed); fresh |
| 14 | Nairametrics | 1, 7 | rss | yes | verified | **yes** | unknown | no | Fresh; mostly business |
| 15 | BusinessDay (Tech) | 1, 4, 7, 8 | rss | yes | verified | **yes** | unknown | no | Technology category feed |
| 16 | Vanguard (Tech) | 3, 7 | rss | yes | verified | **yes** | unknown | no | Technology category feed |
| 17 | ITWeb Africa | 4, 7, 8 | rss | yes | verified | **yes** | unknown | no | `/rss` fresh |
| 18 | TechAfrica News | 4, 8 | rss | yes | verified | **yes** | unknown | no | Fresh |
| 19 | Osiris.sn (Senegal, FR) | 7, 8 | rss | yes | unverified | no | unknown | no | Feed path exists, 0 items; verify |
| 20 | IT News Africa | 4, 7 | html | no | unverified | no | unknown | no | No feed found; WP REST returned HTML |
| 21 | Tech In Africa | 7, 8 | rss | yes | **dead** | no | unknown | no | ~10 months stale — do not enable |
| 22 | TechCentral (ZA) | 4, 7, 8 | rss | yes | verified | no | unknown | no | Enable on wider Africa expansion |

## Tier 3 — Nigerian general press (supplement, keyword-filtered)

| # | Source | Functions | Type | has_rss | status | enabled | licence | paywall | Notes |
|---|--------|-----------|------|---------|--------|---------|---------|---------|-------|
| 23 | Punch | 3, 7 | rss | yes | verified | no | unknown | no | Fresh but ~5% cyber |
| 24 | ThisDay | 3, 7 | rss | yes | verified | no | unknown | no | Fresh, low signal |
| 25 | Daily Trust | 3, 7 | rss | yes | verified | no | unknown | no | Fresh, low signal |
| 26 | Sahara Reporters | 3, 7 | rss | yes | verified | no | unknown | no | Legal sensitivity |
| 27 | Legit.ng | 3, 6 | rss | yes | verified | no | unknown | no | Noisy; curate hard |
| 28 | Premium Times | 3, 7 | rss | yes | verified | no | unknown | **yes** | Feed returned 0 items; partly paywalled |
| 29 | The Guardian Nigeria | 3, 7 | html | blocked | blocked | no | unknown | no | WAF; re-probe from prod |
| 30 | The Cable | 3, 7 | html | blocked | blocked | no | unknown | no | WAF; re-probe |
| 31 | Channels TV | 3, 7 | html | blocked | blocked | no | unknown | no | WAF; re-probe |
| 32 | Peoples Gazette | 3, 7 | html | blocked | blocked | no | unknown | no | JS anti-bot; legal sensitivity |
| — | MyJoyOnline (Ghana) | 3, 4 | rss | yes | verified | no | unknown | no | Enable on West Africa expansion |

## Tier 4 — Global security (daily-volume filler, filter for NG/AF relevance)

| # | Source | Functions | Type | has_rss | status | enabled | licence | paywall | Notes |
|---|--------|-----------|------|---------|--------|---------|---------|---------|-------|
| 33 | BleepingComputer | 7, 8 | rss | yes | verified | **yes** | unknown | no | High volume, fresh hourly |
| 34 | The Hacker News | 7, 8 | rss | yes | verified | **yes** | unknown | no | High volume, fresh |
| 35 | The Record | 7, 8 | rss | yes | verified | **yes** | unknown | no | Incident/gov; fresh |
| 36 | SecurityWeek | 7, 8 | rss | yes | verified | **yes** | unknown | no | Fresh |
| 37 | Dark Reading | 7, 8 | rss | yes | verified | **yes** | unknown | no | Fresh |
| 38 | CyberScoop | 7, 8 | rss | yes | verified | **yes** | unknown | no | Fresh |
| 39 | CISA KEV catalog | 7, 8 | json | yes | verified | no | unknown | no | Public JSON feed; needs a JSON-schema parser |
| 40 | NIST NVD | 7, 8 | json | yes | verified | no | unknown | no | Free key raises limit 5→50 req/30s; needs a parser |

> Tier 4 is the **filler**, not the identity. Global items are filtered for
> Nigeria/Africa relevance before publication (framing decision, `§6.5`).

---

## Register gaps still open

| Gap | Status | Owner |
|-----|--------|-------|
| `licence` populated (all rows still `unknown`) | **open — policy §1 blocker for HTML sources** | operator |
| `blocked` rows re-probed from a production IP | open (7 rows) | task |
| CBN PDF collector | not built (highest-value gap) | task |
| CISA KEV / NVD JSON parsers | not built | task |
| CybAfrique (beehiiv) access route | open — beehiiv needs the newsletter API, not RSS | task |

## Registry stats (2026-11-17)

- **42 sources**: 27 `verified`, 6 `blocked`, 3 `dead`, 3 `unverified`, 3 `no-feed`.
- **19 enabled** and collecting: 3 regulators (NCC/NITDA/NDPC), 8 Nigerian/African
  tech, 6 global security, 2 pan-African.
- **Live collection: 301 fresh items across 19 sources** (was 1 before Tier B,
  61 before Tier 4). The global filler tier is what makes "daily" honest.
