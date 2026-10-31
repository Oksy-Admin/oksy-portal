# Last report – 31-Oct-2026: Stage 1c done

**Status: 1c is built and tested. One decision needed: OK to apply the reconcile migration to live.**

## Done
- **Database history fixed:** the migration files now rebuild a fresh database. The full database test suite runs again (217 checks pass; it had been broken since 27-Oct). Live is unchanged by this.
- **Drift check:** `scripts/schema-drift.sh` compares a fresh rebuild with live (names only).
- **Reconcile migration written (not applied):** adds the 7 missing tables the code uses, with security rules for today's ticks; writes down 16 live-only columns; keeps raw sheet copies 12 months; lets the Hospitals view tick read header decisions; removes rights nobody needs; drops the retired tables and 3 dead functions.
- **Worker:** saves a raw sheet copy only when the sheet changed, and deletes copies older than 12 months (your decision).
- **Hospital list upload:** now shows every row and its problems first; Save stays off until the file is right.
- **Checked, already fine:** `/hospitals` gate, the 3 security rules already on live, the change log (access, hospital, field and mapping changes).
- **Checks:** typecheck, lint, build pass; 252 tests; 2 Playwright checks.

## Found and fixed on the way
- **Hospital list upload failed on live:** it wrote tables that logged-in users may not write. It now saves through the same function as "+ Add Hospital".
- **Hospital detail page refused every live hospital ID:** it only accepted the old `HOSP32P` format.
- **Correction:** the table I called `discount` is really `discount2_decisions`. It is retired as you approved.

## Notes
- Your `pnpm dev` (port 3000) stopped during my Playwright run. Start it again if you need it: Terminal, `cd ~/Projects/oksy-portal`, then `pnpm dev`.
- `next dev` created `apps/web/AGENTS.md` (Next.js's own notes for AI tools). I left it uncommitted; it comes back each time `next dev` runs.

## Commits
- `dd85d26` migration files rebuild a fresh database
- `0f5c736` database tests updated to Owner / Admin / User + ticks
- `aae8c3b` drift check script
- `403db78` reconcile migration (not applied)
- `a21e7b8` hospital detail page fixes
- `4514513` worker: snapshot only on change, 12-month delete
- `9ecc124` database test 14
- `dae372b`, `345320e` upload preview + Playwright check
- `2bbe443` Balance Status test
- `c085825` close 1c

## Decision needed
**Apply `20261031120000_reconcile_live_schema.sql` to live? Recommended: yes.** I take a backup first, then check read-only that live and the files match (zero drift).
- Why now: a real (write) sheet run fails on live until `snapshots`, `record_keys` and `change_log` exist.
- What changes on live: 7 new empty tables; their security rules; header decisions readable with the Hospitals view tick; TRUNCATE / REFERENCES / TRIGGER rights removed from the app roles; 3 unused functions dropped (`import_register`, `confirm_discount2_decision`, `guard_d2_status`). No existing row changes.

## Next
1d (claim identity, claim history, record source, Scheme → Insurer → TPA list).
