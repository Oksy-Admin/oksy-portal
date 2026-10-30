---
name: build-substage
description: Build one approved sub-stage end to end in a single prompt (build, tests until green, commits, close). Use as /build-substage 1b after the stage plan is approved.
---

# Build one sub-stage in one prompt

Goal: finish the whole sub-stage without asking Anoop anything, unless a hard rule needs him.

1. Read the sub-stage in `claude/stage-plan.md` and the decisions it relies on. Nothing else unless needed.
2. Make a short task list. Build in small commits, one purpose each (`git add` + `git commit`; never push).
3. Write tests with the code. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and fix until all pass. Do not stop at the first error; keep fixing.
4. UI changes: check with Playwright (dev-only). If Playwright is not installed yet, add it once as a dev dependency of `apps/web` (`pnpm --filter @oksy/web add -D @playwright/test`) in its own commit.
5. Schema change: write the migration in `supabase/migrations/`, test it locally (`bash scripts/db-test-local.sh` if Docker runs), do NOT apply to live. Collect the SQL summary for Anoop's OK.
6. Run `pnpm build`. Then follow the `close-substage` skill.
7. If blocked (missing decision, live migration needed, access problem), finish everything else first, then report the block in one line.
