# NovrPulse — Editorial & Legal Policies

Phase 0 artefact · v1 · 2026-11-09

Four policies, written **before the first public post** (plan task 5). These are
not aspirational statements; each one constrains code and editorial behaviour,
and each names what it forbids.

> **Caveat that must stay in this document.** NovrPulse is not a law firm and
> this is not legal advice. Nigerian copyright, defamation and data-protection
> law is interpreted by courts; the rules below are the operator's *operating
> posture* — deliberately conservative — not a legal opinion. Where a decision
> is material (a named arrest, a paywalled republish, a large data ingest),
> get a Nigerian lawyer to confirm before publishing.

---

## 1. Source policy

**Purpose:** the allowlist stays clean, licensed and auditable.

1. **Nothing is collected without a register row.** The register
   (`00-source-register.md`) is the authoritative allowlist. Adding a source
   requires: name, URL, owner, licence status, and a named approver.
2. **Licence status is recorded before the first fetch.** `unknown` is not
   permission. A source may be collected in `unknown` status *only* via its
   public RSS feed, and only until the licence column is filled in. HTML
   scraping of an `unknown`-licence source is **forbidden**.
3. **RSS before HTML before headless.** In that order. A source is scraped by
   HTML only when no feed exists, and headless only when the site is JS-rendered.
4. **`robots.txt` is checked once per source and the result recorded.** Some
   Nigerian publishers permit feed aggregation; some do not. Either way it is
   written down.
5. **Every source has a named owner and a canary.** A source with no owner is
   removed. A canary that has failed for 7 days disables the source rather than
   silently emptying the feed.
6. **Source removal is a first-class action.** If a publisher objects, the
   source is removed, its documents are purged from the raw store on request,
   and any derived `publish_item` is corrected or pulled per the correction
   policy. Expect this to happen at least once; the response is what protects
   the brand.

## 2. Defamation & contempt policy (arrest and accusation items, function 7)

**Purpose:** this is the highest-frequency legal risk (plan §9). It applies to
every item drawn from EFCC, NPF-NCCC and press reporting on arrests, charges and
alleged wrongdoing.

**Hard rules:**

1. **Report the charge as stated by the agency.** Quote the agency's wording.
   Never restate a charge in your own stronger terms.
2. **Attribute every allegation to its source.** "The EFCC said…", "according
   to the police statement…". No unattributed assertion of wrongdoing, ever.
3. **No characterisation.** The following words are **forbidden** in NovrPulse
   output about a named person pre-conviction: *fraudster, culprit, scammer,
   criminal, hacker, thief, guilty, mastermind.* Report the charge; do not
   conclude it.
4. **Never imply guilt from arrest.** Arrest is not conviction and must be
   described as such. Include, where the item names a person, a standard
   formulation such as: *"A charge is not a conviction."*
5. **Public tier minimises naming (structural mitigation).** For arrest items,
   the **public** tier reports the charge and the sector/organisation ("a Lagos
   fintech executive", "a bank employee") **without the person's name**. The
   named version, if warranted, lives in the **analyst** tier behind login.
   This removes the highest-frequency exposure from the highest-reach surface.
   *(This inverts the plan's default tiering deliberately; it is the single most
   effective defamation control available.)*
6. **Right of reply.** If a named person or their representative contacts
   NovrPulse, their response is added to the item, unedited in substance, within
   one working day.
7. **Editor sign-off on every arrest item.** No automation may publish an item
   in this category without human approval — including after Phase 2.
8. **Contempt.** Never publish material that could prejudice an ongoing
   proceeding: no evidence, no witness commentary, no speculation on outcome.

## 3. Copyright policy

**Purpose:** fair-dealing is narrower in Nigeria than US fair use. Summarise in
your own words; do not paraphrase closely.

**Hard rules:**

1. **Never republish an article body.** Not in whole, not in a long extract, not
   as a "reproduced with permission" unless permission is actually in writing
   and recorded against the source row.
2. **Permitted per item:** the headline (or your own rewritten headline), a
   short quoted extract where fair dealing applies, **your own summary**, and a
   prominent link to the original.
3. **Summarise, don't paraphrase.** A close paraphrase is a derivative work. The
   summary must be in NovrPulse's own words and structure, and must add the
   "what it means" layer — which is the product anyway.
4. **Paywalled sources (rows 9, 16, 30, 36) are quote-limited.** Do not
   reconstruct paywalled content. Headline, link, and the "what it means" layer
   only.
5. **Images are not covered by text fair dealing.** Do not hotlink or rehost
   publisher images. Use your own visuals or none.
6. **Regulator notices (public documents) are the exception in practice.** CBN,
   NCC, NITDA, NDPC and ngCERT publish notices for public consumption; summarise
   them freely, but **always link the original PDF and cite the page** you drew
   from.
7. **Every `publish_item` records its source link and licence basis.** No link,
   no publish.

## 4. Correction policy

**Purpose:** you will get something wrong. How you handle it decides whether the
bank customers stay (plan §9). A correction is a *trust event*, not a
compliance chore.

**Hard rules:**

1. **Corrections are first-class.** Every correction is recorded in the
   `correction` table against the `publish_item`, with reason, corrected-by and
   timestamp. Nothing is silently edited.
2. **Never silently edit a published item.** If the meaning changes, it is a
   correction. If only a typo changes, it is an edit and is noted as such.
3. **Corrections are pushed, not just posted.** A subscriber who received the
   wrong item by digest **receives the correction by the same channel,
   automatically**. Correction-triggers-redelivery is a **Phase 2 requirement**,
   not a Phase 3 nicety.
4. **Regulator-summary errors are escalated.** A mis-summarised CBN/NCC notice
   is the highest-trust risk. It is corrected within 24h, linked to the original
   PDF page, and reviewed to see whether the extraction or the editor caused it.
5. **Visible correction policy.** The public site carries a one-line, always-
   visible statement of this policy and a way to report an error.
6. **Withdrawal.** If an item cannot be corrected (e.g. a source retracts, or a
   defamation risk materialises), it is **withdrawn** — removed from the public
   tier with a note that it was withdrawn, and retained in the record for audit.

---

## 5. Data protection (cross-cutting)

Applies to all four policies above; Nigeria's Data Protection Act 2023 and NDPC
rules.

1. **Minimise PII from scraped sources.** Do not ingest victim lists,
   credentials, contact databases or leaked data — ever, regardless of source.
2. **Never ingest credentials or breach dumps**, even when a "breach" item is
   the story. Report the breach; do not store its contents.
3. **Named individuals** appear only in function 7/8 contexts and per the
   defamation policy; keep the minimum needed for the story.
4. **Deletion on request** is honoured and recorded (see source policy §6).

---

## 6. Confidence floors (cross-cutting)

`confidence[reported|confirmed|claimed]` exists on every event. Each function has
a **minimum** it may publish at; without this the field is decoration.

| Function | Minimum confidence | Rationale |
|----------|-------------------|-----------|
| F1 Regulatory Impact | `confirmed` **against the primary PDF** | Highest-trust output; must trace to the notice itself |
| F7 Breaking News | `reported` | Speed matters; attribute and label the level |
| F8 CyberIntel | `claimed` (if labelled) | Analysis may narrate claims; must say so |
| F2 Forum Topic | inherits the source item's floor | Poses a question; inherits its feed item |
| F3 Education | n/a | Evergreen, not event-bound |
| F4 Campaign | n/a | Evergreen, not event-bound |
| F5 Events | `confirmed` for date/venue | A wrong date is a broken promise |
| F6 Outreach | `confirmed` for eligibility/deadline | A wrong deadline wastes a reader's chance |

Anything below a function's floor is held for review, not published.
