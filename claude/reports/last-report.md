# Stage 2 plan – for your approval (31-Oct-2026)

**Status: plan written, nothing built. Decision needed: approve the plan + answer 5 yes/no questions.**
Full plan: `claude/stage-plan.md`, section "Stage 2 plan".

## What we start from
- Rule tables exist, but live has **0 rules**. The checks are written in code; the library only switches them on or off. That breaks "no rule is hard-coded", so 2a fixes it first.
- The money code still uses the old "Discount 1 / Discount 2" model. It changes to today's money rules.
- Status words, colours and insurer names are written in code (one file, with the old HMS code). They move into a table.

## Sub-stages (14 prompts, inside the budget)

| # | What is built | Done when | Migration | Prompts |
|---|---|---|---|---|
| 2a | Rule engine: every check comes from the Rule Library (simple conditions + calculated checks whose numbers sit in the rule). Money rules changed to today's rules. About 30 initial rules (requirements section 12) loaded. Most specific rule wins (for example an insurer's own TDS rate beats 10%). | No check written in code (a test enforces it); making a rule Inactive stops it on the next run; money rules match decisions section 8 | Rule definition columns + seed of initial rules (you shown as approver; can be undone as a group) | 2 |
| 2b | Word and name lists: status words, insurer / TPA / department / doctor names. AI suggests, a person confirms once; confirmed spellings fixed automatically everywhere. Words confirmed in one hospital are pre-filled for the others ("Confirm all"). One list page across all hospitals. Day–month swap rule. | No word, colour or name list left in code; pilot words and names listed for confirmation | `dictionary_entries` table (+ insurer Hardcopy Required, hospital POD Start Date) | 2 |
| 2c | Claim checks across rows (same UTR on several claims, same patient + same admission date), two-part approval combining, "value is correct" for Warnings (who, when; never asked again; a format fix does not undo it). Every issue shows its reason. | Tests pass for all these cases | `issue_confirmations` + two-part link | 2 |
| 2d | Rule Library page: three-part form, edit (new version), Delete = Inactive, upload with preview, conflict warning on save, test before save (runs in the background, shows hits per hospital), plain-words box (AI fills the form, never saves). | A rule can be added, tested, edited, made Inactive and uploaded from the page; screen check passes | `save_rule_version` function | 2 |
| 2e | Rule trial: per-hospital summary (Errors and Warnings per rule) that you approve once; questions in Stage 4 go out only after that. Check sets: you pick 5 known-correct claims per pilot; re-checked after every mapping, rule or name change; alert if one fails. | Trial and check sets work on test data | `rule_trials`, `check_set_claims` | 2 |
| 2f | Real trial on the 3 pilots, you approve the 3 summaries and pick the check sets; code review of the whole stage; you push. | Stage done-criteria met | none expected | 2 |
| – | Reserve for fixes (2a first, it is the largest) | – | – | 2 |

**Migrations to expect:** 5 (2a–2e), each shown to you before live, backup first.

**Your work in the stage (only in 2f):** decide the few headers still open (HMS MAIL SENT DATE, MAIL SUBJECT; TDS in Badagara and Tree G; a few value-shape items), confirm the pilot words and names, pick 5 claims per pilot, approve the 3 trial summaries. I will give you the exact list and screens at that time.

## Design review (design-reviewer agent): "Change before build" – all findings applied
- Must: status words pre-filled from other hospitals (otherwise ~1,000 confirmations at 130 hospitals) – applied.
- Must: default for department / doctor names with no similar spelling (otherwise ~6,000 confirmations) – applied, needs your yes (Q4).
- Must: say which rule wins when a general and a specific rule both match – applied (most specific wins).
- Must: one spelling can never map to two names (database key fix) – applied.
- Should (applied): name changes keep history; two-part checks on the combined claim; "value is correct" survives format fixes; rule test runs in the background; initial rules recorded with you as approver; check sets from Settled claims with "accept new values"; one names list across all hospitals.
- Could (applied): write only changed issues each run; hide old developer columns.

## Questions (yes/no)

1. **Rules = simple conditions + a fixed list of calculated checks?** Most rules are "field + condition + compare". Some (money balance, TDS rate, duplicates, same UTR, days without payment) need calculation; their kinds are fixed in code, but their numbers, severity, scope, message and on/off live in the Rule Library. Why: this is how "no rule is hard-coded" is built. A brand-new calculation kind would need code. **Recommend: yes.**
2. **Two-part approval: combine only after a person confirms?** The portal finds rows with the same claim (number + admission + discharge date), both approved, with different approved amounts and different UTRs, and lists them once as "two parts of one approval?". After a yes: one claim, Approved = sum of the two parts, each payment kept with its own UTR. Why: the combining method was left for Stage 2; a wrong automatic combine would change approved amounts. **Recommend: yes.** (If the second approval in your hospitals is the new total, not an extra amount, answer no and say so.)
3. **Start the Rule Library fresh** with about 30 rules from requirements sections 11–12, instead of the old 53-rule list (which has Claimed Amount and Discount 1/2 rules that no longer apply)? Old rule IDs kept where the meaning is the same. Why: live has 0 rules anyway; the old list conflicts with today's money rules. **Recommend: yes.**
4. **Department and doctor names: keep as written when there is no similar spelling?** Only groups of similar spellings ("Dr. Rajesh" / "Dr Rajeesh") are asked; departments are one shared list for all hospitals of a scheme. Why: otherwise every name in every hospital needs a click (about 6,000 at 130 hospitals). Insurer, TPA and status words are still always confirmed once. **Recommend: yes.**
5. **Check set passes when** the 5 claims have zero Errors and Warnings and their key values (dates, amounts, status, claim number) are unchanged; a change for a real reason (for example a new payment) is shown with one "accept new values" click? Why: this defines what the automatic re-check tests. **Recommend: yes.**

**Next:** if you approve, reply "Stage 2 approved" with the answers (for example "1 yes, 2 yes, …"). I then start with `/build-substage 2a`.

Commit made: `docs: plan Stage 2` (stage-plan.md + this report). Nothing to push now.
