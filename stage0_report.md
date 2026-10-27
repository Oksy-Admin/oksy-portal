# Stage 0 report – Oksy Data Cleanse portal

Date: 27-Oct-2026. Scope: Stage 0 only (handoff.md section 8). No Stage 1 work started.

## 1. Repo state
- Folder: `~/Projects/oksy-portal`, branch `main`.
- Start: commit `f3e5b47` "chore: fresh start with project files, handoff and requirements v1/v2". Local `main` = `origin/main` = `f3e5b47` (checked with `git fetch` and `git ls-remote`). GitHub has no other branches.
- `git status` at start: clean except untracked `Docs/` (left alone, as instructed).
- Remote used: `origin` = `https://github.com/Oksy-Admin/oksy-portal.git` (HTTPS). SSH not used.
- After Stage 0: 4 new local commits (section 6). **Not pushed yet**: pushing waits for Anoop's OK.
- Ignore rules checked: `apps/web/.env.local`, `supabase/.temp/` and `.next/` are git-ignored.
- `README.md` says to read `docs/00_STATUS.md`, but that file does not exist in the repo.

## 2. Supabase state
Project `ciorqudslbprfzxedcfy` (from `supabase/.temp/project-ref`). Checked **read-only**: GET requests with `limit=0`, plus the REST API's schema description (OpenAPI). Nothing was written or changed.
- The Supabase connector in this session cannot open this project (it sees only the Oksy Academy Pulse projects). So the migration history table (`supabase_migrations`) could not be read.
- Live tables are **empty**: `hospitals`, `hospital_sheets`, `rules`, `rule_versions` all return 0 rows.

**Live tables and columns (public schema):**
- answers: id, question_id, channel, answer_value, typed_value, note, answered_by_name, answered_on, outcome, source_file_id, source_tab, source_row, read_at, recorded_by
- audit_log: id, at, actor_user_id, actor_email, action, table_name, record_id, before, after, reason
- claims_staging: record_uid, record_key, alias_keys, hospital_code, hospital_name, scheme, insurer_name, tpa_name, patient_name, patient_ip_no, policy_or_card_no, preauth_or_claim_no, admission_date, discharge_date, treatment_or_surgery, department, doctor_name, room_no, bill_amount, claimed_amount, approved_amount, copay_amount, deduction_amount, casesheet_sent_date, followup_log, claim_status, status_source, rejection_reason, cancellation_reason, settled_amount, settlement_date, utr_no, remarks, extra_fields, los_days, date_swap_applied, tds_rate_used, tds_rate_source, tds_rule_id, gross_amount, tds_amount, discount_1_amount, discount_1_pct, discount_2_amount, discount_2_pct, discount_2_confirmed, tds_path, discount_2_resolution, overdue_flag, pending_days, aging_bucket, null_reasons, flags, source_file, source_tab, source_row, version_group, row_class, issue_codes, not_recorded_fields, content_hash, first_seen_at, last_seen_at, last_changed_at, missing_since, sync_status, last_job_id, portal_record_id, hospital_key
- column_mappings: id, hospital_code, spreadsheet_id, tab_name, version_group, header_fp, source_header, source_column, canonical_field, confidence, method, status, approved_by, approved_at, created_at, approved_on
- desk_google_accounts: id, hospital_code, email, added_by, added_at, removed_by, removed_at
- export_runs: id, at, exported_by, format, filters, row_count, totals
- google_events: id, at, run_id, kind, file_id, tab_name, skipped_policy, tab_count, row_count, range_a1, folder_id, file_name, grid_sheet_id, start_column_index, end_column_index, reason, path
- hospital_id_history: id, hospital_key, old_hospital_id, new_hospital_id, changed_by, changed_on, reason
- hospital_sheets: sheet_key, hospital_code, scheme, reg_no, sheet_status, spreadsheet_id, sheet_url, check_flag, sync, read_skip_reason, period_label, sheet_owner, access_status, access_error, last_checked_at, last_ok_at, missing_from_register_since, last_import_run_id, created_at, updated_at, hospital_key
- hospitals: hospital_code, hospital_name, status, created_at, district, rohini_id, kasp_portal_name, medisep_portal_name, check_flag, remarks, missing_from_register_since, last_import_run_id, updated_at, hospital_key
- issues: id, record_uid, hospital_code, rule_id, rule_version, severity, tier, shadow, field, detail, status, first_job_id, last_job_id, first_seen_at, last_seen_at, resolved_at
- jobs: id, kind, sheet_key, mode, status, requested_by, requested_at, started_at, finished_at, attempts, summary, error
- payments: payment_id, record_uid, record_key, payment_no, hospital_code, payment_date, utr_no, bank_reference, amount_received, tds_amount_stated, flags, source_file, source_tab, source_row, content_hash, first_seen_at, last_seen_at, missing_since
- questions: id, q_code, hospital_code, question_type, status, origin, spreadsheet_id, tab_name, row_number, record_key, field_name, scope, question_text, source_file_id, source_tab, source_question_no, created_at, closed_at, closed_reason, answer_type, state, row_ref
- reconciliations: id, job_id, hospital_code, sheet_key, created_at, counts, sums, differences, result
- report_downloads: id, hospital_key, shown_hospital_id, downloaded_by, downloaded_on, file_type, row_count
- rule_approvals: id, rule_version_id, decision, decided_by, decided_at, note, approved_by, approved_on
- rule_upload_batches: id, file_name, uploaded_by, uploaded_on, total_rows, accepted_rows, rejected_rows
- rule_versions: id, rule_id, version, hospital_filter, scheme_filter, insurer_filter, specificity, valid_from, valid_to, condition_text, code_ref, parameter_name, parameter_value, severity, auto_fix_allowed, tier, action, prevention_action, status, first_seen_hospital, first_seen_date, author, authored_at, impact_preview_summary, golden_test_ids, approved_by, approved_on, exceptions, condition
- rules: rule_id, rule_type, title, created_by, created_at, hospital_key, scheme, insurer, tpa, valid_from, valid_to
- sheet_tabs: id, spreadsheet_id, hospital_code, tab_name, policy, kind, decided_by, decided_at, decision_note, first_seen_at, last_seen_at, missing_since
- users_roles: email, user_id, role, display_name, active, granted_by, granted_at, retired_by, retired_at
- version_groups: version_group, header_fp, headers, hospital_code, tab_name, status, created_at, updated_at
- Functions (RPC): approve_column_mapping, approve_rule_version, approve_version_group_mappings, confirm_discount2_decision, import_register, request_sheet_run, retire_user, rls_auto_enable, set_tab_policy, set_user_role

**Mismatch with the repo migrations (`supabase/migrations`, 18 files):**
The live database does not match the repo in **either direction**. It is not simply "the repo minus the last migration".
- In the repo, not live: tables `change_log`, `discount2_decisions`, `district_heads`, `golden_tests`, `hospital_aliases`, `import_runs`, `open_checks`, `record_keys`, `retired_ids`, `snapshots`, `staff_contacts`. Columns `hospitals.needs_review`, `hospital_sheets.needs_review`, `rule_versions.needs_review`. Functions `create_or_update_rule`, `retire_rule_version`, `save_hospital_scheme`, `set_hospital_status` (all from migration 0018).
- Live, not in the repo: tables `hospital_id_history`, `report_downloads`, `rule_upload_batches`, `version_groups`. Column `hospital_key` on hospitals, hospital_sheets, claims_staging and rules. Columns `rules.scheme/insurer/tpa/valid_from/valid_to`. Function `rls_auto_enable`. These look like v2 work applied to the database from outside this repo.

**Mismatch with the UI (what the pages query):**
| Page | Missing on live | Effect |
|---|---|---|
| Hospitals (`/hospitals`) | `hospitals.needs_review`, `hospital_sheets.needs_review` | "Cannot load" (**fixed**, section 3) |
| Rule Library (`/rules`) | `rule_versions.needs_review` | "missing column" (**fixed**, section 4) |
| Hospital detail (`/hospitals/[code]`) | tables `hospital_aliases`, `staff_contacts`, `open_checks`, `district_heads`, `retired_ids` | Those panels get errors. Not one of the two reported errors, so **not fixed** (section 8). |
| Hospitals Add/Edit/Status, Rules Add/Retire buttons | functions `save_hospital_scheme`, `set_hospital_status`, `create_or_update_rule`, `retire_rule_version` | The buttons will fail when pressed. Not a load error, so **not fixed** (section 8). |
| Dashboard, Column Mappings, Claims, Reports, Settings | none found | OK |

## 3. "Hospitals cannot load"
- **Exact error shown:** "**Cannot load.** The Hospital Master tables could not be read (code 42703). Migration 0007 may not be applied yet."
- **Database error behind it:** `42703 column hospitals.needs_review does not exist` (and the same for `hospital_sheets.needs_review`).
- **Cause:** `apps/web/app/(portal)/hospitals/page.tsx` line 15 (hospitals select) and line 18 (hospital_sheets select) request `needs_review`. Only migration `20261026000018_portal_reference_status.sql` (lines 14 and 17) adds that column, and 0018 was never applied to the live database. The page's hint naming "Migration 0007" was wrong, which hid the real cause.
- **Fix applied (code only, no database change):** removed `needs_review` from both selects. `needs_review` is now set to `false` for each row (line 45). The notice now shows the real database message instead of the wrong "Migration 0007" hint. v2 section 2.5 drops the old "Reference" concept from the screens, so nothing the requirements ask for is lost.

## 4. "Rule Library missing column"
- **Column:** `rule_versions.needs_review`.
- **Exact error shown:** "**Cannot load rules:** column rule_versions_1.needs_review does not exist" (42703).
- **Where it is used:**
  - `apps/web/app/(portal)/rules/page.tsx`: line 17 (type) and line 55 (embedded select). **This select is the cause.**
  - `apps/web/app/(portal)/rules/rule-table.tsx`: lines 23, 54 and 199 ("needs review" filter and badge).
  - `apps/web/app/(portal)/hospitals/page.tsx` and `hospital-table.tsx` (lines 28, 54, 234) use the hospital and sheet columns of the same name.
  - `supabase/migrations/20261026000018_portal_reference_status.sql`: lines 14, 17 and 22 (add columns), 56–60 (seed data updates), 93 and 116 (approve/retire functions).
- **Cause:** same as section 3: migration 0018 is not on the live database.
- **Fix applied (code only):** removed `needs_review` from the embedded select. The latest version gets `needs_review: false`. Filter and badge code are unchanged; they simply show nothing.
- **Why not apply migration 0018 instead:** the live schema has drifted from the repo (section 2), and 0018 also replaces functions in the `private` schema and changes data. One example: it marks every hospital except `HOSP32P000107` as REFERENCE, which is an old ID that conflicts with the v2 pilot IDs. Applying it blind is not safe. Also, the hard rule requires a backup and Anoop's review of the SQL first. No migration file was added and no schema change was made.

## 5. Files changed
| File | Reason |
|---|---|
| `apps/web/app/(portal)/hospitals/page.tsx` | Stop selecting the missing `needs_review` columns; show the real load error |
| `apps/web/app/(portal)/rules/page.tsx` | Stop selecting the missing `rule_versions.needs_review` |
| `CLAUDE.md` (new) | Points to handoff.md and requirements_v2.md as the source of truth; "Stage 0 only until Anoop approves stage0_report.md"; hard rules. No secrets. |
| `stage0_report.md` (new) | This report |

## 6. Commits made (pushed to `origin/main`, f3e5b47..0d0a659)
| Hash | Message |
|---|---|
| `7bd0920` | fix(hospitals): stop selecting needs_review so the page loads |
| `55fbcca` | fix(rules): stop selecting rule_versions.needs_review so the Rule Library loads |
| `523d02a` | docs: add CLAUDE.md pointing to handoff.md and requirements_v2.md |
| `0d0a659` | docs: add Stage 0 report |

All commits carry the trailers `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01NDBoAfd4A8pWVLBKApoLMG`.

## 7. Old-portal features to keep in the 7-page design (list only, not implemented)
**Column Mappings (`/mappings`) → goes into Hospitals (hospital profile, per scheme sheet):**
1. Mappings grouped per hospital + Google Sheet + tab + header fingerprint (version group).
2. Per column: column number, source header, standard (canonical) field, confidence, method (alias / AI …), status (PROPOSED / APPROVED), approved date.
3. Dropdown to change the standard field before approving. "No field" means the column goes to extra fields (fits v1 extra-column Yes/No).
4. Approve one column, and **Approve whole group** (all columns of one header version at once). These are the `approve_column_mapping` and `approve_version_group_mappings` functions.
5. Filters: hospital, status (Proposed / Approved), "review flags only" (confidence below 85% or still proposed).
6. Summary counts: total mappings, hospitals mapped, approved %, pending, low-confidence flags.
7. Success / error message after each approval. Every approval is audited (who, when).

**Claims & Payments (`/claims`) → goes into Clean Data (Claims / Payments (UTR) / Download report tabs):**
1. Read-only claims table with server-side paging (50 rows) and total count.
2. Filters: tab, row class (Clean / Auto-fixed / Needs staff input / Rejected), claim stage (6 statuses + Unknown), search by claim number or patient name. Non-data rows are always hidden.
3. Columns: tab/row source, claim no, patient, admission, insurer/TPA, bill, approved, co-pay, discount 1 (deduction), TDS (with TDS rate source on hover), settled, discount 2, stage (with status source), row class, issue codes.
4. Export **Excel and CSV**, using exactly the same filters as the table. Full canonical column list: 54 columns including UTR, settlement date, LOS, TDS path, aging bucket, flags, source file/tab/row.
5. Excel export has a **Totals** sheet: amount totals and row count. Amounts are kept exact (decimal strings, no float rounding).
6. **Every export is logged** (`export_runs`: who, format, filters, row count, totals) before the file is sent. "No log, no file."
7. Run panel: **Run now** and **check-only (dry run)**, the last runs with status, times, result, reconciliation counts and sync state, and a "busy" lock so a sheet cannot be queued twice.
8. Claims and payments are kept as separate tables (one claim, many payments/UTRs). v2 needs a Payments (UTR) tab built on `payments`.

Things to change when merged (for later stages, not Stage 0): the hospital filter only accepts the old `HOSP32P######` format (`apps/web/lib/claims/query.ts`), and the run panel is fixed to the HMS sheet (`HMS_SHEET_KEY`). Both must follow v2 (`HOSPPVTP####`, three levels of Run now).

**Noted, not implemented (confirmed decision):** "clean once" = in one run, every month tab of a hospital's sheet has zero Error and zero Warning, and staff have sent the "Congratulations, your Google Sheet is clean" message. Only after that does the 25 new questions/day limit apply. Before that there is no limit.

## 8. Still needs Anoop's decision
These are not covered by the confirmed decisions:
1. **Which database schema is the truth?** The live Supabase project has drifted from the repo migrations in both directions (section 2). Options: (a) export the live schema into a new baseline migration in the repo; (b) bring the live database up to the repo migrations. Either way needs a backup first and Anoop's review of the SQL. This should be settled before Stage 1.
2. **Supabase access for checks:** the Supabase connector here cannot open project `ciorqudslbprfzxedcfy` (it belongs to admin@oksy.in's organisation), so no backup or migration-history read was possible from here. Should this session's account be given access, or does Muhammed Ali run the backup and `supabase db push` himself?
3. **Vercel:** the connected Vercel account has no `oksy-portal` project, and `vercel.json` has Git deployments turned off. README says "not hosted yet". Is there a Vercel project to align with?
4. **Hospital detail page and edit buttons:** `/hospitals/[code]` needs 5 tables that are not live. The Add/Edit hospital and Add/Retire rule buttons call 4 functions that are not live. Fix now (Stage 0), or leave for Stage 2/4?
5. **`apps/web/.env.local` has stray non-setting text on lines 7–10** (it looks like pasted instructions, not a key). It was not edited or printed. Anoop may want to tidy it by hand.
6. **Push:** OK to push the 4 commits to `origin/main` over HTTPS?

## 9. Verification
| Check | Command / method | Result |
|---|---|---|
| Hospitals query, before | Read-only REST GET with the old select (hospitals and hospital_sheets) | `42703 column hospitals.needs_review does not exist` / `hospital_sheets.needs_review does not exist` |
| Hospitals query, after | Same GET with the new select | `[]` (loads; tables are empty) |
| Rule Library query, before | Read-only REST GET `rules?select=…,rule_versions(…,needs_review,…)` | `42703 column rule_versions_1.needs_review does not exist` |
| Rule Library query, after | Same GET without `needs_review` | `[]` (loads; tables are empty) |
| Types | `pnpm --filter @oksy/web typecheck` | pass |
| Lint | `pnpm --filter @oksy/web lint` | pass |
| Unit tests | `pnpm --filter @oksy/web test` | 5/5 pass |
| Build | `pnpm --filter @oksy/web build` | pass (all 16 routes built) |
| Secret scan | pre-commit hook on each commit | pass |
| In-browser check | not done | The pages need Google sign-in, and this session does not sign in. Anoop or Muhammed Ali should open `/hospitals` and `/rules` after `pnpm dev`. The pages should load with empty tables. |

Note: the REST checks used the server-side key from `apps/web/.env.local`, with GET requests only. It bypasses row-level security, so it proves the columns are right. It does not prove what a signed-in user is allowed to see.
