# Report — 10-Nov-2026 night, amount rounding (2dp half-up) built

## Status: built, tested, committed locally (not pushed). No live write, no migration.

## What was asked
Round every money amount read from a sheet to 2dp, half-up, at the parse boundary — the option Anoop approved 10-Nov-2026, replacing the earlier "Option 2" tolerance idea from the Badagara diagnosis (see git history of this file for that report). No tolerance in reconcile; exact-equality `SETTLED_EQUALS_PAYMENTS` stays as it is.

## What was built
1. **`packages/rules/src/normalise.ts`** — `parseAmountCell` now rounds any value with more than 2 decimal places to 2dp with `Decimal` (`ROUND_HALF_UP`), never JS float math, for both numeric and text cells. A new `roundedFrom` field on the result is set only when the rounding moved the value by 0.0001 or more; pure float noise below that is rounded silently.
2. **`packages/rules/src/clean.ts`** — the `amount()` helper logs a change (`field`, `oldValue: roundedFrom`, `newValue`, `ruleId: "M-AMOUNT-ROUND-2DP"`, `tier: "B"`) whenever `roundedFrom` is set, and keeps the original in `extra["<field> (as entered)"]` — same pattern as `M-TDS-AMOUNT-ROUND`, so it shows in the run summary. `M-TDS-AMOUNT-ROUND` itself is unchanged.
3. **`packages/worker/src/reconcile.ts`** — `looseAmount` and the numeric-cell path both round the source side to 2dp (half-up) the same way, so source and cleaned compare like with like. The exact-equality `SETTLED_EQUALS_PAYMENTS` check (line ~101) is untouched.

## Tests added
- `packages/rules/test/normalise.test.ts`: `12000.104→12000.10`, `12000.106→12000.11`, `0.005→0.01`, `-12000.104→-12000.10` (all tagged `roundedFrom`); `12000.100005→12000.10` and `21833.100000000002→21833.10` stay silent (no `roundedFrom`); a text cell rounds the same way as a numeric one; empty/null stay null.
- `packages/rules/test/clean.test.ts`: `cleanRow` tags a rounded bill amount with `M-AMOUNT-ROUND-2DP` and keeps the original; an already-2dp amount is untouched with no change logged.
- `packages/worker/test/reconcile.test.ts` (new file): the exact Badagara case — claim `CIR/2027/181321/1066065`, `SEP 2026` row 92, a numeric cell `21833.100000000002` against a cleaned `21833.10` — now reconciles `PASS`; a second test checks a real mismatch still `FAIL`s.

All green: `pnpm typecheck`, `pnpm lint`, `pnpm test` (260 + 75 + 40 + 47 tests), `pnpm build`.

## Decision recorded
`claude/decisions.md` section 8: every sheet amount is rounded to 2dp half-up at read; a rounding of 0.0001 or more is logged as an auto-fix (`M-AMOUNT-ROUND-2DP`); AI still never guesses or otherwise changes a bill, approved or settled amount beyond this rounding.

## Committed, not pushed
Git identity `admin@oksy.in`, one commit on `main`, not pushed to `origin`.

## Worker restart
**Yes — the worker must be restarted** (or redeployed) before the next "Run now" for any pilot, so the running process picks up the new `parseAmountCell` / `reconcile.ts` code. Nothing else to do first; no migration, no live write happened.

## Next
Still waiting on Anoop for 2f's last two live steps (unchanged by this work): each pilot's Trial page approval and the Dictionary page confirmations — see `claude/my-tasks.md`.
