# NovrPulse — Spreadsheet Register Review (`NovrPulse_Sources.xlsx`)

Review · 2026-11-17 · by Kilo

The operator supplied `NovrPulse_Sources.xlsx` (30 sources, four tiers:
Nigeria 1–13, West Africa 14–17, Africa 18–23, Global 24–30). This is a **better
register than the original 40-row one** — it is tiered by region, it names where
each source gets its content, and it already marks which claims were *verified*
vs *estimated*. It should supersede the ad-hoc list.

This document reviews it, records what I re-verified on 2026-11-17, and flags
where the sheet's "Estimated" labels are wrong.

## 1. What the sheet gets right

- **Regional tiering.** Nigeria → West Africa → Africa → Global is the right
  shape for a Nigerian-first product, and it matches the framing decision
  (Framing 2).
- **"Where they get their content"** is genuinely useful: it distinguishes
  original reporting, re-reported regulator content, and vendor/PR feeds. That
  directly informs the source policy (a re-report of an ngCERT advisory is not a
  primary source).
- **Honest uncertainty.** Marking most rows "Estimated" and saying "run a
  week-long feed-polling test before committing" is exactly right.
- **Regulator reality.** Rows 1–6, 14, 16, 18, 23 correctly say "plan on RSS or
  scraping, check terms first".
- **The Notes sheet** flags the Regulatory Impact gap correctly: laws need a
  separate reference table; no feed maps alerts to laws automatically.

## 2. What I re-verified (2026-11-17)

The sheet says most feed endpoints are "Estimated" and "not tested". I tested
them. Results:

| # | Source | Sheet claim | Verified 2026-11-17 |
|---|--------|-------------|---------------------|
| 8 | Techeconomy | "Standard WordPress RSS confirmed" | **Confirmed but wrong path.** Feed is `/feed.xml`, not `/feed`. Fresh daily (50 items, today) |
| 9 | Techpoint Africa | "No key. RSS feed." | **No XML feed.** WP REST works (`/wp-json/wp/v2/posts`), fresh daily. Already integrated |
| 10 | TechCabal | "No key. RSS feed." | Confirmed `/feed/`, fresh daily. Integrated |
| 11 | Nairametrics | "No key. RSS feed." | Confirmed `/feed`, fresh daily (business/markets; some cyber) |
| 12 | Tech Digest NG | "No key. RSS feed." | **Confirmed** `/feed`, fresh (1 day) |
| 13 | ITEdgeNews Africa | "No key. RSS feed." | **No XML feed.** WP REST present and fresh (today) — needs api collector |
| 14 | CSA Ghana | "No API" | Home OK, **no feed found**. Needs HTML scrape or re-check |
| 15 | Osiris.sn | "Daily, cybercrime section" | Feed path exists (`spip.php?page=backend`) but returned **0 items** — verify manually |
| 17 | B&FT Online | "No key. RSS feed." | **No feed found** on `/feed`; home OK. Re-check |
| 18 | KE-CIRT/CC | "Weekly" | **Feed dead: newest 2021-03-16 (2072 days old).** Sheet's "Weekly" is wrong |
| 19 | CybAfrique | "RSS feed from newsletter platform" | beehiiv home OK, **no feed found**. beehiiv feeds differ; needs the newsletter API or scrape |
| 20 | ITWeb Africa | "No key. RSS feed." | **Confirmed** `/rss`, fresh (0.3 days) |
| 21 | IT News Africa | "No key. RSS feed." | **No XML feed found**; WP REST returned HTML. Re-check |
| 22 | Tech In Africa (cyber) | "RSS feed" | Feed exists but **newest 2026-01-23 (298 days)** — effectively dormant |
| 23 | Africa CERT | "Monthly" | Feed exists (`/home/feed/`) but **newest 2025-12-20 (333 days)** — dormant |
| 30 | ENISA | "RSS feed" | `/rss` 404; needs the correct ENISA feed path |

**Net:** of the sheet's "RSS feed" rows, roughly **half** are actually usable as
claimed, and several are stale/dormant rather than merely "Estimated". This
repeats the lesson from the original probe: *a feed existing is not a feed
working.*

## 3. Corrections to apply to the register

Promote these into `00-source-register.md` (and the code registry):

| Source | Correction |
|--------|-----------|
| Techeconomy | Enable; feed URL is `/feed.xml` |
| Techpoint | Already integrated via WP REST (`api`) |
| Tech Digest NG | Enable; `/feed` works |
| ITEdgeNews Africa | Enable via WP REST (`api`); not RSS |
| ITWeb Africa | Enable; `/rss` works |
| KE-CIRT/CC | **Do not enable** — feed 5+ years stale |
| Africa CERT | **Do not enable** — feed ~11 months stale |
| Tech In Africa | **Do not enable** — ~10 months stale |
| Osiris.sn / B&FT / CybAfrique / IT News Africa | Unverified — re-probe before enabling |
| CSA Ghana / ENISA / ARTCI | Regulator/policy: scrape or find correct feed; terms check first |

## 4. Structural gaps the sheet still has

- **No licence column.** The sheet has "API Key / Access" but not licence terms.
  Source policy §1 requires licence recorded before the first fetch.
- **No paywall column.** Matters for the press rows.
- **Global rows (24–30) are the daily-volume answer.** CISA KEV (JSON),
  NVD (free key), BleepingComputer, Hacker News, The Record are exactly the
  Tier A filler this project needs — and the sheet already has them. Confirmed
  live: BleepingComputer/Hacker News/SecurityWeek fresh hourly.
- **"No API" is used loosely.** Rows 1–6 say "No API" but the *sites* are
  WordPress (ngCERT, NITDA, NDPC all expose `/wp-json`). "No *documented* API"
  would be more accurate.
- **The Regulatory Impact reference table** the Notes flag is missing is a real
  deliverable (maps a notice to the law it enforces) — noted, not yet built.

## 5. Recommendation

1. **Adopt this sheet as the register's spine**, replacing the flat 40-row list.
2. Re-probe the "unverified" rows (15, 17, 19, 21, 30) once from a production IP.
3. Add the **licence** and **paywall** columns the register already requires.
4. Wire the **confirmed-working** rows (Techeconomy, Tech Digest, ITEdgeNews,
   ITWeb Africa) plus the **Tier A globals** as the next collector batch.
5. Treat KE-CIRT, Africa CERT and Tech In Africa as **dormant** until proven
   otherwise — do not build collectors for feeds that stopped publishing.
