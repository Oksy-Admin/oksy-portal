# Oksy Data Cleanse – Stage Plan

New plan agreed 30-Oct-2026 (replaces the old Stages 0–8 and the Stage Playbook).
Last updated: 31-Oct-2026. Decisions behind it: `claude/decisions.md`.

## How every stage runs

1. **Start:** read `handoff.md`, `claude/decisions.md`, `claude/requirements.md`. Do not ask anything already decided.
2. **Plan (`/plan-stage N`):** each stage is split into small sub-stages (1a, 1b…). Anoop approves the whole stage plan once.
3. **Build (`/build-substage Nx`, one prompt per sub-stage):** small commits, one purpose each. Claude makes the commits and tells Anoop what each contains; Anoop runs `git push` once at the end of the stage.
4. **Schema changes:** backup → migration file in `supabase/migrations/` → SQL shown to Anoop → apply to live only after his OK.
5. **Check:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, plus the done-criteria below.
6. **Close (same session):** update the status table below (DONE + date + evidence) and the "Current stage" line in `CLAUDE.md` (the one copy; `handoff.md` keeps its own short version, `AGENTS.md` just points to `CLAUDE.md`, 1-Nov-2026), and add any new decision to `decisions.md`. No separate stage report file; the evidence goes in the status table and in the commit messages.
7. **Gate:** after each sub-stage a short report (`/close-substage Nx`); the next sub-stage of an approved stage may start at once. The next **stage** starts only after Anoop approves.
8. **Prompt budget:** about 55 prompts from Stage 1b to the pilot finish line — setup 2, Stage 1: 12, Stage 2: 14, Stage 3: 8, Stage 4: 7, Stage 5: 6, Stage 6: 6.

## Status at a glance

| Stage | Content | Status |
|---|---|---|
| 0 | Everything built up to 30-Oct-2026 (old Stages 0–3b) | DONE, closed 30-Oct-2026 |
| 1 | Foundations: file clean-up, new mapping model, open bugs, scheme-aware data and claim identity, measurements | **DONE and pushed 31-Oct-2026 (all sub-stages 1a–1e done, migrations on live, zero drift; code-reviewer run, one Must fixed). Next: Stage 2 plan, not started.** |
| 2 | Rule Library, cleaning engine, rule trial on the 3 pilots | **Merged into `main` 1-Nov-2026 (commit `f5aed44`). 2a, 2b done 31-Oct-2026; 2c, 2d, 2e done 1-Nov-2026. 2f: claims live for all 3 pilots, waiting on Anoop's trial approval + dictionary confirm.** |
| 3 | Hosted worker: 6 AM run, retry, run status, change detection | Not started |
| 4 | Question Sheets | Not started |
| 5 | Data & Reports: claims, payments, report download, reconciliation | Not started |
| 6 | 4-menu layout, Home page, light theme | Not started |
| 7+ | Later, as needed | – |

## Stage 0 and Stage 1 – DONE and closed (archived)

Both closed 31-Oct-2026, pushed by Anoop. Full sub-stage detail, evidence, commit lists and the design-review notes: `claude/archive/stage-history.md`.

Headline: Stage 0 built sign-in, roles, Hospitals page, sheet reading and the Fields page. Stage 1 (1a–1e) rebuilt the mapping model (hospital + scheme, 103 header decisions, bulk confirm), reconciled live schema to zero drift, added claim identity/history/record source, and measured run time and Drive change-detection behaviour per sheet. One Must code-review finding fixed before close.

## Stage 2 – Rule Library, cleaning engine, rule trial

- Three lanes (automatic / AI suggestion / human), each change tagged.
- Rule Library: add, upload, edit, Delete = Inactive, plain-words box, conflict check, test before save. Initial rules from `requirements.md` section 12.
- Money rules (`requirements.md` section 11); claim identity and two-part approval combining; status words; insurer/TPA/department/doctor lists confirmed once.
- Error / Warning with reason; "value is correct" recorded with who and when.
- **Rule trial:** for each pilot hospital, a per-rule summary for Anoop before any question goes out; check set of 5 known-correct claims re-checked after any mapping or rule change.
- Done when: no rule is hard-coded; every Error/Warning shows its reason; the trial summary is approved by Anoop for all 3 pilots; the check sets pass.

**Stage 2 plan (drafted 31-Oct-2026, waiting for Anoop's approval)** – 14 prompts in total.

Starting point (code and live, read 31-Oct): rule tables exist (`rules`, `rule_versions` with scheme / insurer / hospital filters, valid dates, status DRAFT / PROPOSED / ACTIVE / RETIRED / REFERENCE; `rule_approvals`; `rule_upload_batches`), but live has 0 rule rows. The checks themselves are written in code (`cleanRow` in `packages/rules/src/clean.ts`, about 30 rule IDs); the library only switches them on or off. `money.ts` still uses the old "Discount 1 / Discount 2" model, not today's money rules (decisions section 8). Status words, the colour legend and insurer names sit in code (`packages/worker/src/hms-profile.ts`, with the old HMS code `HOSP32P000107`). No dictionary table. `issues` table exists (one row per claim + rule + field).

| Order | Sub-stage | Prompts | Migration (one per sub-stage, each shown to Anoop before live) |
|---|---|---|---|
| 1 | 2a – rule engine: rules as data, money rules, initial rule list – **DONE 31-Oct-2026, 1 prompt** | 2 | `rule_definitions`: check definition + action + staff message on `rule_versions`; seed the initial rule list |
| 2 | 2b – dictionaries: status words, insurer / TPA / department / doctor lists, lane 1 fixes – **DONE 31-Oct-2026, 1 prompt** | 2 | `dictionary_entries` (+ insurer Hardcopy Required, hospital POD Start Date) |
| 3 | 2c – claim checks: cross-row rules, two-part approval, "value is correct" | 2 | `issue_confirmations` + two-part link on claims |
| 4 | 2d – Rule Library page: form, upload, conflict check, test before save, plain-words box | 2 | `save_rule_version` function (conflict check, history, audit) |
| 5 | 2e – rule trial and check sets | 2 | `rule_trials`, `check_set_claims` |
| 6 | 2f – pilot trial on live, Anoop approves the 3 summaries, Stage 2 close (code-reviewer) – **IN PROGRESS 1-Nov-2026: merged to `main`, TDS header + column-mappings fixes live, "Run now" succeeded for all 3 pilots; waiting on Anoop's Trial-page approvals + check sets + Dictionary confirmations** | 2 | none expected |
| – | Reserve for fixes (2a first: it is the tightest) | 2 | – |

**2a – Rule engine: rules as data** (2 prompts; 1 migration)
- **Rule definition:** each rule version holds a check definition (JSON) in three parts, the same as the form (requirements section 12): *which rows* (scope: scheme / hospital / insurer / TPA, claim status, valid from / to) → *what to check* → *what to do* (severity Error / Warning, action Automatic / AI suggestion / Ask hospital staff, English message to staff).
- **What to check, two kinds:**
  1. **Simple condition** (most rules): field + operator (empty, not empty, equals, not equals, greater than, less than, before, after, differs by more than, not a number / not a date, implausible year) + compared with another field, a fixed value, or today (+/- days). AND / OR of up to 5 conditions.
  2. **Calculated check** from a fixed list, with its numbers in the rule (never in code): money balance (Bill = Approved + Co-pay + Deduction; Discount vs Deduction), TDS rate (default 10%, tolerance ₹1), expected settlement (Approved − TDS, ₹1), Balance (negative = Error), Settled equal to Approved, duplicate / same patient + same admission date, same UTR on several claims, approved N days with no payment, stay over N days, POD missing from the hospital's POD Start Date. Adding a new calculated kind needs code; changing its numbers, severity, scope, message or switching it off does not.
- **Which rule wins (review Must):** when a general rule and a more specific one (scheme / insurer / TPA / hospital) of the same rule ID or check kind both match a claim, only the most specific one runs (for example an insurer's own TDS rate replaces the 10% rule). Two matching rules of the same specificity = setup error shown on the Rule Library page (existing `EQUAL_SPECIFICITY_CONFLICT`); the 2d conflict check uses the same logic.
- **Engine:** one evaluator in `packages/rules` runs every ACTIVE rule that matches a claim's scope; `cleanRow` keeps only reading and formatting (lane 1) and no longer names any rule ID. Each issue carries rule ID, version, severity, field and the reason text from the rule. A test fails the build if `clean.ts` or the worker contain a rule ID other than the reading-level ones (unreadable cell, non-data row, header changed), which become library rules too.
- **Money:** `money.ts` changed to today's rules (decisions section 8): Deduction (C), Total Settled, Total TDS, Expected settlement, Balance, Settlement Delay from discharge date. TDS never filled in; empty TDS on a paid claim is asked with the expected 10% shown. The old Discount 2 / TDS-path code and columns are no longer written (kept in the table, unused).
- **Initial rule list:** the list in requirements section 12 + section 11, about 30 rules, seeded by the migration as ACTIVE; old seed rules that no longer apply (Claimed Amount, Discount 1/2, old 10% check) are not seeded. Rule IDs of the old seed are kept where the meaning is the same (for example R-D01). The seed records Anoop as approver (note "approved with the Stage 2 plan") and is one `rule_upload_batches` row, so it can be undone as a group. Old developer columns (`tier`, `code_ref`, `golden_test_ids`, `auto_fix_allowed`, severity 'I') are marked unused and never shown on the page or in the upload template.
- **Fewer writes:** a run writes only issues that open, change or resolve; "last checked" is kept per hospital run, not per issue.
- **Tidy:** stale comment above the `record_keys` insert in `sheet-run.ts` (Stage 1 code review).
- Tests: every initial rule against the golden fixtures and hand-made rows (each fires once, and not on a correct row); money rules with the examples in decisions section 8; scope and valid dates; "no rule ID in code" test.
- Done when: all checks come from the library; a rule switched to Inactive stops firing on the next run; money rules match section 8; tests pass; migration applied after OK.

**2a – DONE 31-Oct-2026; migration `20261031060500_rule_engine_data.sql` written and tested locally (`bash scripts/db-test-local.sh`: all migrations replay on a fresh database, all pgTAP tests pass), waiting for Anoop's OK before live.** Evidence:
- Commits `ee6f72b` (engine.ts + initial-rules.ts + selection.ts "which rule wins" fix), `7e916fa` (money.ts rewritten), `fc3fda5` (clean.ts runs the engine), `fa5abda` (worker loads check_definition/action/staff_message; CLAIM_COLUMNS; s1-check.ts; rule-seed-sql.ts), `b4d6ef5` (claims page/query column names), `438c91a` (migration + pgTAP fix), on branch `stage-2-rule-library`.
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass; 273 tests (rules 158, google 40, worker 44, web 31; +33 since Stage 1 close: engine.test.ts, no-hardcoded-rules.test.ts, money.test.ts and clean.test.ts rewritten for the new model).
- **Rule count:** 30 engine (CHECK) rules + 6 structural (REFERENCE) rules + R-T01 (PARAMETER, untouched) = 37 rows. Old IDs kept where the meaning is the same (R-D01, R-D03, R-A01 to R-A03, R-A05, R-A07, R-N01, R-N03, R-N04, R-S01 to R-S07, R-S09, R-S10, R-U01, R-X01, R-C01, R-N02, R-D04 to R-D06, R-Y01, R-T01 — 28 ids); 9 new ids (R-N05, R-D07, R-W01, R-F01 to R-F06). 25 old ids not reseeded (Claimed Amount / Discount 1-2 / old 10% checks and never-implemented ones) are left RETIRED, history kept. R-Y03 (same patient + same admission date, run from `packages/worker/src/identity.ts`) is untouched: Stage 2c moves it into the library.
- **Which rule wins:** fixed in `selectRules` (design review Must): the most specific ACTIVE version of a rule ID replaces the general one; an exact tie is `EQUAL_SPECIFICITY_CONFLICT` and neither runs (same pattern as the existing TDS-rate parameter conflict).
- **Money (decisions section 8):** Deduction = Bill − Approved − Co-pay (always computed; the `deduction_amount` canonical field, previously a stray unused sheet-mapping target, now only ever holds the computed value). Total Settled and Total TDS are sums over payments; Total TDS is the hospital's stated TDS per payment, never derived from a rate. Expected TDS (Approved × rate) and Expected settlement (Approved − Total TDS) exist only for the R-F02/F03/F04 comparisons. Balance = Approved − Total TDS − Total Settled. New `discount_amount` field (the hospital's own "Discount" column) is now properly read and compared with Deduction (R-F01) — previously it was parsed but only dumped into `extra_fields`, never checked.
- **Day-month swap** is now a real automatic fix (decisions section 9), not only a warning: tried on an ambiguous date only when the stay is over 15 days or negative; R-D06 asks when the swap does not resolve it. New `date_swap_applied` claim field.
- Found and fixed on the way: `R-A05` was being used in code for two different meanings (negative-amount and approved-missing); the negative-amount check is now `R-N05`. The severity `'I'` (informational) rule R-H01 ("CO-PAY equals Bill − Approved") is not reseeded (decisions section 12 only has Error/Warning); the `issues.severity` column still allows `'I'` for the unrelated structural R-C01 row. `fields.ts` still offers `deduction_amount` as a mapping target even though it is calculated-only (column-dictionary section 4); no header is mapped to it today, left for a Fields-page cleanup, not fixed here.
- Not built in 2a (left for later, do not block on it): "Settlement Delay" (column-dictionary section 4, Settlement Date − Discharge Date) is not yet a stored or calculated field — no rule in the initial list needs it; it belongs with Stage 5 (Data & Reports). The `rule_upload_batches` "one row, undo as a group" for the seed is not built (that table is shaped for an uploaded file, which this seed is not); each seeded row's `approver_note` ("approved with the Stage 2 plan (31-Oct-2026)") is the audit trail instead — an undo, if ever needed, is a two-line SQL change (re-activate the old version, retire the new one), same as any other rule change. Old developer `rule_versions` columns (`tier`, `code_ref`, `golden_test_ids`, `auto_fix_allowed`) are simply left null for the new rows; hiding them from the Rule Library page and upload template is 2d's job.
- Choices made in the build: compound status/claim conditions (e.g. "settled but missing date or amount") are precomputed as a single boolean field in `clean.ts`, then checked with one `FLAG_TRUE` condition — the engine's AND/OR only combines flat conditions (matches the plan: "AND / OR of up to 5 conditions", not nested groups); R-A05 and R-S04 both still fire together for an Approved claim with no approved amount (kept exactly as the old code's behaviour, not a bug introduced now); R-S06 no longer has the old "red row: rejected or cancelled not known" wording for the colour-ambiguous case specifically — it now shares the generic "status could not be worked out" message (same situation, same severity, only the wording is less specific; adjustable from the Rule Library once 2d exists).

**2b – DONE 31-Oct-2026; migration `20261031070000_dictionary_entries.sql` written and tested locally (`bash scripts/db-test-local.sh`: all migrations replay on a fresh database, all pgTAP tests pass, including the new test 16), waiting for Anoop's OK before live.** Evidence:
- Commits `c904300` (migration + pgTAP test 16 + worker grants allowlist), `786ef6f` (`packages/rules/src/dictionary.ts` suggestion logic + insurer/TPA/department aliasing in `clean.ts`), `94c909a` (`profile.ts` + `dictionary-sync.ts` replace `hms-profile.ts` in the worker), `2378d13` (`/dictionary` page), on branch `stage-2-rule-library`.
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass; 297 tests (rules 170, google 40, worker 48, web 39; +53 since 2a: `dictionary.test.ts` in rules and worker, `profile.test.ts`, web `dictionary.test.ts`); Playwright 3 pass (`/dev/dictionary` added, `/dev/mappings` still green).
- **Found and fixed on the way:** `hmsProfile()` compared `sheet.hospital_code` against the old register code `HOSP32P000107`; HMS's real, current code is `HOSPPVTP0003` (checked live, read-only, 31-Oct: `hospitals` and `hospital_sheets` both key it that way). The comparison never matched, so HMS's confirmed words, colours and doctor aliases had never actually been used on any live run -- every pilot hospital, including HMS, was silently getting the generic `defaultProfile()` instead. The Stage 2b migration seeds HMS's confirmed facts on `HOSPPVTP0003`, so this is fixed as part of moving the data out of code, not a separate repair.
- **Built:** one `dictionary_entries` table (status words and colours per hospital; insurer, TPA, department names one list per scheme for every hospital; doctor names per hospital), unique on `(kind, scheme, hospital_code, spelling_key)` with `NULLS NOT DISTINCT`, Suggested/Confirmed/Rejected/Retired. `decide_dictionary_entry()` (Confirm or Reject one spelling; a Confirmed row is never overwritten -- it is retired and a new current row takes its place). `bulk_confirm_dictionary()` + `undo_dictionary_batch()` (status words and doctor names only -- insurer/TPA/department are already one list for everyone, so there is no "another hospital" to copy from), the 1b-ii batch pattern (max 50, list first, one audit entry, undo as a group). `hospital_profile_facts` (tab stage, TPA-cell-may-hold-insurer, paid-meaning-open-tabs) in its own table, not on `hospitals`, because `04_worker_grants.test.sql` deliberately refuses the worker any right on `hospitals` and the worker must read these every run. `hospitals.pod_start_date` and `scheme_insurers.hardcopy_required` added (decisions section 8; not wired into the engine yet, no rule needs them until a later sub-stage).
- **Seeded:** HMS's 9 confirmed status words (paid/settled/.../na/0, 25-Oct hospital answers) and its `tab_stage_facts`/`tpa_cell_may_hold_insurer` on `HOSPPVTP0003`; the same 9 words as Suggested, pre-filled, for Badagara and Tree G (Policy B + D, one "Confirm all" click once their own data is read); 27 scheme-wide `INSURER` entries from the old `insurerKeys` recognition list. The old `doctorAliasesFrom(questions/answers)` path had 0 live rows (checked read-only): no `DOCTOR` rows are seeded, same as the mechanism it replaces.
- **Suggestion policy (question 4, decisions section 9):** `packages/rules/src/dictionary.ts`, pure and unit-tested. Status words, insurer and TPA names: every new spelling is listed once (small, known vocabulary). Department and doctor names: a spelling with no similar spelling (Levenshtein ≤ 2, or one contains the other) anywhere in the list, known or seen this run, is kept as written with no question; a group of 2+ similar spellings is listed (the HMS "Dr. Rajesh" / "Dr Rajeesh" case). A spelling already in the table, any status, is never asked again.
- **Engine:** `clean.ts` now normalises `insurer_name`, `tpa_name` and `department` from the confirmed dictionary, the same pattern `doctor_name` already used (`M-ALIAS-INSURER`, `M-ALIAS-TPA`, `M-ALIAS-DEPARTMENT`, lane AUTO). The colour legend is read the same way as before (fill + label from the LEGEND tab) but the label-to-meaning guess (`guessColourMeaning`) is only ever a suggestion now; `clean.ts` sees only a hospital's Confirmed colours.
- **Day–month swap:** already built exactly to this spec in 2a (`R-D06`, only when the stay is over 15 days and the swap gives 15 days or less, AUTO lane; otherwise asked) -- verified against this sub-stage's wording, nothing to add.
- **Not built in 2b (left for later, do not block on it):** no page yet to edit `hospital_profile_facts`, `pod_start_date` or `hardcopy_required` by hand (Owner can use Supabase directly until a page exists); the worker does not yet write new `COLOUR`/`INSURER`/`TPA`/`DEPARTMENT` suggestions from a real sheet read (the mechanism and its tests are in place in `dictionary-sync.ts`, but the 3 pilots have not had a real pilot run yet -- that is 2f).
- Choices made in the build: `audit_log` (via `protect_table`), not a new `change_log` entry, records every dictionary decision -- a dictionary entry is reference data, not a claim's own field, so `change_log` (claim-scoped) does not apply; "forces a full re-read" needed no new code, since every run already reads the full sheet (change detection stays off, decision 1e).

**2b – Dictionaries and lane 1 fixes** (2 prompts; 1 migration)
- **One `dictionary_entries` table** for status words (per hospital), insurer, TPA and department names (one list per scheme for all hospitals), doctor names (per hospital): raw spelling key → standard value, status Suggested / Confirmed / Rejected / Retired, evidence (count, tabs), who / when / reason. Unique key (kind, scheme, hospital, key) with `nulls not distinct`, so a global spelling can have only one standard value. A confirmed entry is never overwritten: a change retires the old row and adds a new one (with `change_log` entry and lane), and forces a full re-read. Insurer entries carry Hardcopy Required Yes/No; hospitals get POD Start Date.
- **Filled automatically:** each run collects new spellings (counts only to AI, never patient data; AI suggests the standard value; "TPA LIST" tabs used as a starting point). Exact matches of a confirmed entry are applied automatically (lane AUTO, `change_log`); a new spelling goes to the decision list once; a confirmed insurer, TPA or department spelling is reused by every hospital. **Status words** confirmed in another hospital of the same scheme come pre-filled (Policy B + D pattern), so a new hospital needs one "Confirm all" click; colours stay per hospital and need that hospital's own OK. **Department and doctor names** (per question 4): a name with no similar spelling in the same list is kept as written without a question; only groups of similar spellings ("Dr. Rajesh" / "Dr Rajeesh") are asked.
- **Decision list:** one "Words and names to confirm" page across all hospitals, grouped by spelling, filter by scheme and hospital (moves into Home in Stage 6): Accept / Change, and Confirm all with the 1b-ii batch pattern (Owner / Admin, max 50, list first, undo as a group).
- **Status:** tab → status word → confirmed colour, as today, but from the table; `hms-profile.ts` retired (its confirmed HMS words, colours and doctor names moved to `dictionary_entries` as Confirmed by the migration, with source "25-Oct hospital answers").
- **Day–month swap:** only when stay is over 15 days and the swap gives 15 days or less (lane AUTO, logged); otherwise asked.
- Tests: confirmed word applied; new word listed once; colour never used unless confirmed; swap cases; undo of a Confirm all.
- Done when: no status word, colour or name list in code; pilot words and names listed for confirmation; migration applied after OK.

**2c – Claim checks, two-part approvals, "value is correct" — DONE 1-Nov-2026, 1 prompt** (2 prompts; 1 migration)
- **Cross-row rules** run after all rows of a hospital are read: same UTR on several claims, same patient + same admission date (moved from the 1d R-Y03 wording into the library), claim number repeat under the claim identity rule.
- **Two-part approval:** combining method per `decisions.md` section 7 (1-Nov: same claim number + admission + discharge + same Approved Amount + different UTR, listed for a person to confirm first, never automatic); parts stay as rows and are linked to one claim, never deleted; each part's payment stays its own payment with its own UTR. Claim-level checks (balance, settled equal to approved, TDS) and their issues and confirmations attach to the combined claim; payment checks stay on each part.
- **"Value is correct":** a person (decision list) or staff (Question Sheet, Stage 4) confirms a Warning once; stored in `issue_confirmations` (claim, rule, field, value fingerprint, who, when, reason). The fingerprint is made from the **cleaned** values of only the fields that rule reads, so a format fix (spaces, date format) never clears a confirmation. The Warning stays cleared until the value changes; never asked again. Errors cannot be confirmed away.
- **Issue reason:** every issue shows the rule's message with the values involved (amounts and dates only, never names); the claims page shows it.
- Clean status per claim and per hospital: zero Errors and zero Warnings (confirmed Warnings count as cleared).
- Tests: confirmation survives a rerun, is lost when the value changes; Error not confirmable; two-part cases; same UTR across claims.
- Done when: tests pass; migration applied after OK.

**2c – DONE 1-Nov-2026; migration `20261101120000_claim_checks_two_part.sql` written and tested locally (`bash scripts/db-test-local.sh`: all migrations replay on a fresh database, all pgTAP tests pass), waiting for Anoop's OK before live.** Full evidence: `claude/reports/2026-11-01-close-2c.md`.

**2d – Rule Library page** (2 prompts; 1 migration)
- Improve the existing `/rules` page: list with filters (scheme, severity, status, hits in last run); three-part form; Edit makes a new version (history kept); Delete = Inactive.
- **Test before save:** the draft runs as a "rule test" job in the worker (never inside the page request, which would time out at 130 hospitals) on the stored claims of the chosen scope (read only) and shows how many claims it hits per hospital and 5 example row references (tab + row, no patient names). The result appears on the page when the job is done. Save is possible only after the test.
- **Conflict check on save:** same scope + same field with an opposite condition or a different number (for example two TDS rates for the same insurer) → shown; save needs a reason.
- **Upload:** CSV / Excel with the rule template → preview with errors per row → "Save N rules" (pattern of the hospital upload, `rule_upload_batches` for the one audit entry and undo).
- **Plain-words box:** AI fills the form from an English sentence (no data sent), the user checks, tests and saves. AI never saves.
- Rights: view / action ticks of the Rule Library page (decisions section 3); every change in the change log.
- Function `save_rule_version` (one call: version + conflict result + audit).
- Playwright check of form, test, upload preview.
- Done when: a rule can be added, tested, edited, made Inactive and uploaded from the page; conflict shown; tests and Playwright pass; migration applied after OK.

**2d – DONE 1-Nov-2026, 1 prompt; migration `20261101130000_rule_library_page.sql` written and tested locally (`bash scripts/db-test-local.sh`: all migrations replay on a fresh database, all pgTAP tests pass, including new test 17), waiting for Anoop's OK before live.** Full evidence: `claude/reports/2026-11-01-close-2d.md`.

**2e – Rule trial and check sets** (2 prompts; 1 migration)
- **Rule trial:** Run now with "trial" for one hospital runs every rule on its full data without creating questions, and stores a summary in `rule_trials`: per rule Errors and Warnings, claims hit, 5 example rows; total claims, clean claims. Trial page per hospital; Owner approves once ("Trial approved", who / when). Stage 4 sends a hospital's first questions only when its trial is approved (flag checked there).
- **Check sets:** Anoop picks 5 claims per pilot that he knows are correct (search by claim number, one click each; the picker shows Settled claims first, as they no longer change) → stored in `check_set_claims` with their key values at that time. After any mapping, rule or dictionary change the next run re-checks them: pass = zero Errors / Warnings and the same key values; fail = alert on the trial page with the rule or value that changed; a value that changed for a real reason (for example a new payment) is shown with one "accept new values" click per claim.
- Tests: trial writes no questions; summary counts; check set pass / fail.
- Done when: trial and check sets work on the fixtures; migration applied after OK.

**2e – DONE 1-Nov-2026, 2 commits; migration `20261101140000_rule_trials_check_sets.sql` written and tested locally (`bash scripts/db-test-local.sh`: all migrations replay on a fresh database, all pgTAP tests pass, including new test 18), waiting for Anoop's OK before live.** Full evidence: `claude/reports/2026-11-01-close-2e.md`.

**2f – Pilot trial on live and Stage 2 close** (2 prompts; no migration expected)
- Before: Anoop / Ali decide the headers still open (HMS MAIL SENT DATE, MAIL SUBJECT; TDS in Badagara and Tree G; the value-shape items from the 1b-ii fixtures) and confirm the pilot words and names (2b). **Done — decisions.md section 5.**
- Full run on the 3 pilots (claims written to Supabase for the first time). **Done 1-Nov-2026 — claims_staging: Badagara 495, Tree G 12, HMS 361 rows.**
- Trial summary per pilot; Anoop picks the check sets and approves each summary (or asks for rule changes → fixed in the same prompt or the reserve). **Open — `rule_trials` and `check_set_claims` are still 0 rows live, checked 1-Nov-2026.**
- Dictionary confirmations (2b/2c). **Open — 250 SUGGESTED, 36 CONFIRMED, checked 1-Nov-2026.**
- Stage close: `code-reviewer` on the whole Stage 2 diff, Must findings fixed, all checks, status table, push by Anoop.
- Done when: the stage done-criteria above are met.

**Design review (design-reviewer agent, 31-Oct):** "Change before build" – all applied above. Must: status words pre-filled across hospitals; default for names with no similar spelling (needs question 4); most specific rule wins; dictionary unique key with `nulls not distinct`. Should: dictionary entries retired not overwritten; two-part issues on the combined claim; fingerprint of cleaned values; rule test as a worker job; seed approver + batch; check set from Settled claims + accept new values; one words-and-names list across hospitals. Could: write only changed issues; hide old developer columns. Budget holds at 14; reserve goes to 2a first.

**Questions for Anoop (31-Oct):** 1 rule conditions = simple conditions + fixed calculated-check kinds — answered yes, built in 2a; 2 two-part approval combining method — answered 1-Nov, `decisions.md` section 7; 3 fresh initial rule list instead of the old 53 seed — answered yes, built in 2a; 4 default for names with no similar spelling — answered yes, built in 2b; 5 check-set pass rule — built in 2e exactly as spelled out above (zero Errors/Warnings and every key value unchanged); flag to Anoop if he wants it different.

## Stage 3 – Hosted worker

- Choose the host after 1e (compare pay-per-run container and GitHub Actions); Anoop approves the cost first.
- Daily 6:00 AM run; Run now (one sheet, one hospital, all) runs without anyone starting a program.
- Automatic retry for technical failures (max 3); alerts for the rest; retries never duplicate anything.
- Run status: last success, failed sheets, retry state, late-run alert.
- Change detection switched on only if the 1e test passed; otherwise full read.
- Least-privilege database role for the worker; secrets in the host's secret store; rotate the service account key after go-live.
- Done when: the 6 AM run works for 3 days in a row without anyone touching it; a forced failure retries and alerts correctly.

## Stage 4 – Question Sheets

- Robot creates one Question Sheet per hospital in the Shared Drive; tabs HOW TO ANSWER, SETUP QUESTIONS, ROW FIXES, HISTORY; Scheme column; row references; dropdown answers.
- Status line after every run. Before clean once: all questions; after: max 25 new a day; errors first; never repeated; auto-close when the source is fixed.
- Done when: questions reach the 3 pilot Question Sheets, answers come back on the next run, the status line updates, the 25-a-day cap works.

## Stage 5 – Data & Reports

- Claims (filters, claim detail with history and source-row link), Payments (UTR), Payment follow-up list, Download report (Excel/CSV, all filters), reconciliation, "changed since download" mark.
- Done when: a complete, correct monthly report for each pilot downloads; totals reconcile with the source sheets.

## Stage 6 – 4-menu layout, Home, light theme

- Home, Hospitals (with profile tabs), Data & Reports, Settings; top bar with quick search and scheme selector; "Needs your decision" list; Month Close checklist; light theme; old and duplicate screens removed.
- Done when: every old page's function is reachable in the new layout and nothing is lost.

## Stage 7+ – Later, as needed

Hospital scorecard; saved report presets; Insights (Owner); Owner cost panel in Audit & Runs; dictionary and scheme edit screens; scheme-level Run now; KASP/MEDISEP build-out; TMS historical import; commission and invoices (Owner only); standard Google Sheet template per scheme; rule export for Oksy Reports and the staff guide.

## Pilot finish line

For the 3 pilot hospitals: the daily run and Run now work without anyone starting a program; questions reach the Question Sheets and answers come back; the portal shows live status; and a complete, correct monthly report can be downloaded before the 10th. More hospitals are added only after this.
