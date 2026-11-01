# Report – 1-Nov-2026

**Decision needed / blocked on Anoop:** Sub-stage 2f, prompt 1 of 2 (pilot trial on live and Stage 2 close).

## What this prompt did
- Recorded your 1-Nov decisions in `claude/decisions.md` section 5 (one commit): HMS "MAIL SENT DATE" and "MAIL SUBJECT" → Ignore; Badagara/Tree G plain "TDS" → `tds` (percent, confirmed); HMS plain "TDS" → `tds_amount_stated` (rupee amount) — this corrects the earlier same-day note that wrongly said HMS's was also a percentage.
- Corrected `claude/column-dictionary.md`'s `tds` and `tds_amount_stated` entries to match (one commit).
- Checked the live Supabase project (read-only): all five Stage 2 migrations, including `20261101140000_rule_trials_check_sets.sql`, are applied — `rule_trials` and `check_set_claims` exist. `header_decisions` already shows HMS's MAIL SENT DATE/MAIL SUBJECT as Ignore (done), but HMS's "TDS" row still points at `tds` (not yet corrected to `tds_amount_stated`) — Badagara and Tree G's are already correct.
- `claims_staging` has 0 rows live — the pilot trial run (claims written to Supabase for the first time) has not happened yet.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (394 tests), `pnpm build` all pass. `scripts/check-setup.sh`: all PASS. No code or migration was needed for this prompt — 2f's own line in `claude/stage-plan.md` says "no migration expected," and the engine from 2a–2e is already built.
- Updated `handoff.md`, `CLAUDE.md`'s banner, `claude/stage-plan.md`'s status line and `claude/my-tasks.md`'s "Do now" list for the above (one commit).

## Why this prompt stops here
2f's done-criteria ("the trial summary is approved by Anoop for all 3 pilots; the check sets pass") and the full run itself need you, not Claude:
- The full run writes real claims to Supabase for the first time — reading the live hospital sheets and running the worker is the kind of production action this project's own rules keep as your call, same as every migration has needed your OK even inside an approved stage.
- Picking the check sets ("5 claims you know are correct") needs your knowledge of the data — Claude never guesses a claim is correct.
- Approving each hospital's trial summary is explicitly your sign-off in the stage plan.

## Anoop must do now
(Full detail and exact click steps: `claude/my-tasks.md`, "Do now" items 1–2.)

1. **Fix HMS's "TDS" header in Column Mappings** — Column Mappings page → Hospital = HMS → tick "Show decided headers too" → "TDS" row → change dropdown from "TDS %" to "TDS Amount" → click "Update".
2. **Run the pilot trial on live:**
   a. Claims page → "Run now" for each of the 3 pilot sheets (`HOSPPVTP0001|PRIVATE`, `HOSPPVTP0002|PRIVATE`, `HOSPPVTP0003|PRIVATE`) — make sure `pnpm worker` is running to pick the jobs up.
   b. Each hospital's Trial page (`/hospitals/[code]/trial`): review the per-rule summary, pick up to 5 check-set claims, click "Trial approved" (or tell Claude what looks wrong instead).
   c. Dictionary page: once the run creates suggested entries for Insurer, TPA, Doctor name and Department, confirm each one.
3. Everything else already in `claude/my-tasks.md` (GitHub secret, `git push origin main`, KASP/MEDISEP sheets, `ANTHROPIC_API_KEY`) is unchanged.

## Commits (branch `stage-2-rule-library`, not pushed)
- `bc15f42` docs: pilot header decisions (1-Nov)
- `462ba7e` docs: correct HMS plain TDS mapping in column-dictionary.md
- `d244bdd` docs: 2f prompt 1 status — 2e migration live, pilot trial next

## Checks
`pnpm typecheck`, `pnpm lint`, `pnpm test` (394 tests), `pnpm build` all pass. `scripts/check-setup.sh`: all PASS. No `bash scripts/db-test-local.sh` needed (no migration this prompt).

## Next
Once you've done the 3 steps above, tell Claude — prompt 2 of `/build-substage 2f` checks the results, fixes any rule issue you flag, and does Stage 2 close (`code-reviewer` on the whole stage diff, status table, then you push). Tell the Claude chat "report ready".
