# Stage 3b report – Fields page

Date: 27-Oct-2026. Scope: field list in the database, Fields page, Column Mappings Ignore and "+ Create new field", new fields stored in extra_fields. Stage 3 was approved by Anoop on 27-Oct-2026 before this work. No Stage 4 work started. Status: **DONE – awaiting Anoop's approval.**

## 1. What changed and why
- **`mapping_fields` table** (decisions 27-Oct-2026, handoff 9e). The field list used to be fixed in code. It now lives in the database: key (internal, never changes), label, type (text / number / date / amount), aliases, status (ACTIVE / HIDDEN), is_core, sort_order (the fixed report order). Seeded with the 35 core fields from `packages/rules/src/fields.ts`; the live seed is identical to the code list (checksum compared), so mapping works exactly as before. Migration `20261027000028_mapping_fields.sql` was applied to live on 27-Oct-2026 after Anoop's OK (recorded as `20261027143126`). Backup / rollback: `supabase/.temp/backup_before_0028_20261027.sql`.
- **Fields page** (`/fields`, menu "Fields", Owner and Admin only). Lists every field with label, key, type, aliases, status and how many hospital columns use it. Add (label, type, aliases); edit (rename changes only the label, so mappings never break; type; aliases); hide / show; delete only an unused field ("In use, hide instead"). Changing the type of a field that columns use asks for confirmation first. Core fields cannot be deleted and their type cannot be changed (Anoop confirmed, 27-Oct-2026).
- **Column Mappings.** Reads the field list from `mapping_fields` and shows labels. Each dropdown: extra_fields (not decided yet), **Ignore (not needed)**, the active fields, and **"+ Create new field"** (small form: label, type, aliases; creates the field and maps that column to it). Hidden fields are not offered for new mappings; a row that already has one keeps it, marked "hidden". Ignored columns are never read and never appear in a report.
- **New fields store their data in `extra_fields`** under the field key. No new database column. The worker reads the field list and its aliases from the table on every run (hidden fields are never proposed; an alias claimed by two fields maps to neither).
- **Reports:** the helper `reportFields` / `reportRow` gives every ACTIVE field in the fixed order, blank where a hospital has no column. The report download itself is Stage 7.

## 2. Files changed
| File | Change |
|---|---|
| `supabase/migrations/20261027000028_mapping_fields.sql` (new) | Table, seed (35), RLS, field functions, approve check (applied to live) |
| `packages/rules/src/fields.ts` | Core field labels, types, aliases (seed and fallback); `FieldDef`; Ignore; alias cleaning; delete rule; report order |
| `packages/rules/src/mapping.ts` | Aliases from the field list; hidden fields skipped; fields added on the page map as custom keys |
| `packages/worker/src/discovery.ts`, `sheet-data.ts`, `sheet-run.ts`, `ai-mapping.ts` | Load `mapping_fields` per run; custom fields go to `extra_fields`; refresh and AI merge respect custom keys |
| `packages/worker/scripts/field-seed.ts` (new) | Prints the seed rows from the code list |
| `apps/web/app/(portal)/fields/page.tsx`, `fields-table.tsx`, `actions.ts` (new) | Fields page and its actions |
| `apps/web/lib/fields.ts` (new) | Loads the field list (code list until the table exists) |
| `apps/web/app/(portal)/mappings/page.tsx`, `mapping-table.tsx`, `actions.ts` | Field list from the table, labels, Ignore, "+ Create new field" |
| `apps/web/app/(portal)/sidebar.tsx`, `icons.tsx` | "Fields" menu item (Owner / Admin) |
| Tests: `packages/rules/test/field-list.test.ts`, `packages/worker/test/field-seed.test.ts` (new); `packages/rules/test/fields.test.ts`, `packages/worker/test/discovery.test.ts` (updated) | Fake data only |
| `scripts/db-tests/` (new) | Local test of the migration on a throwaway Postgres (29 checks) |
| `stage3_report.md` section 8, `handoff.md`, `CLAUDE.md`, `Claude outputs/oksy_decisions_addendum_27oct_fields.md` | Records |

## 3. Done-criteria check
| Criterion | Result |
|---|---|
| Fields page lists all fields; add / rename / change type / hide-show / delete exist | **Yes** |
| Core 35 fields cannot be deleted and cannot change type | **Yes** (page and database both refuse) |
| A field in use by a hospital column cannot be deleted ("In use, hide instead") | **Yes** (database checks column mappings and stored claims) |
| Column Mappings offers a field, Ignore, or "+ Create new field" | **Yes** |
| New fields store their data in extra_fields (no new database column) | **Yes** |
| Only Owner and Admin can open the Fields page | **Yes** (see note below) |

Build result (27-Oct-2026): `pnpm typecheck` pass, `pnpm lint` pass, `pnpm test` **200 passed** (rules 121, google 40, worker 27, web 12), `pnpm build` pass. Secret scan: no leaks.

**Known note:** the old roles APPROVER / HELPER would still pass the page's code check (`can(role, "helper_work")`, the same check that guards Column Mappings). No live user has those roles (moved to the new roles in Stage 1), and the database refuses their changes (`has_role('ADMIN')`). Left as is.

## 4. Not yet on live
- The Fields page code goes live when Anoop commits and pushes. The database part (migration 0028) is already live.
- Balance Status is not added yet (Anoop's step on the Fields page, then mapping a test column to it). After that: check 36 fields, the audit entry, and the mapping row.

## 5. Decisions still needed (Anoop)
1. **Room Category in the report.** Recorded so far (handoff 9e item 5): Room No and Room Category both stay as fields, and Anoop sets those columns to Ignore himself. Should Room Category appear in the report?
2. **17 PROPOSED columns on Badagara OCT 2026.** 28 of the 45 columns are APPROVED, 17 are PROPOSED, so the layout is half-confirmed and not used. Confirm the rest, or put the 28 back to PROPOSED? (ROOM CATEGORY there is approved as `room_no`.)
3. **Bulk upload preview:** build it, yes or no? (Missing, per the Stage 2 close-out.)
4. **Who may confirm mappings:** Owner and Admin only (today), or also a User with the Hospitals edit tick?
5. **`/hospitals` gate change.** Anoop approved changing the gate to the `hospitals_view` tick (handoff 9b), but it is not built yet: the page still opens only for Owner and Admin. Go ahead and build it?
6. **Vercel Git deployments:** on or off? (`vercel.json` has them off; Stage 0 open question.)
7. **Stage 1 change log.** `audit_log` is written; the Change log page is deferred to Stage 6 (handoff 7). Keep it in Stage 6?
