# NovrPulse — The Eight Functions: Projection Templates

Phase 0 artefact · v1 · 2026-11-09 · **frozen before collector code** (plan task 7)

One store, eight views. Each function is a **view with a fixed output template**
the pipeline fills and an editor approves. Fixed templates are what make AI
assistance safe and reviewable at volume (plan §3.3); free-form generation at
eight outputs a day becomes unmanageable within a month.

**Rules that apply to all eight:**

- `{slot}` = pipeline-filled. `[brackets]` = editorial instruction, not output.
- Every item carries: the function's **confidence floor** (`01-policies.md` §6),
  its **source link**, and its **template_version**.
- Templates are versioned. Changing a template is a version bump, and
  `publish_item.template_version` records which one produced each item.
- **Cadence** is part of the definition — a function that cannot meet its
  cadence is downgraded, not silently skipped.

---

## F1 — Regulatory Impact

- **Job:** turn a regulator notice into "what this means for you".
- **Sources:** 1–8 (CBN, NCC, NITDA, NDPC, ngCERT, + others).
- **Tier default:** public summary; client (bank) version carries the action item.
- **Cadence:** daily (on regulator activity), editor-reviewed.
- **Confidence floor:** `confirmed` against the primary PDF.
- **Human review:** **mandatory** until the golden set proves otherwise (plan §9).

**Template**
```
{Regulator} issued {what} on {date}.
Applies to: {segment}.
What it changes: {change_in_plain_language}.
Action for {role}: {action_item}.
Source: {link to original PDF}, p.{page}
```

**Template rules**
- `{Regulator}` = canonical entity name; do not abbreviate inconsistently.
- `{change_in_plain_language}` must be NovrPulse's own words (copyright policy).
- The `p.{page}` reference is **required** — it is the audit trail to the notice.
- The client/bank version adds the `Action for` slot in imperative form.

---

## F2 — Forum Topic of the Day

- **Job:** prompt discussion from the day's strongest item.
- **Sources:** a **selection** from F1, F7 and F8 (explicitly not new ingestion).
- **Tier default:** public.
- **Cadence:** daily.
- **Confidence floor:** inherits the source item's floor.
- **Rule:** never introduce a new claim not present in the item it selects from.

**Template**
```
Today's topic: {short_question_or_frame}
Why it matters: {one_line_context}.
Read: {source_item_link}
```

**Template rules**
- `{short_question_or_frame}` must be a genuine question or a genuine framing —
  not a headline restated as a question ("Did CBN do X?" is banned).
- One topic per day. If in doubt, pick the F1 or F7 item with the highest
  severity.

---

## F3 — Public Education & Advocacy

- **Job:** awareness content, scam patterns, safety basics.
- **Sources:** evergreen; may be prompted by F7/F8 but does not depend on a feed.
- **Tier default:** public.
- **Cadence:** **weekly** at Phase 0 (daily only if bandwidth allows).
- **Confidence floor:** n/a (not event-bound). Claims must still be accurate.

**Template**
```
{Pattern or risk name}
What it looks like: {concrete example}.
How to spot it: {2–3 tell-tale signs}.
What to do: {1–2 actions}.
```

**Template rules**
- A concrete example beats an abstract description. Prefer a Nigeria-relevant one.
- Do not turn a news event into education by pasting it in; extract the *pattern*.
- Do not build this from DefenseCERT until row 8 is verified (register §1).

---

## F4 — Awareness Campaign (CAC)

- **Job:** campaign-style content and outreach messaging.
- **Sources:** curation of the same material; campaign-led, not feed-led.
- **Tier default:** public.
- **Cadence:** **weekly from the start** (plan §8 — this is first to slip if daily).
- **Confidence floor:** n/a.

**Template**
```
Campaign: {campaign_name}
Message: {single_core_message}.
Supporting: {1–2 facts or patterns}.
Call to action: {one thing the reader should do}.
```

**Template rules**
- One campaign, one message. If two messages, it is two campaigns.
- CAC content runs on a schedule and is owned by a named editor (plan §8: no
  feature that adds an unowned daily obligation).

---

## F5 — Events

- **Job:** cybersecurity events calendar for Nigeria and Africa.
- **Sources:** rows 30–37, 34–35 (AU/ECOWAS) + operator submissions.
- **Tier default:** public listing; analyst/client digests fold in relevant ones.
- **Cadence:** **weekly from the start** (plan §8).
- **Confidence floor:** `confirmed` for date and venue.

**Template**
```
{Event name} — {city, country}
Date: {dates}. Format: {in-person|virtual|hybrid}.
For: {audience}.
{One-line description}.
Register/info: {link}
```

**Template rules**
- A wrong date is a broken promise: dates and venue must be `confirmed`, not
  `reported`.
- Expired events are archived, not deleted, and moved off the active listing.

---

## F6 — Outreach (scholarships, training, grants, opportunities)

- **Job:** surface scholarships, free training, grants, opportunities.
- **Sources:** opportunistic (row 29 Legit.ng, Opportunity Desk, operator tips).
- **Tier default:** public.
- **Cadence:** weekly; **curate hard** — sources are noisy (register §2.2).
- **Confidence floor:** `confirmed` for eligibility and deadline.

**Template**
```
What: {opportunity_name}.
Who: {eligibility}.
Benefit: {what it provides}.
Deadline: {date}.
Apply: {link}
```

**Template rules**
- Verify the deadline against the **primary** page, not a secondary write-up.
- Reject anything whose host can't be confirmed legitimate; opportunistic
  sources attract scam "opportunities".

---

## F7 — Breaking News of the Day

- **Job:** advisories and incidents, fast and attributed.
- **Sources:** 1–8 + press (rows 9–29).
- **Tier default:** public (short), analyst (full).
- **Cadence:** daily.
- **Confidence floor:** `reported`.
- **Defamation policy applies in full** (`01-policies.md` §2).

**Template**
```
{What happened} — {who} — {where} — {source}.
Confidence: {reported|confirmed|claimed}
```

**Template rules**
- `{who}` for a **named individual in an arrest/accusation item** is *omitted in
  the public tier* and replaced by sector/organisation ("a Lagos fintech
  executive"). The named version may go to the analyst tier. See defamation
  policy §2.5.
- Forbidden pre-conviction words (fraudster, culprit, etc.) — see policy §2.3.
- "A charge is not a conviction." appears on any item naming a person charged.
- Attribute every allegation to the agency or outlet that made it.
- Editor sign-off on every arrest item — automation may not publish this category.

---

## F8 — CyberIntel

- **Job:** deeper analysis, actor and threat context.
- **Sources:** same store, filtered for depth; entities + provenance.
- **Tier default:** **analyst** (paid); client version for sector-filtered reads.
- **Cadence:** daily at Phase 3; may begin as less-than-daily at Phase 0.
- **Confidence floor:** `claimed` (if labelled).
- **Reality check (plan §9):** F8 is analyst work with provenance; it will not
  compress to 15 minutes. Budget ~45–60 min/day at maturity.

**Template**
```
{Incident} affecting {sector}.
Actor: {actor | unknown}.
Vector: {vector}.
Context: {actor history, sector exposure, prior incidents}.
Assessment: {analyst judgement, labelled as assessment}.
Provenance: {links + confidence per claim}
```

**Template rules**
- `unknown` is a valid and preferred value for `{Actor}` — do not manufacture
  attribution to fill a slot.
- `Context` draws on the entity store; entity links are shown, not hidden.
- `Assessment` must be visibly separated from reported fact.
- Every claim carries its provenance and confidence level.
- Named individuals follow the defamation policy.

---

## Cadence summary (what actually ships per day/week)

| Function | Cadence | Tier default | Confidence floor | Automation limit |
|----------|---------|--------------|------------------|------------------|
| F1 Regulatory Impact | daily | public + client | `confirmed` (PDF) | editor sign-off always |
| F2 Forum Topic | daily | public | inherits source | may auto-draft |
| F3 Education | weekly (Phase 0) | public | n/a | may auto-draft |
| F4 Campaign | weekly | public | n/a | may auto-draft |
| F5 Events | weekly | public | `confirmed` (date/venue) | may auto-draft |
| F6 Outreach | weekly | public | `confirmed` (deadline) | may auto-draft |
| F7 Breaking | daily | public + analyst | `reported` | **no auto-publish on arrest items** |
| F8 CyberIntel | daily (Phase 3) | analyst | `claimed` (labelled) | editor sign-off always |

**Daily load at maturity:** F1 and F8 at ~45–60 min each; everything else
templated. This is ~3–5 hours/day, not the 2–4 the plan estimated — the
difference is the mandatory human review on F1 and the provenance work on F8.
Staff to that number, not the optimistic one.
