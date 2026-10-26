# handoff.md – Oksy Data Cleanse portal

Last updated: 27-Oct-2026 (handed over from Claude chat to Antigravity)

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
0. Align Supabase, GitHub, Vercel with the local folder. Fix current load errors: Hospitals "Cannot load"; Rule Library "missing column".  <-- CURRENT
1. Google sign-in, Owner/Admin/User, approval, access ticks, change log.
2. Hospitals: profile, editable ID and names, bulk upload, robot access check. Load 3 pilots.
3. Sheet reading: tab discovery, column mapping (confirm once), non-data rows, Run now.
4. Rule Library + cleaning engine (Error/Warning, "value is correct", initial rules).
5. Question Sheets (robot creates in Shared Drive), Questions page, 25/day policy.
6. Dashboard with live status.
7. Clean Data + report download (Excel/CSV).
8. Audit & Runs, reconciliation, 6 AM / 6 PM schedules.

Phase 1 done when the 3 pilots clean daily and on Run now, questions reach Question Sheets and answers come back, Dashboard is live, and a full correct monthly report can be downloaded before the 10th.

## 8. Current stage: STAGE 0 (only this now)
Tasks:
a. Check the local repo: git status, branch, last commits. Report it.
b. Check Supabase: list tables and columns. Compare with what the UI expects.
c. Find the cause of "Hospitals cannot load". Report the exact error and file.
d. Find the cause of "Rule Library missing column". Report the column name and where it is used.
e. Fix only what is needed for (c) and (d). Do not start new features.
f. List Column Mappings and Claims & Payments features from the old portal that must survive the merge into the 7-page design (requirements_v2 section 14).
g. Update CLAUDE.md to point to requirements_v2.md and this file. Do not paste secrets.

Output for Stage 0 (write to stage0_report.md in the project folder):
- What was broken and why
- Files changed
- What still needs Anoop's decision

Do NOT:
- Write to any hospital Google Sheet
- Commit API keys, service account JSON, or .env values
- Change the requirements or decisions above
- Start Stage 1 before Anoop approves the Stage 0 report

## 9. Open items (ask Anoop, do not decide yourself)
1. Pilot count: 3 hospitals (decided by Anoop on 27-Oct-2026, requirements v2 section 11). Pilots: HMS, Badagara, Tree G.
2. "Clean once" definition for the 25/day policy (assumption in v2 section 14).
3. Claude API key and monthly spending limit.
4. Robot account: Workspace seat or service account.
5. Owner screen for setting Admin access (not designed).
6. Old data copy into new template: yes or no.
7. Whether reports are download-only or also ready files per hospital.

## 10. Working rules
- One tool works on one stage at a time. Do not edit the same file in two tools at once.
- Small commits, one purpose each, with a clear message.
- Before any Supabase schema change: take a backup and write the SQL in a migration file.
- Report back in short: done / blocked / decision needed.
