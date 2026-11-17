# NovrPulse — Phase 0: the two-week manual run

Phase 0 artefact · v1 · 2026-11-09

Phase 0 is **two weeks, manual, no code** (plan §7). It is the highest-ROI step
in the plan and the one most often skipped. It produces three things nothing else
can:

1. Proof the content is wanted.
2. The editorial judgement for each of the eight functions.
3. The **golden evaluation set** — built from your own decisions, not guesses.

It also tells you which of the 40 sources are noise. Expect to cut several.

---

## 1. Ground rules

- **No code.** No collectors, no database, no LLM. Spreadsheets, an editor and a
  publishing surface. If you cannot run the product by hand, you do not
  understand it yet.
- **Publish publicly.** The point is evidence of demand. Unpublished Phase 0
  teaches you nothing about whether anyone wants this.
- **Run all eight functions**, even the ones you plan to make weekly.
- **Follow the policies as if they were enforced by code** (`01-policies.md`).
  Every choice is a rehearsal for the rules the pipeline will later enforce.

---

## 2. Daily routine (roughly the target shape of the shipped product)

| Step | What happens | Time |
|------|--------------|------|
| 1 | Scan the register sources for the day's material | 30–45 min |
| 2 | Select F1 (regulatory) and F7 (breaking) items | 15 min |
| 3 | Write F1 and F8 by hand against the templates | 60–90 min |
| 4 | Write F2 (selected from 1/7/8) and F7 | 20 min |
| 5 | Publish; note every decision you made and why | 15 min |

Weekly, on a fixed day: F3 (education), F4 (campaign), F5 (events), F6 (outreach).

**Every editorial decision is logged.** The log is the golden set. When two
sources carry the same CBN notice and you pick one, that is a dedup/cluster
decision — write it down. When an item is F1 not F7, that is a function-tagging
decision — write it down. When you change a template slot's wording, that is a
template-version decision.

---

## 3. What to record (the golden set)

A single spreadsheet with these sheets is enough. It becomes the evaluation set
that every Phase 1–2 component is tuned against.

| Sheet | Columns | Used to evaluate |
|-------|---------|------------------|
| `source_health` | date, source, produced_item (y/n), quality (1–5), notes | which sources to cut; canary expectations |
| `dedup` | date, item A, item B, same_event (y/n), canonical | layer-3 semantic clustering |
| `entities` | surface_form, canonical_entity, type, decision | entity alias table + resolution |
| `function_tags` | item, chosen_function(s), alternatives_considered, why | function tagging model |
| `confidence` | item, assigned_level, why | confidence classification + floors |
| `defamation` | item, named_in_public (y/n), rationale | defamation policy calibration |
| `corrections` | item, what_was_wrong, how_corrected, channel | correction workflow + redelivery |
| `time` | date, per-function minutes | the real editorial cost, to staff against |

---

## 4. Exit criteria (what "Phase 0 done" means)

Phase 0 is complete when all of the following are true — not when two weeks have
passed:

- [ ] All eight functions have run **for at least 5 days each** (daily functions
      for 10+ days).
- [ ] The `source_health` sheet shows a defensible keep/cut decision for all 40
      rows, and the cuts are made in the register.
- [ ] The `function_tags` sheet has **≥100 tagged items** — enough to tune a
      classifier.
- [ ] The `entities` sheet has the alias decisions for every Nigerian
      organisation that appeared more than once.
- [ ] The house style guide is written, from decisions actually made — not in
      advance.
- [ ] At least one **real correction** has been issued and pushed to readers
      (there will be one; handle it in the open).
- [ ] The one-line pitch holds up: *"Nigeria's daily cybersecurity brief — what
      happened, what it means, what to do about it."*

---

## 5. Phase 1 kill criterion (write the number down now)

The plan says "if 15 sources cannot stay fresh, 40 won't" — good, but
unfalsifiable. Make it concrete so it is not renegotiated when you are impatient:

> **Phase 1 is not complete, and Phase 2 does not start, until 15 sources sustain
> ≥95% fetch success with canaries green for 14 consecutive days.**

If that bar is not met, fix collection. Do not start Phase 2 on a shaky
foundation; the understanding layer amplifies whatever collection gives it,
including gaps.

---

## 6. Decisions to make during Phase 0, not after

1. **Which tier funds Phase 1–2.** Recommendation: banks/fintechs. The sellable
   artefact is the **regulator-change digest** (a named recurring obligation, an
   audit-evidence line item) — not a generic feed. The first design-partner bank
   should influence which regulators you collect first.
2. **Which 3–4 regulators your first customer actually worries about.** Build
   those collectors first, not all eight.
3. **House style.** Written in Phase 0, not later — otherwise the eight outputs
   drift apart within a month.
4. **Whether the public tier names arrested individuals.** Recommendation: **no**
   (defamation policy §2.5). Confirm and write it into the style guide.
5. **F4 and F5 cadence.** Plan says weekly from the start (§8). Confirm — if one
   person runs NovrPulse alongside other work, daily campaigns/events will slip.

---

## 7. What Phase 0 must NOT do

- **No collector code.** (That is Phase 1.)
- **No LLM in the loop.** Write it by hand; you are building the target output
  the model will later be measured against.
- **No publishing arrest items with names in public** "just to test" — the test
  is the risk.
- **No adding sources.** Use the 40. Phase 0 is where you subtract, not add.
