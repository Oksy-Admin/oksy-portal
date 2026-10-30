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
| 1 | Foundations: file clean-up, new mapping model, open bugs, scheme-aware data and claim identity, measurements | **In progress – 1a DONE 30-Oct-2026; plan approved 31-Oct-2026; 1b-i DONE 31-Oct-2026 (migration on live); 1b-ii DONE 31-Oct-2026 (migration on live); next 1c** |
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
| 3 | 1c – open items (bulk upload preview, `/hospitals` tick gate, change-log check, RLS read side, Balance Status test) | 2 | RLS read policies for 3 tables |
| 4 | 1d – data foundations (scheme on every record, claim identity, claim history, record source, list of unused tables) | 3 | scheme columns; claim identity key; claim history table; record source |
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

**1c – Open items from Stage 0**
- Bulk upload preview before save.
- `/hospitals` page gate on the `hospitals_view` tick (check what migration `20261030074539` already covers).
- Change log: verify it records access, hospital, field and mapping changes.
- RLS read side for `hospital_id_history`, `report_downloads`, `rule_upload_batches`.
- `header_decisions` read policy: also allow the `hospitals_view` tick (today only `hospitals_add_edit`).
- Fix the migration chain so a fresh database replays it (`scripts/db-test-local.sh`, CI): stray lines in `20261027000023`; `has_tick` (`20261027063143`) is used before it is created (renamed on 30-Oct to the live version numbers); the `OWNER` role value. Live is not changed; only the files and their order.
- Balance Status mapping test (needs a safe source column; never BALANCE AMOUNT).
- **Schema drift (found 31-Oct while planning, read-only):** 11 tables created by repo migrations are not on live, although every migration is recorded as applied (missing since at least 27-Oct): `snapshots`, `record_keys`, `change_log` (written by the worker in WRITE runs), `district_heads`, `hospital_aliases`, `open_checks`, `retired_ids`, `staff_contacts` (read by `/hospitals/[code]`), `golden_tests` (a script), `discount`, `import_runs` (unused). Plan needed: one reconcile migration so live matches the repo (create the used ones), and the unused / superseded ones go on the 1d removal list.
- Already on live (verify + test only, no migration): RLS read policies of `hospital_id_history` (hospitals_view), `report_downloads` (clean_data_view), `rule_upload_batches` (rule_library_view).
- Done when: each item is built or verified, with evidence in the status table.

**1d – Data foundations**
- Scheme on every record; mapping key = hospital + scheme; scheme scope on rules; Scheme → Insurer → TPA list with valid-from / valid-to (space only; KASP/MEDISEP details later).
- Claim identity: same claim number + admission date + discharge date; duplicate / flag / two-part handling prepared for Stage 2.
- Change history for clean claims (never overwrite silently); audit records the lane and, for human decisions, the reason.
- Record source on every claim (Google Sheet / TMS import).
- List the old database tables that are no longer used; removing any of them needs Anoop's OK.
- Done when: migrations are reviewed by Anoop and applied; tests cover claim identity and history.

**1e – Measurements**
- Run time per sheet for the 3 pilots (needed for hosting cost).
- Drive modified-time test: does every cell edit change it?
- Done when: numbers and test result are written in the status table and shown to Anoop.

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
