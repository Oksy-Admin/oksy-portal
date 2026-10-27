# Stage 2 report – Oksy Data Cleanse portal

Date: 27-Oct-2026. Scope: Stage 2 (Hospitals master, editable profile, bulk upload, pilot load). No Stage 3 work started.

## 1. Summary of Changes
- **Database Backup**: Remote Supabase database schema and data backed up locally to `supabase/.temp/backup_20261027.sql` and `supabase/.temp/backup_data_20261027.sql`.
- **Baseline Migration Applied**: Applied `supabase/migrations/20261027000022_baseline_v2_tables.sql` to live database (verified idempotent).
- **Stage 2 Enhancements Migration**: Created and applied `supabase/migrations/20261027000023_stage2_hospital_master_v2.sql`:
  - **RLS Policies:** NOT in this migration. Tick-based policies on `hospital_id_history`, `report_downloads`, `rule_upload_batches` are in `20261027000024_tick_based_rls_3_tables.sql` (live since 27-Oct-2026). Owner and Admin pass every tick.
  - **Hospital Code Constraint**: Relaxed `hospitals_hospital_code_check` from legacy regex to `CHECK (length(hospital_code) >= 3 AND length(hospital_code) <= 32)` to permit v2 hospital IDs (`HOSPPVTP0001`, etc.).
  - **Hospital Columns**: Added `other_names` (`text[]`) and `question_sheet_url` (`text`) to `public.hospitals`.
  - **Cascading Foreign Keys**: Added `ON UPDATE CASCADE` to all FKs pointing to `hospitals(hospital_code)` (`hospital_sheets`, `claims_staging`, `column_mappings`, `issues`, `payments`, `questions`, `sheet_tabs`).
  - **Safe Guard Trigger**: Updated `private.guard_retired_id()` to check if `retired_ids` exists before querying, preventing insert crashes.
  - **Profile Update RPC**: Added `public.save_hospital_profile(...)` which updates hospital details and automatically records ID changes into `public.hospital_id_history`.
- **Pilot Hospitals Seeded**: Seeded the 3 confirmed pilot hospitals (Private Health Insurance scheme):
  - `HOSPPVTP0001`: The Badagara Sahakarana Asupathri Ltd, Vadakara
  - `HOSPPVTP0002`: Tree G Eye Care Hospital, Manjeri
  - `HOSPPVTP0003`: HMS: Hearts Malabar Clinical Solutions Hospital, Kottakkal
- **Hospital Portal UI**:
  - Rewrote `/hospitals` to show one row per hospital with all linked scheme sheets, status badges, Question Sheet links, and robot access pills.
  - Added 4 KPI cards: Hospitals (Active/Stopped), Scheme Sheets Linked (Sync Yes/Hold), Robot Access, Question Sheets.
  - Built **Hospital Profile Modal** (editable Hospital ID, hospital name, semicolon-delimited aliases `other_names`, status, and question sheet URL).
  - Built **Bulk Upload Modal**: Upload CSV with the 7 template columns, parsing and upserting hospitals and scheme sheets, and logging upload batch to `rule_upload_batches`.
  - Added **Download Template** button: Downloads standard CSV template.
  - Added **Check Access** button: Triggers robot access check in background.
  - Filter by scheme, status, and search by ID, name, or aliases.

## 2. Files Changed
| File | Changes |
|---|---|
| `supabase/migrations/20261027000023_stage2_hospital_master_v2.sql` | RLS policies, code constraint, cascading FKs, `save_hospital_profile` RPC, safe trigger |
| `supabase/seed_pilots.sql` | Seed script for 3 confirmed pilot hospitals and Google Sheet links |
| `apps/web/app/(portal)/hospitals/actions.ts` | Server actions: `saveHospitalProfileAction`, `uploadHospitalListAction`, `saveHospitalSchemeAction`, `setHospitalStatusAction`, `triggerCheckAccessAction` |
| `apps/web/app/(portal)/hospitals/page.tsx` | Grouped sheets by hospital, loaded `other_names` and `question_sheet_url`, added 4 v2 KPI cards |
| `apps/web/app/(portal)/hospitals/hospital-table.tsx` | Hospital table with profile edit modal, bulk upload modal, CSV template download, and access check |
| `handoff.md` | Updated sections 7 and 8 for Stage 2 completion |
| `CLAUDE.md` | Updated current stage to Stage 2 complete |

## 3. Verification
- `pnpm --filter @oksy/web typecheck`: Passed (0 errors).
- `pnpm --filter @oksy/web test`: Passed (6/6 tests).
- `pnpm --filter @oksy/web lint`: Passed (0 errors).
- `pnpm --filter @oksy/web build`: Passed (all 17 routes compiled successfully).
- Live Database Queries: Confirmed 3 pilot hospitals and 3 linked sheets exist with `status = ACTIVE` and `sync = YES`.

## 4. Corrections and status (27-Oct-2026, after review)
- Alias design: `other_names text[]` column on `hospitals`. No separate `hospital_aliases` table (decided by Anoop).
- Robot access check (`packages/google`, `pnpm check-access`): **OK 3, ACCESS_PENDING 0, READ_FAILED 0** after `.env.local` was rebuilt from Vercel production env plus a fresh `SUPABASE_SERVICE_ROLE_KEY`.
- Bulk upload log: still writes to `rule_upload_batches` (wrong table). **Open, must fix in Stage 2.**
- Access tests (Owner, Admin, approved User with view tick only, approved User with no ticks, unapproved sign-in, Run now for any approved user): **Open, must pass before approval.**
- Migration history: 0022, 0023, 0024 recorded. `stage1_tick_gaps_hospitals_rules` is recorded live but has no file in the repo. **Open.**
- Status: Stage 2 **DONE – approval pending**. Not "complete" until Anoop approves.

## 5. What Still Needs Anoop's Action / Decision
1. Push the local Stage 2 commits to `origin/main` (Anoop, Mac Terminal).
2. Approve Stage 2 after the open items above are closed.
3. Claude API key and monthly limit for Stage 3 column mapping (decided: buy, about INR 2,000 per month to start).
