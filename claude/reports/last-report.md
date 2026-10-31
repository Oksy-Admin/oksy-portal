# Last report – 31-Oct-2026: 1c live (zero drift), 1d done

**Status: 1c is on live and live matches the migration files. 1d is built and tested. One decision needed: OK to apply the 1d migration.**

## 1c on live
- Backup first (`supabase/.temp/backup_before_1c_20261031.sql`), then applied as `20261031051558`.
- Drift check after: zero differences. Live and a fresh rebuild of the files have the same 767 schema names (fingerprint `43ee5f68…`), and no TRUNCATE / REFERENCES / TRIGGER rights are left.

## 1d done
- **Claim identity:** same claim = claim number + admission date + discharge date (per hospital + scheme).
- **Patient still in hospital:** when the discharge date is filled in later, it stays the same claim. The date change goes into the history; no new claim is made.
- **Same claim twice in one sheet:** an exact repeat is stored once and counted; different values are flagged and both rows kept.
- **Same patient, same admission date, two claim numbers:** a warning, except KASP Dialysis.
- **Same IP number with another claim number:** not an error.
- **Claim history:** every change carries its lane (AUTO, SHEET, AI_ACCEPTED, HUMAN); person changes must say why and who.
- **Record source** on every claim (Google Sheet / TMS import).
- **Scheme → Insurer → TPA list,** seeded with MEDISEP → Oriental Insurance → Vidal and FHPL. The dates are left empty because the decisions don't give them.
- **Checks:** typecheck, lint, build pass; 263 tests; 230 database checks.

## Unused tables (nothing removed; removal needs your OK)
- `report_downloads`, `rule_upload_batches`: empty, unused today, planned for Stage 5 and Stage 2. Keep.
- `district_heads`, `open_checks`: empty; only the hospital page reads them, and nothing writes them since the register import was retired. These are the candidates to remove, or to keep for a future register import.

## Found
- Live has **0 rules** in the Rule Library tables, while a migration file seeds 53. This is data, not structure. Stage 2 (Rule Library) will settle it.

## Commits
- `70c4e4e` 1c applied to live, zero drift
- `776c6cc` claim identity (rules code)
- `7f280d2` worker: same-claim checks, discharge date filled in later, AUTO lane
- `9f38cb5` 1d migration + database test 15 (not applied)
- `docs: close Stage 1d` (this close)

## Decision needed
**Apply `20261031130000_claim_identity_history_source.sql` to live? Recommended: yes.** I take a backup first, then run the drift check again.
- What changes on live: `change_log` gets the lane check plus reason and who; `claims_staging` gets `record_source`; a new table `scheme_insurers` with the 2 MEDISEP rows. No existing row changes (both tables are empty on live).
- Why before the end-of-stage push: the worker now writes the AUTO lane, which needs this migration.

## Next
1e (run time and API use per sheet; Drive modified-time test, with one browser edit by you on a test sheet).
