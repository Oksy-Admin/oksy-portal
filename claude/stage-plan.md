# Oksy Data Cleanse – Stage Plan

New plan agreed 30-Oct-2026 (replaces the old Stages 0–8 and the Stage Playbook).
Last updated: 31-Oct-2026. Decisions behind it: `claude/decisions.md`.

## How every stage runs

1. **Start:** read `handoff.md`, `claude/decisions.md`, `claude/requirements.md`. Do not ask anything already decided.
2. **Plan (`/plan-stage N`):** each stage is split into small sub-stages (1a, 1b…). Anoop approves the whole stage plan once.
3. **Build (`/build-substage Nx`, one prompt per sub-stage):** small commits, one purpose each. Claude makes the commits and tells Anoop what each contains; Anoop runs `git push` once at the end of the stage.
4. **Schema changes:** backup → migration file in `supabase/migrations/` → SQL shown to Anoop → apply to live only after his OK.
5. **Check:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, plus the done-criteria below.
6. **Close (same session):** update the status table below (DONE + date + evidence), the "Current stage" lines in `handoff.md`, `CLAUDE.md` and `AGENTS.md`, and add any new decision to `decisions.md`. No separate stage report file; the evidence goes in the status table and in the commit messages.
7. **Gate:** after each sub-stage a short report (`/close-substage Nx`); the next sub-stage of an approved stage may start at once. The next **stage** starts only after Anoop approves.
8. **Prompt budget:** about 55 prompts from Stage 1b to the pilot finish line — setup 2, Stage 1: 12, Stage 2: 14, Stage 3: 8, Stage 4: 7, Stage 5: 6, Stage 6: 6.

## Status at a glance

| Stage | Content | Status |
|---|---|---|
| 0 | Everything built up to 30-Oct-2026 (old Stages 0–3b) | DONE, closed 30-Oct-2026 |
| 1 | Foundations: file clean-up, new mapping model, open bugs, scheme-aware data and claim identity, measurements | **In progress – 1a DONE 30-Oct-2026; plan approved 31-Oct-2026; 1b-i DONE 31-Oct-2026 (migration on live); 1b-ii DONE 31-Oct-2026 (migration on live); 1c DONE 31-Oct-2026 (migration on live, zero drift); 1d DONE 31-Oct-2026 (migration on live, zero drift); next 1e** |
| 2 | Rule Library, cleaning engine, rule trial on the 3 pilots | Not started |
| 3 | Hosted worker: 6 AM run, retry, run status, change detection | Not started |
| 4 | Question Sheets | Not started |
| 5 | Data & Reports: claims, payments, report download, reconciliation | Not started |
| 6 | 4-menu layout, Home page, light theme | Not started |
| 7+ | Later, as needed | – |

## Stage 0 – Built so far (DONE)

Sign-in, Owner/Admin/User roles with view and action ticks; Hospitals page with the 3 pilots loaded and robot access check; sheet reading (tab discovery, AI mapping suggestions from headers and cell shapes, non-data rows, Run now queue, dry runs only); Fields page (`mapping_fields`, 35 core fields, custom fields in `extra_fields`, Balance Status added). About 200 tests pass. Migrations up to `20261030074539` are applied to live.

Known gaps carried into Stage 1: Run now only queues a job (nothing runs until someone starts `pnpm worker`); every run reads every month tab in full; mapping approval is per tab layout (452 rows for 69 distinct headers); 7 headers approved inconsistently; 11 sidebar pages; about 33 database tables, some left from an older design.

## Stage 1 – Foundations

**1a – File clean-up** – **DONE 30-Oct-2026.** Evidence: commit `52cbf41` pushed by Anoop; old repo files and 11 old Project docs deleted; new Project instructions (v3) given to Anoop to paste.
- New file set: `CLAUDE.md`, `AGENTS.md`, short `handoff.md`, `claude/requirements.md`, `claude/decisions.md`, `claude/stage-plan.md`, `claude/column-dictionary.md`, `claude/insurance-glossary.md`; `README.md` fixed. Same files mirrored to the Claude Project.
- After Anoop's review: delete old files (`docs/`, `Claude outputs/`, old stage reports, `claude/requirements_v1.md`, `claude/requirements_v2.md`) and the old Project docs.
- Done when: Anoop approves the new files, old files are deleted, Claude has made the commit and Anoop has pushed.

**Stage 1 build order and prompt budget (31-Oct-2026, approved by Anoop 31-Oct-2026)** – 12 prompts in total.

| Order | Sub-stage | Prompts | Migrations expected (each shown to Anoop before live) |
|---|---|---|---|
| 1 | 1b-i – mapping model core: approval per hospital + scheme, reuse on exact header, value-shape check, consistency guard, auto-Ignore, the 7 header decisions, Ignore saved as decided – **DONE 31-Oct-2026, 1 prompt** | 3 | mapping approval keyed on hospital + scheme + normalised header; move today's 452 rows to it; UHID extra field; fix the 7 headers |
| 2 | 1b-ii – suggestions, "Confirm all", bulk confirm (max 50, undo as a group), approve speed, Playwright check, golden fixtures of the 3 pilot sheets (headers + value shapes, no patient data) – **DONE 31-Oct-2026, 1 prompt** | 2 | bulk-confirm batch table (for undo and the one audit entry) |
| 3 | 1c – open items (bulk upload preview, `/hospitals` tick gate, change-log check, RLS read side verify, Balance Status test) + schema drift reconcile + migration chain fix – **DONE 31-Oct-2026, 1 prompt** | 2 | reconcile live schema (7 missing tables the code uses; header_decisions read for hospitals_view) |
| 4 | 1d – data foundations (claim identity, claim history via change_log, record source, Scheme → Insurer → TPA list, unused-table list; scheme parts already done) – **DONE 31-Oct-2026, 1 prompt** | 2 | change_log actor/reason/decided_by, record_source, scheme_insurers |
| 5 | 1e – measurements (run time per sheet, Drive modified-time test) | 1 | none |
| – | Reserve for fixes | 1 | – |

**1b-i – DONE 31-Oct-2026; migration `20261030194846` applied to live 31-Oct after Anoop's OK (backup first; checked read-only after: 103 header decisions, 33 / 31 / 39, no TDS decision, all 452 rows have scheme and header key).** Evidence:
- Commits `25a773a` (decision core in `packages/rules/src/decisions.ts`), `ebcd6f3` (remarks "COLUMN: value | …", UHID / Follow Up Remarks aliases), `cec9c44` (migration `20261030194846_mapping_header_decisions.sql` + pgTAP test 12), `2b39b75` (worker reuses decisions), `f1828f7` (Column Mappings page: one row per header).
- Checks: typecheck, lint, build pass; 232 tests pass (rules 134, google 40, worker 35, web 23). pgTAP test 12 not run locally (no Docker); CI runs it.
- Live preview (read-only, 31-Oct): today's 452 rows become 111 header decisions (Badagara 34, Tree G 32, HMS 40 + auto-Ignored 3 each); only 2 headers left to decide (HMS: MAIL SENT DATE, MAIL SUBJECT).
- Fix 31-Oct (Anoop): a plain "TDS" in a hospital + scheme that also has "TDS AMOUNT" gets no migrated decision (old approvals disagreed); the value-based auto-Ignore or the decision list handles it. Section 5 is now `private.migrate_header_decisions()` (pgTAP test 12 covers it); also fixed a join error in it. New live preview: 103 header decisions (Badagara 33, Tree G 31, HMS 39 + auto-Ignored 3 each); TDS left to values in all 3; still 2 headers to decide (HMS: MAIL SENT DATE, MAIL SUBJECT).
- Choices made in the build: a blank header goes to extra columns, never to the list; a plain "TDS" column holding rates (with "%", or 30 or less next to TDS AMOUNT) is TDS % and auto-Ignored; two columns decided as one field in a tab go to the list; old approvals left as "extra_fields (not decided yet)" are not moved (none remained); "Keep in extra columns" is a decision.
- Playwright check: done in 1b-ii on a dev-only fixture preview (the live page needs a Google login).

**1b-ii – DONE 31-Oct-2026; migration `20261030200918_mapping_bulk_confirm.sql` applied to live 31-Oct after Anoop's OK (backup first; checked read-only after: both functions exist, `batch_id` and `withdrawn_at` added, 103 decisions still in force).** Evidence:
- Commits `0ad74fd` (migration + pgTAP test 13), `8c2eded` (worker skips withdrawn decisions), `2b4ebbb` (page: suggestions from other hospitals, Confirm all with the list first, Undo; one round trip less per save), `02fae59` + `036a406` (golden fixtures + `pilots.test.ts`), `48ac37b` (Confirm all on the fixtures), `4ad9bea` (Playwright), `acbcdb3` (Playwright check on `/dev/mappings`, dev only).
- Checks: typecheck, lint, build pass; 244 tests pass (rules 141, google 40, worker 36, web 27); Playwright 1 pass; pgTAP 12 (14) and 13 (17) pass on a fresh database with the migrations in their original order (scratch copy; the repo order is fixed in 1c).
- Golden fixtures (read-only, 31-Oct): Badagara 8 tabs / 37 headers, Tree G 2 / 35, HMS 6 / 45; tab names, headers and value-shape counts only. HMS as a new hospital: 42 headers to decide, 30 pre-filled from Badagara + Tree G and confirmed with one click, 12 left.
- Found by the fixtures (what the worker will put on the decision list after the next run): Badagara DISCOUNT has some text in PAID / PVT DAILYSIS / ULCC; Badagara "MEMBER NUMBER" was approved as Policy Holder Name (two columns as one field in PVT DAILYSIS); HMS DOD, HARDCOPY SENT Date and PAYMENT FOLLOW UP DATE hold plain numbers in CANCELLED / PAID / TILL AUG 2023; TDS waits for a decision in Badagara and Tree G (HMS PAID's TDS holds rates: auto-Ignored).
- Approve speed: one decision per header instead of per tab; the save makes one database call less. Measured with Playwright (no login, so refused): ~120–150 ms per round trip. A timed save on live needs a login (not done).
- Choices made in the build: bulk confirm takes only undecided headers; undo marks the decisions withdrawn (rows are never deleted) and leaves alone any header decided by hand since; the batch row is the one audit entry (and its undo one more); the header rows of a batch are not audited one by one.

**1b – Mapping model**
- Policy B + D: approval per hospital + scheme, reused across tabs on exact normalised header match.
- Value-shape check and consistency guard before reuse.
- Cross-hospital suggestions; "Confirm all" for a new hospital.
- Bulk confirm (Owner/Admin, exact matches, max 50, list shown first, one audit entry, undo as a group).
- Auto-Ignore: Length of Stay, Settlement Delay, Balance Amount, TDS %.
- Apply the 7 header decisions (`decisions.md` section 5), including the UHID extra field and the joined `remarks` field.
- Fix: Ignore choice not saved as decided; approve speed (about 10 seconds per field).
- Done when: each pilot hospital needs each distinct header decided once; the 7 headers are correct; Ignore survives a refresh; a bulk confirm can be undone; tests pass.

**Detailed plan for 1c, 1d, 1e (31-Oct-2026, drafted after 1b-ii; design review below).** Live facts checked read-only on 31-Oct: every repo migration is recorded as applied, but 11 tables are missing; `claims_staging` already has `scheme`; `rules` / `rule_versions` already have scheme fields; `claims_staging` is empty (0 rows), so key and column changes need no data move.

**1d – DONE 31-Oct-2026; migration `20261031054200_claim_identity_history_source.sql` applied to live 31-Oct after Anoop's OK (backup first). Drift check after: zero differences (790 names, fingerprint `2557c4048e98ad888bdc85a7c426d965`); 2 MEDISEP rows in `scheme_insurers`. Unused-table decision (`district_heads`, `open_checks`) left open until the Stage 1 close (Anoop, 31-Oct).** Evidence:
- Commits `776c6cc` (claim identity in `recordKeyFor` + `openKeyOf`), `7f280d2` (worker: `checkSameClaims`, claims keep their record when the discharge date comes, AUTO lane), `9f38cb5` (migration + pgTAP 15).
- Checks: typecheck, lint, build pass; 263 tests (rules 148, google 40, worker 44, web 31); pgTAP 230 checks pass on a fresh database.
- Built: key = hospital + scheme + claim no + admission date + discharge date ("-" while unknown; fallback patient + admission date). In one run: an exact repeat is stored once and counted; the same claim with different values is flagged R-Y03 and kept as `#2`; the same patient with the same admission date under two claim numbers is a warning (not for KASP Dialysis); the same IP number with another claim number is not an error. A claim stored without a discharge date keeps its `record_uid` when the date comes (key moved, old key kept in `record_keys`, date change in `change_log` as SHEET). Lanes in `change_log.actor`: AUTO / SHEET / AI_ACCEPTED / HUMAN; person lanes need reason + who. `claims_staging.record_source` (GOOGLE_SHEET / TMS_IMPORT). `scheme_insurers` seeded with MEDISEP → Oriental Insurance → Vidal, FHPL (dates left empty).
- Already done, verified on live: scheme on claims (`claims_staging.scheme`), mapping key hospital + scheme (1b), scheme / insurer / TPA on rules (`rules.scheme/insurer/tpa`, `rule_versions.scheme_filter/insurer_filter`).
- Unused-table list (live, read-only, 31-Oct; removal only with Anoop's OK): `report_downloads` and `rule_upload_batches` – 0 rows, no code or function uses them (planned for Stage 5 downloads and Stage 2 rule upload: keep); `district_heads`, `open_checks` – 0 rows, read by the hospital page only, nothing writes them since the register import was retired (candidates to remove, or keep for a future register import); every other table is used by code or a database function.
- Found: live has 0 rows in `rules` and `rule_versions`, while migration `20261026000010` seeds 53 rules (data drift, not schema). For Stage 2 (Rule Library) to settle.
- Choices made in the build: the same-patient warning reuses rule R-Y03 with its own wording (no new hard-coded rule; Stage 2 moves the checks into the Rule Library); KASP Dialysis is recognised by a scheme name containing "dialysis".

**1c – DONE 31-Oct-2026; migration `20261031051558_reconcile_live_schema.sql` applied to live 31-Oct after Anoop's OK (backup first). Drift check after: zero differences – live and a fresh replay of the files both have the same 767 schema names (fingerprint `43ee5f68e07f23c90a505ab06303b5ef`); no TRUNCATE / REFERENCES / TRIGGER rights left.** Evidence:
- Commits `dd85d26` (migration files replay on a fresh database; live unchanged), `0f5c736` (pgTAP 00–11 brought to the current access model), `aae8c3b` (drift check `scripts/schema-drift.sh` + `scripts/schema-names.sql`), `403db78` (reconcile migration), `a21e7b8` (hospital page: live IDs, view tick, `other_names`; pilot-answers-store script retired), `4514513` (worker: snapshot only on change, 12-month purge), `9ecc124` (pgTAP 14), `dae372b` + `345320e` (upload preview + Playwright), `2bbe443` (Balance Status test).
- Checks: typecheck, lint, build pass; 252 tests (rules 144, google 40, worker 37, web 31); Playwright 2 pass; pgTAP 217 checks pass on a fresh database (`bash scripts/db-test-local.sh`, full suite, first time since 27-Oct).
- Drift (read-only, 31-Oct): before the reconcile, live lacked 7 used tables + had 16 columns and 6 policies no file creates; the files had 4 retired tables. With the reconcile in the files, the only remaining differences are what it adds to live (7 tables, their policies, grants, triggers, `reconciliations.snapshot_id`, `purge_old_snapshots`) and the 3 dead functions it drops (`import_register`, `confirm_discount2_decision`, `guard_d2_status`).
- Found and fixed on the way: the hospital list upload wrote `hospital_sheets` and `audit_log` directly, which logged-in users may not do on live (uploads failed); it now saves through `save_hospital_scheme`. The hospital detail page refused every live ID (`HOSP32P` format only). The worker and logged-in users had TRUNCATE / REFERENCES / TRIGGER rights on several live tables (removed by the reconcile).
- Verified, no change needed: `/hospitals` gate (`hospitals-gate.test.ts` + pgTAP 07/14); RLS of `hospital_id_history`, `report_downloads`, `rule_upload_batches` (pgTAP 14); change log covers access, hospital, field and mapping changes (pgTAP 14).
- Choices made in the build: staff phones readable with the Hospitals edit tick only (personal data); raw sheet copies Owner / Admin only; the upload is checked in the browser first and again on the server; `district_heads`, `open_checks`, `retired_ids` are created but have no writer now (their register import is retired) – the hospital page shows them empty until a new import is planned.

**Design review (design-reviewer agent, 31-Oct):** order 1c → 1d → 1e confirmed; no hard-rule problem. Applied: Must 1 (claims still in hospital keep their record), Must 2 (merge same-key rows before saving), Must 3 (reconcile policies written for the current role model), Must 4 (lane tag in `change_log.actor`, no second column); Should 7 (section 7/9 tests), 8 (API calls and quota in 1e), 9 (browser edit in 1e); Could 10 (no `part_no` now). Open for Anoop: Should 5 (snapshot only when the sheet changed + a retention period), Could 11 (one migration for 1c + 1d). Not applied: Should 6 (drift check needs Docker) – Docker runs on this Mac through colima (used on 31-Oct), so the check runs locally and in CI.

**1c – Open items, schema drift, migration chain** (2 prompts; 1 migration)
- **Migration chain (files only, live unchanged):** fresh replay must work for `scripts/db-test-local.sh` and CI. Remove the 2 stray lines in `20261027000023`; make `20261027000024` not depend on `has_tick` before `20261027063143` (move its policy statements into a guarded block or a later file, never rename applied versions again); fix the `OWNER` enum order. Update the stale pgTAP tests 00–11 to the current role model (OWNER/ADMIN/USER + ticks). Done when: `bash scripts/db-test-local.sh` passes in full on a fresh database.
- **Reconcile migration `<live version>_reconcile_live_schema.sql`:** creates on live the tables the code uses: `snapshots`, `record_keys`, `change_log` (worker WRITE runs), `district_heads`, `open_checks`, `retired_ids`, `staff_contacts` (`/hospitals/[code]`). Table and column definitions as in the repo; RLS policies and grants written new for today's OWNER / ADMIN / USER + ticks model (`has_tick`), not copied from the old role-based migrations; `protect_table` on each. Not created: `hospital_aliases` (superseded by `other_names`), `golden_tests`, `discount2_decisions` (the plan first called it `discount`), `import_runs` (unused) → removal list in 1d; the code that still names them is changed (`/hospitals/[code]` stops reading `hospital_aliases`; `pilot-answers-store.ts` script retired or pointed elsewhere). Idempotent (`IF NOT EXISTS`). Backup first; Anoop's OK before live.
- **Drift check script `scripts/schema-drift.sh`:** replays the repo on a throwaway database and compares table / column / policy / function names with live (read-only, names only). Run before every migration from now on. Done when: zero differences after the reconcile migration.
- **RLS read side:** policies of `hospital_id_history`, `report_downloads`, `rule_upload_batches` already live → pgTAP tests only. `header_decisions` and `header_decision_batches` read policy also allows `hospitals_view` (small change inside the reconcile migration).
- **`/hospitals` gate:** page already checks `canViewHospitals`; add a test that a user without the tick gets "No access" and that RLS returns no rows.
- **Change log check:** audit_log already records `users_roles`, `user_access_ticks`, `hospitals`, `hospital_sheets`, `mapping_fields`, `column_mappings`, `header_decisions`, `sheet_tabs`, `jobs` (counts read 31-Oct). Add a pgTAP test per area (access, hospital, field, mapping) and list the gap, if any, in the status table.
- **Bulk upload preview:** `uploadHospitalListAction` writes at once today. Split into parse/validate (no write) → preview table with errors per row → "Save N rows" (decision section 4, 27-Oct). Tests: preview never writes; a file with errors cannot be saved until fixed.
- **Balance Status test:** mapping test for a "Balance Status" text column (never BALANCE AMOUNT, which is auto-Ignored).
- Done when: all items built or verified with evidence; full DB tests pass on a fresh database; drift check shows zero differences on live.

**1d – Data foundations** (2 prompts; 1 migration)
- **Already done (verify only):** scheme on claims (`claims_staging.scheme`), mapping key hospital + scheme (1b), scheme / insurer filters on rules (`rules.scheme`, `rule_versions.scheme_filter`).
- **Claim identity (decision section 7):** record key = hospital + scheme + claim number + admission date + discharge date (today: claim number only, or patient + DOA). Without a claim number the fallback stays patient + DOA, marked FALLBACK. Code: `recordKeyFor` in `packages/rules/src/clean.ts`.
  - **Still in hospital (no discharge date yet):** when claim number + admission date match a stored claim whose discharge date is blank, the same claim (`record_uid`) is kept and the new key is added to `record_keys` (several keys per claim already allowed); the filled-in date is logged as a value change, never a new claim.
  - **Same key twice in one run:** rows are merged before saving (the save uses ON CONFLICT record_key, which fails on a key twice in one batch). Same values = duplicate (one kept, count shown); different values = flag (decision section 7).
  - Two-part approvals: nothing built now (combining method is set in Stage 2; a column can be added then).
  - Tests: discharge date filled in later; two identical rows and two conflicting rows in one sheet; same IP number with another claim number is not an error; same patient + same admission date twice gives a warning; KASP Dialysis repeat sessions are not duplicates (decisions sections 7 and 9).
- **Claim history:** reuse `change_log` (created in 1c) instead of a new table: every change of a stored claim value is a row (old, new, field, run). Its `actor` column is the lane tag (decision section 9): AUTO (deterministic cleaning), SHEET (the hospital changed the value), AI_ACCEPTED (an AI suggestion a person accepted), HUMAN; today's 'ENGINE' becomes AUTO. Add `reason` (required for HUMAN and AI_ACCEPTED) and `decided_by` (who, for those two). The worker never updates a claim without writing its history (test).
- **Record source:** `claims_staging.record_source` text NOT NULL DEFAULT 'GOOGLE_SHEET' CHECK in ('GOOGLE_SHEET', 'TMS_IMPORT').
- **Scheme → Insurer → TPA list:** table `scheme_insurers` (scheme, insurer, tpa, valid_from, valid_to), read by everyone with a login, changed by Owner / Admin; seeded only with MEDISEP → Oriental Insurance → Vidal, FHPL (decision section 9); no page yet.
- **Unused tables:** list with row counts and code references (from the 1c drift check): `hospital_aliases`, `golden_tests`, `discount2_decisions` (the plan first called it `discount`), `import_runs`, plus any live table with 0 rows and no code reference. Removal only after Anoop's OK (separate migration).
- Migration `<live version>_claim_identity_history_source.sql`: `change_log` actor check + `reason` + `decided_by`, `claims_staging.record_source`, `scheme_insurers`. Backup first; Anoop's OK.
- Done when: migration applied after OK; tests cover claim identity (duplicate / flag / fallback) and history (no silent overwrite); unused-table list shown to Anoop.

**1e – Measurements** (1 prompt; no migration)
- **Run time per sheet:** one DRY_RUN per pilot (read-only: no claim write), 3 times each, from the Mac; record read / discover / clean / total ms from the existing step timing, plus Sheets API calls and cells read per sheet. Result: a table in the status section, and 130 sheets worked out against the Sheets per-minute quota and run minutes per day (hosting size).
- **Drive modified-time test:** on a test sheet the robot creates in the Question Sheets shared drive (never a hospital sheet): read `modifiedTime`, change one cell value, one formatting-only change, one formula recalculation; wait about 1 minute and read again after each. Plus one edit by Anoop in the browser on the same test sheet (exact steps given; API and browser edits may behave differently). Result: which edits change it. Decides whether Stage 3 may skip unchanged sheets.
- Done when: both results are in the status table and shown to Anoop.

## Stage 2 – Rule Library, cleaning engine, rule trial

- Three lanes (automatic / AI suggestion / human), each change tagged.
- Rule Library: add, upload, edit, Delete = Inactive, plain-words box, conflict check, test before save. Initial rules from `requirements.md` section 12.
- Money rules (`requirements.md` section 11); claim identity and two-part approval combining; status words; insurer/TPA/department/doctor lists confirmed once.
- Error / Warning with reason; "value is correct" recorded with who and when.
- **Rule trial:** for each pilot hospital, a per-rule summary for Anoop before any question goes out; check set of 5 known-correct claims re-checked after any mapping or rule change.
- Done when: no rule is hard-coded; every Error/Warning shows its reason; the trial summary is approved by Anoop for all 3 pilots; the check sets pass.

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
