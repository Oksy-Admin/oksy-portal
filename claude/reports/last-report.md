# 2a done – Rule engine as data (31-Oct-2026)

**Status: done, all checks pass. Decision needed: OK the migration SQL before it goes to live.**
Branch: `stage-2-rule-library` (not merged to `main`, not pushed). Full evidence: `claude/stage-plan.md`, Stage 2 → 2a.

## What changed
- Every check the portal runs now comes from the Rule Library's data (a rule's condition, severity, scope, action and message), not from program code. A test fails the build if a business rule ID ever creeps back into the code.
- About 30 rules loaded (old rule numbers kept where the meaning is the same): the dates, amounts, status and UTR checks from the requirements. A few reading-only checks (unreadable cell, non-data row, date out of a plausible range, header changed) stay in code, since they are about reading the sheet, not a business condition — they are still listed with a title.
- Money rules rewritten to match decisions.md section 8: Deduction, Total Settled, Total TDS and Balance. **TDS is now only ever what the hospital wrote**, never worked out by the portal. The old "Discount 1 / Discount 2" model is gone.
- The hospital's own "Discount" column is now read and compared with the computed Deduction — before, it was collected but never checked against anything.
- The day-month swap (when a date's day and month could be swapped) now really swaps the date when that fixes a too-long stay, instead of only ever warning.

## Checks
`pnpm typecheck`, `pnpm lint`, `pnpm test` (273 tests), `pnpm build` all pass. The migration was tested on a throwaway local database (`bash scripts/db-test-local.sh`): every migration file replays cleanly and all 230+ database tests pass.

## Migration waiting for your OK

**File:** `supabase/migrations/20261031060500_rule_engine_data.sql`
**Backup:** will be taken before applying, as always.

**What it does:**
1. Adds 4 new columns to the claims table for the new money fields (Discount as entered, Balance, and two comparison-only numbers), and a few columns to the Rule Library's `rule_versions` table so a rule's condition can be stored as data.
2. Retires every rule that was active or proposed before today — except one (the "same patient, same admission date" check, which stays in code until a later sub-stage moves it into the library too). Nothing is deleted; retired rules keep their history.
3. Loads the ~30 new rules as data, recording you as the approver with a note "approved with the Stage 2 plan."

**Nothing is deleted. No existing hospital, claim or payment data is touched.** Only the rule list and a few new/relabelled claim columns change.

## What I deliberately left for later (not a problem now)
- "Settlement Delay" (a reporting figure) isn't built yet — no rule in this batch needs it; it belongs with Stage 5's reports.
- The "undo this batch of rules in one click" feature isn't built — reverting, if ever needed, is a two-line change by hand. The proper undo button is part of 2d (the Rule Library page itself).
- A couple of old, unused columns on the Rule Library table are left as they are; hiding them from the page is 2d's job.

## Next
If you OK the migration, I'll apply it to live (backup first), then move to 2b (the word and name lists — status words, insurers, TPAs, departments, doctors).

**Please reply:** "2a migration OK" (or tell me what to change).
