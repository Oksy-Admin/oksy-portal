# Report – 1-Nov-2026

**Done:** TDS RATE vs AMOUNT headers, final decision — built, tested, checked live (read-only). **Still blocked on Anoop:** sub-stage 2f, prompt 1 of 2 — not started prompt 2, as asked.

## Decision recorded (`claude/decisions.md` section 5, dated 1-Nov)
- RATE headers — "TDS", "TDS %", "TDS Percent", "TDS Percentage", "TDS Rate" — in every hospital including HMS, always map to `tds` (the rate). "TDS %" is no longer auto-Ignored.
- AMOUNT headers — "TDS Amount", "TDS Amt" — always map to `tds_amount_stated` (the rupee amount).
- Decimal rules (section 9): `tds` — at most 1 decimal, cut off, never rounded, trailing "%" stripped. `tds_amount_stated` only — rounded to the nearest whole rupee. Neither ever touches bill, approved, settled, co-pay or discount.

## Built
1. `packages/rules/src/decisions.ts`: removed the "TDS %" auto-Ignore and the values-based `looksLikeTdsPercent` guess (dead code retired); a number-type field's value-shape check now also accepts a trailing "%", so "10%" no longer stops reuse of the `tds` field.
2. `packages/rules/src/fields.ts`: the code-fallback `tds_amount_stated` entry is now label "TDS Amount", aliases "TDS Amount"/"TDS Amt" only (plain "TDS" removed).
3. `packages/rules/src/clean.ts`: `cleanTdsRate` now strips a trailing "%"; new `cleanTdsAmountStated` rounds to the nearest whole rupee. Both lane 1, audit-tagged (`M-TDS-RATE-FORMAT` / `M-TDS-AMOUNT-ROUND`), original value kept, never touch any other amount field.
4. Live check (Supabase MCP, read-only, changed nothing): every `header_decisions` row containing "TDS" for the 3 pilots already matches the rule — Badagara, Tree G and HMS's "TDS" → `tds`, their "TDS AMOUNT" → `tds_amount_stated`. **No conflicts, no live Column Mappings change needed.**
5. Migration `supabase/migrations/20261101150000_tds_rate_amount_headers.sql` written (two data-only `UPDATE`s on `mapping_fields.aliases`/`label`) — **not applied**. Docs (`decisions.md`, `column-dictionary.md` sections 1/2/3) and code committed separately.

## Anoop must do now
1. **OK and apply the migration** `20261101150000_tds_rate_amount_headers.sql` (backup first, same pattern as before). Full detail: `claude/my-tasks.md` item 1. Not urgent — the 3 pilots don't need it; it only matters for a future header spelled one of the new synonyms.
2. Everything already listed in `claude/my-tasks.md` items 2–5 (pilot trial on live for 2f, `git push origin main`, KASP/MEDISEP Monday, `ANTHROPIC_API_KEY`) is unchanged.
3. `scripts/check-setup.sh`: all PASS.

## Commits (branch `stage-2-rule-library`, not pushed)
- `bdad0e0` feat(rules): TDS rate vs amount headers, final; % strip, amount rounding
- `975c4f5` docs: TDS rate vs amount headers, final (1-Nov)
- `8fc4cc0` docs: add TDS header migration OK to my-tasks.md

## Checks
`pnpm typecheck`, `pnpm lint`, `pnpm test` (410 tests, up from 402), `pnpm build` all pass. `bash scripts/db-test-local.sh` not run — the migration is data-only and not applied.

## Next
2f prompt 2 (verify Anoop's live run + approvals, Stage 2 close) was **not** started, as asked. Tell Claude once the TDS migration is OK'd and the 2f steps in `claude/my-tasks.md` are done. Tell the Claude chat "report ready".
