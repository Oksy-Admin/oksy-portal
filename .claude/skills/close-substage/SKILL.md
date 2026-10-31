---
name: close-substage
description: Close a sub-stage - run all checks, update stage-plan status, current-stage lines, decisions, commit, and report to Anoop. Use as /close-substage 1b.
---

# Close a sub-stage

1. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. All must pass. Check the done-criteria in `claude/stage-plan.md`.
2. In `claude/stage-plan.md`: mark the sub-stage DONE with date, **one line only** (what + commit count + headline numbers). Write the full evidence (commit list, test counts, found/fixed notes) to a dated file in `claude/reports/` instead — never append the long form to `stage-plan.md`.
3. Update the "Current stage" line in `CLAUDE.md`, `AGENTS.md` and `handoff.md` (same wording in all three).
4. New decision from Anoop? Add it to `claude/decisions.md` section 14 with the date; a decision this replaces moves to `claude/archive/decisions-superseded.md`, not to a table inside `decisions.md`.
5. Commit: `docs: close Stage <id>`. Never push.
6. If this was the last sub-stage of the stage: run the `code-reviewer` agent on the stage's diff (from the commit before the stage's first sub-stage to HEAD); fix every "Must" finding in the same prompt (commit + checks again) and list the rest. Then tell Anoop to push (exact Terminal steps).
7. Build the **"Anoop must do now" block** that opens the report, from live, read-only checks:
   - Supabase MCP (read-only): headers still needing a mapping decision; any migration file in `supabase/migrations/` not yet applied to live.
   - Vercel MCP: get the latest production deployment's commit SHA and compare it with `git rev-parse main`. If they match, say so in one line. If they don't match, say so in **red-flag words** ("⚠ Vercel production is behind `main`") and give the exact fix: trigger the Deploy Hook (`curl -fsS -X POST "$VERCEL_DEPLOY_HOOK_URL"`, or push an empty commit to `main`) — never print the hook URL itself.
   - Open items in `claude/my-tasks.md` relevant to what just closed or to the next sub-stage.
8. Report in English, max ~10 lines after the "Anoop must do now" block (also written to `claude/reports/last-report.md`, overwritten): done / blocked / decision needed; commits (one line each); migrations waiting for OK; next sub-stage; tell Anoop to paste `claude/reports/last-report.md` into the Claude Project chat (Claude no longer mirrors files there itself). Then `/clear` is safe.
