---
name: close-substage
description: Close a sub-stage - run all checks, update stage-plan status, current-stage lines, decisions, commit, and report to Anoop. Use as /close-substage 1b.
---

# Close a sub-stage

1. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. All must pass. Check the done-criteria in `claude/stage-plan.md`.
2. In `claude/stage-plan.md`: mark the sub-stage DONE with date and evidence (commits, test count, numbers).
3. Update the "Current stage" line in `CLAUDE.md`, `AGENTS.md` and `handoff.md` (same wording in all three).
4. New decision from Anoop? Add it to `claude/decisions.md` with the date; move a replaced one to section 15 "Superseded".
5. Commit: `docs: close Stage <id>`. Never push.
6. If this was the last sub-stage of the stage: tell Anoop to push (exact Terminal steps) and list the docs to mirror to the Claude Project.
7. Report in Malayalam, max ~10 lines: done / blocked / decision needed; commits (one line each); migrations waiting for OK; next sub-stage. Then `/clear` is safe.
