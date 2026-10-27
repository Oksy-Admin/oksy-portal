# handoff.md – Oksy Data Cleanse portal

Last updated: 27-Oct-2026 (Stage 0, 1, 2 done; Stage 3 is current)

## 1. Read these first, in this order
1. This file
2. claude/requirements_v2.md (wins over v1 where they differ)
3. claude/requirements_v1.md (background, clean-data columns, AI rules)

If a file is missing, stop and report it. Do not guess its content.

## 2. What we are building
Web portal that reads Google Sheets of insurance claims from private hospitals in Kerala, cleans them, raises questions to hospital staff, and lets Oksy download a clean combined claim report.
- Phase 1 scope: Private Health Insurance only. KASP and MEDISEP come later.
- Portal READS hospital sheets only. It never writes to them.
- Clean data lives in Supabase (Postgres), not in Google Sheets.

## 3. Users and roles
- Owner: Anoop Das (anoop@oksy.in). Full access. Owner-only areas later (commission).
- Admin: Muhammed Ali (admin@oksy.in). Approves users, sets their access.
- User: sees and does only what Admin ticked. No Settings.
- Google sign-in. New sign-ins see nothing until approved.

## 4. Pages (7)
Dashboard, Hospitals, Questions, Clean Data, Rule Library, Audit & Runs, Settings > Users and Access. Each has a "Run now" button in the top bar.

## 5. Key decisions (do not change without asking Anoop)
- Hospital ID format: HOSPPVTP#### (can be edited later; portal keeps an internal permanent key).
- Sheets: one row per hospital + scheme. No tab names in the hospital list. Portal discovers month tabs itself; helper tabs (e.g. "TPA LIST") are ignored.
- Runs: 6:00 AM daily, 6:00 PM check, plus Run now (all / one hospital / one sheet). One run per sheet at a time. Read-only on hospital sheets.
- Questions: first cleaning = all questions, no limit. After a hospital is clean once (no Error, no Warning), max 25 new questions per day; rest queued. Never send the same question twice.
- Clean = no Error and no Warning. Warnings are not ignored.
- Money: Bill = Approved + Co-pay + Deduction. TDS normal rate 10% of Approved. Settled equal to Approved = Error. Balance = Approved - Total TDS - Total Settled. Portal never derives TDS from Approved minus Paid; it asks the hospital.
- Repeat treatment (same patient, same IP, different claim no.) is NOT an error. Duplicate warning only when claim number repeats or same patient + same admission date.
- Rules are never hard-coded. All rules are entered in Rule Library. Delete = Inactive.
- Dates: dd-mmm-yyyy. Amounts: Indian digit grouping (1,20,000). Exact amounts in reports.
- AI never guesses missing UTR, dates or amounts; never changes bill/approved/settled amounts.
- Commission and invoices are postponed (Owner-only, later).
- The portal never sends messages to hospitals. Staff copy reminders and send them.

## 6. Pilot hospitals (Private Health Insurance)
| ID | Hospital | Sheet ID |
|---|---|---|
| HOSPPVTP0001 | The Badagara Sahakarana Asupathri Ltd, Vadakara | 1-_vGLhW2hptEPDAVBnjN5tgZjJLHFWDq3d3zZobM-5g |
| HOSPPVTP0002 | Tree G Eye Care Hospital, Manjeri | 1LvE15UQa1QjUPcT76ymrpBslvvEs-baHAEE33GEv-dI |
| HOSPPVTP0003 | HMS: Hearts Malabar Clinical Solutions Hospital, Kottakkal | 1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ |

Robot account already has access to these sheets.
Sample sheets use one company template; month tabs like OCT 2026, SEP 2026.
Known typical problems: year typos, mixed / and - in dates, text in date columns, #VALUE! in LOS / settlement delay / TDS, phone number in policy column, many spellings of insurer/TPA, empty rows with only serial numbers.

## 7. Build stages
0. Align Supabase, GitHub, Vercel with the local folder. Fix current load errors: Hospitals "Cannot load"; Rule Library "missing column". — DONE (Anoop confirmed 27-Oct-2026)
1. Google sign-in, Owner/Admin/User, approval, access ticks, change log. — DONE (Anoop confirmed 27-Oct-2026; change log deferred to Stage 6)
2. Hospitals: profile, editable ID and names, bulk upload, robot access check. Load 3 pilots. — DONE (Anoop approved 27-Oct-2026; checks open, see section 8)
3. Sheet reading: tab discovery, column mapping (confirm once), non-data rows, Run now. — CURRENT (Stage 3)
4. Rule Library + cleaning engine (Error/Warning, "value is correct", initial rules).
5. Question Sheets (robot creates in Shared Drive), Questions page, 25/day policy.
6. Dashboard with live status.
7. Clean Data + report download (Excel/CSV).
8. Audit & Runs, reconciliation, 6 AM / 6 PM schedules.

Phase 1 done when the 3 pilots clean daily and on Run now, questions reach Question Sheets and answers come back, Dashboard is live, and a full correct monthly report can be downloaded before the 10th.

## 8. Current stage: STAGE 3 (only this now)
Stage 0, Stage 1 and Stage 2 are approved by Anoop (27-Oct-2026). Stage 2 evidence: commits d8220d0 to 2e50c61, Stage 2 report, migrations 20261027000022 to 000025 recorded on live.

Stage 2 checks still open (report them in stage3_report.md, do them first):
a. Bulk upload preview: playbook says "preview before save". Confirm it works; if not, report it.
b. Robot access check: confirm it reports each sheet's result, not just that it was triggered.
c. Tests for Owner, Admin, User with ticks, User without ticks, unapproved sign-in (addendum 27-Oct-2026). Confirm they exist and pass.
d. `hospital_aliases` table: recommended yes in the playbook. Ask Anoop before building it.
e. Stage 1 change log: confirm it exists (deferred to Stage 6 per section 7).

Stage 3 tasks (playbook "Stage 3 – Reading sheets"):
1. Tab discovery: month tabs found; helper tabs (for example "TPA LIST") ignored.
2. Column mapping with AI, confirmed once per hospital and scheme. AI never guesses a missing UTR, date or amount.
3. Non-data row detection: serial-only rows skipped.
4. Run now at three levels: all hospitals, one hospital, one sheet. Only one run per sheet at a time.
5. Run now is open to every approved user, whatever ticks they have (addendum 27-Oct-2026).

Done when: the three pilots' month tabs are found; mapping is confirmed once; serial-only rows are skipped; each Run now level works; only one run per sheet at a time.

Output: write stage3_report.md in the project folder (what changed and why; files changed; decisions still needed; done-criteria check result). Then update section 7, section 8, CLAUDE.md, and section 9.

Do NOT:
- Write to any hospital Google Sheet. The portal only reads them.
- Commit API keys, service account JSON, or .env values.
- Apply any schema change to live before Anoop's OK on the SQL.
- Start Stage 4 before Anoop approves the Stage 3 report.

## 9. Decisions confirmed by Anoop (27-Oct-2026, do not ask again)
1. Pilot count: 3 hospitals (HOSPPVTP0001, 0002, 0003). Confirmed.
2. "Clean once" = the hospital's sheets have no Error and no Warning in a full cleaning pass. Then the portal shows the message "Congratulations, your Google Sheet is cleaned and up to date" (shown in the portal and Question Sheet; the portal still does not send messages to hospitals, per section 5). Before that: all issues go to the Question Sheet, no daily limit. After that: only issues from new entries go to the Question Sheet, max 25 per day, rest queued.
3. Claude API: can be bought at any time when needed. Not a blocker for Stage 2. Monthly spending limit to be set at purchase.
4. Robot account: service account.
5. Owner screen: not separate. Admin access is set inside Settings > Users and Access (already designed). Do not build a separate Owner screen.
6. Old data copy: not decided in these notes; keep as open.
7. Reports: download only. No ready files per hospital. Clean rows are added to the database on every run; reports are generated from the database when downloaded.

## 9a. Still open
- Item 6 (old data copy into new template) and RLS policy for hospital_id_history, report_downloads, rule_upload_batches (section 8c).

## 9b. Decisions recorded 27-Oct-2026 (Stage 2 close)
- Hospitals page access: Anoop approved changing the /hospitals gate to the `hospitals_view` tick (Antigravity report, decision 1).
- Run now permission (`request_sheet_run`): Anoop said YES (27-Oct-2026). Run now is open to everyone who can see the page (requirements v2 section 4). Migration supabase/migrations/20261027000025_run_now_open_to_viewers.sql APPLIED to live 27-Oct-2026 (verified: new gate, ADMIN/APPROVER check removed, authenticated can execute, anon cannot).
- Claude API key: Anoop bought API credit ($20) and saved the key in the env file. The key is not in chat and not in git. Monthly spending limit: not yet set (handoff open item 3).

## 10. Working rules
- One tool works on one stage at a time. Do not edit the same file in two tools at once.
- Small commits, one purpose each, with a clear message.
- Before any Supabase schema change: take a backup and write the SQL in a migration file.
- Report back in short: done / blocked / decision needed.
