# Oksy Data Cleanse – Stage Plan

New plan agreed 30-Oct-2026 (replaces the old Stages 0–8 and the Stage Playbook).
Last updated: 30-Oct-2026 night. Decisions behind it: `claude/decisions.md`.

## How every stage runs

1. **Start:** read `handoff.md`, `claude/decisions.md`, `claude/requirements.md`. Do not ask anything already decided.
2. **Plan:** each stage is split into small sub-stages (1a, 1b…). Each sub-stage is approved by Anoop before the next starts.
3. **Build:** small commits, one purpose each. Claude makes the commits and tells Anoop what each contains; Anoop runs `git push`.
4. **Schema changes:** backup → migration file in `supabase/migrations/` → SQL shown to Anoop → apply to live only after his OK.
5. **Check:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, plus the done-criteria below.
6. **Close (same session):** update the status table below (DONE + date + evidence), the "Current stage" lines in `handoff.md`, `CLAUDE.md` and `AGENTS.md`, and add any new decision to `decisions.md`. No separate stage report file; the evidence goes in the status table and in the commit messages.
7. **Gate:** report to Anoop in short (done / blocked / decision needed). Next sub-stage only after his approval.

## Status at a glance

| Stage | Content | Status |
|---|---|---|
| 0 | Everything built up to 30-Oct-2026 (old Stages 0–3b) | DONE, closed 30-Oct-2026 |
| 1 | Foundations: file clean-up, new mapping model, open bugs, scheme-aware data and claim identity, measurements | **In progress – 1a** |
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

**1a – File clean-up** *(in progress)*
- New file set: `CLAUDE.md`, `AGENTS.md`, short `handoff.md`, `claude/requirements.md`, `claude/decisions.md`, `claude/stage-plan.md`, `claude/column-dictionary.md`, `claude/insurance-glossary.md`; `README.md` fixed. Same files mirrored to the Claude Project.
- After Anoop's review: delete old files (`docs/`, `Claude outputs/`, old stage reports, `claude/requirements_v1.md`, `claude/requirements_v2.md`) and the old Project docs.
- Done when: Anoop approves the new files, old files are deleted, Claude has made the commit and Anoop has pushed.

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
- Balance Status mapping test (needs a safe source column; never BALANCE AMOUNT).
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
