# Functions Spec — the Eight Briefing Pillars

Owner-confirmed specification · 2026-11-24 · **the canonical behavioural spec** for
the eight briefing functions.

This is the authority for **what each pillar must do and the rule it must obey**.
`03-function-templates.md` remains the **frozen OUTPUT template contracts** (written
during phase 0; slot names there may differ slightly from the shipped scaffolds).
Where a template slot and a scaffold field diverge, the Writer scaffolds
in `frontend/src/lib/canvasScaffolds.js` bridge them, and the binding columns in
`publish_item` carry the machine-checkable fields.

**Enforcement legend:** ✅ enforced in code · ◑ partial (guidance/scaffold, not
gated) · ❌ not built.

---

## Summary

| fn | Name | Working rule | Enforcement |
|----|------|--------------|-------------|
| 1 | Regulatory Impact | Each item needs a regulatory-impact field, completed before it can be published. | ✅ |
| 2 | Forum Topic of the Day | One topic per day, linked to the forum thread. | ◑ |
| 3 | Public Education & Advocacy | Simple, non-technical wording; framework and body names tagged on each item. | ◑ |
| 4 | Cybersecurity Awareness Campaign / Cyber Hygiene | Separate from fn 3, which is general and legal in tone. | ✅ |
| 5 | Events | Event entries need a date and are published ≥ 7 days ahead. | ✅ |
| 6 | Outreach Initiatives | Link to NovrAcademy courses where applicable. | ◑ |
| 7 | Breaking News of the Day | Fed by the pull from sources, after AI selection and reviewer verification. | ✅ |
| 8 | CyberIntel | Each item answers the three questions: what is happening, whether it affects the reader, and what to do. | ✅ |

---

## fn 1 — Regulatory Impact

- **What it does.** For every alert or news item, show which laws or regulations it
  affects and what that means for the reader's business.
- **Rule (verbatim):** each item needs a regulatory-impact field, completed before it
  can be published.
- **Enforcement:** ✅ ENFORCED — `publish_item.regulatoryImpact` column; approval
  refuses with `REGULATORY_IMPACT_REQUIRED` when empty.
- **Contracts:** scaffold `'01'` (bound slot → `regulatoryImpact`, index 5);
  `assertSectionRequirements` (fn 1 branch).

---

## fn 2 — Forum Topic of the Day

- **What it does.** Set one discussion topic daily to bring people into the
  NovrAcademy community forum.
- **Rule (verbatim):** one topic per day, linked to the forum thread.
- **Enforcement:** ◑ PARTIAL — one topic per day via the briefing section; the
  forum-thread link is optional (`ForumTopic.forumUrl`), not enforced.
- **Contracts:** scaffold `'02'` (slot "Link to forum thread" — unbound).

---

## fn 3 — Public Education and Advocacy

- **What it does.** Explain cybersecurity in plain language (e.g. "if you steal
  someone's login details, you can end up in jail"). Also titled **Advocacy for the
  Nigerian Legal and Regulatory Framework**, covering bodies such as NPF-CCC, ngCERT,
  DefenseCERT and NCC-CSIRT.
- **Rule (verbatim):** simple, non-technical wording; framework and body names tagged
  on each item.
- **Enforcement:** ◑ PARTIAL — wording guidance in the Writer scaffold; the body-names
  tagging is NOT yet enforced. *Open decision:* hard-require known body names vs a tags
  column vs soft warning.
- **Contracts:** scaffold `'03'` (slots include the institution/body slot — unbound).

---

## fn 4 — Cybersecurity Awareness Campaign (CAC) / Cyber Hygiene

- **What it does.** Run campaigns on how attacks work and how to stay protected; the
  technical side.
- **Rule (verbatim):** separate from fn 3, which is general and legal in tone.
- **Enforcement:** ✅ separate scaffold + guidance.
- **Contracts:** scaffold `'04'` (slots: incident / entry point / what the attacker did /
  final impact / key lesson / source).
- **Output format aligned to the original Cybersecurity Weekly formats (Attack Scenario
  case study / deep-dive lead: Summary–Impact–Affected–Mitigation–Why it matters).**

---

## fn 5 — Events

- **What it does.** List upcoming cybersecurity events with at least 7 days' notice.
- **Rule (verbatim):** event entries need a date and are published 7+ days ahead; the
  separate NovrEvents site is planned.
- **Enforcement:** ✅ ENFORCED — `publish_item.eventDate`; approval refuses with
  `EVENT_DATE_REQUIRED` / `EVENT_NOTICE_TOO_SHORT` (< today+7d). **NovrEvents: future**
  — records kept reusable.
- **Contracts:** scaffold `'05'` (bound field → `eventDate`, index 2);
  `assertSectionRequirements` (fn 5 branch, `EVENT_NOTICE_DAYS`).

---

## fn 6 — Outreach Initiatives

- **What it does.** Offer charity-basis scholarship programs, free courses and similar
  opportunities.
- **Rule (verbatim):** link to NovrAcademy courses where applicable.
- **Enforcement:** ◑ PARTIAL — structured form (kind/provider/deadline/eligibility/url);
  NovrAcademy linking not automated.
- **Contracts:** scaffold `'06'` (fields: kind / provider / deadline / eligibility / link).

---

## fn 7 — Breaking News of the Day

- **What it does.** Add the day's breaking cybersecurity news, including security
  advisories.
- **Rule (verbatim):** fed by the pull from sources, after AI selection and reviewer
  verification.
- **Enforcement:** ✅ matches the built pipeline (Wire → AI (dedup; recommender planned)
  → reviewer accept/write → defamation gates at creation).
- **Contracts:** scaffold `'07'`.
- **Schedule:** collection runs daily 05:00 UTC (06:00 WAT) via Vercel cron → `/api/pulse/collect/run`.

---

## fn 8 — CyberIntel

- **What it does.** Give clear, useful information on current threats, attackers and
  risks: what is happening, whether it affects the reader, and what to do.
- **Rule (verbatim):** each item answers those three questions.
- **Enforcement:** ✅ the fn 8 scaffold slots cover the three questions.
- **Contracts:** scaffold `'08'` (slots: summary / impact / affected / mitigation /
  why it matters / source).
- **Output format aligned to the original Cybersecurity Weekly formats (Attack Scenario
  case study / deep-dive lead: Summary–Impact–Affected–Mitigation–Why it matters).**

---

## Cross-references

| What | Where |
|------|-------|
| Frozen output template contracts | [`03-function-templates.md`](03-function-templates.md) |
| This behavioural spec | `10-functions-spec.md` |
| Writer scaffolds (slot/field defs, bindings, guidance) | `frontend/src/lib/canvasScaffolds.js` |
| Approval gates (`assertSectionRequirements`) | `backend/src/controllers/publishController.js` |
