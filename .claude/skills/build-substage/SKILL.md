---
name: build-substage
description: Build one approved sub-stage end to end in a single prompt (build, tests until green, commits, close). Use as /build-substage 1b after the stage plan is approved.
---

# Build one sub-stage in one prompt

Goal: finish the whole sub-stage without asking Anoop anything, unless a hard rule needs him.

1. Read `claude/my-tasks.md` first. If an item under "Before each stage/sub-stage starts" is open for this sub-stage, STOP and tell Anoop; do not start. Otherwise read the sub-stage in `claude/stage-plan.md` and the decisions it relies on (use the `decisions.md` section index). Nothing else unless needed.
2. **Scope-lock: restate the sub-stage's "Done when" line from `claude/stage-plan.md` before building anything.** That line is the scope. If the prompt or a finding asks for something outside it, stop and ask Anoop instead of building it.
3. Make a short task list. Build in small commits, one purpose each (`git add` + `git commit`; never push). A one-line fix is a one-line edit — no reformatting of code the fix didn't touch. **File-scope guard, before every commit:** `git status --short` the staged files and compare them against the files the plan named for this sub-stage; a file not named there stops the commit (fix the plan reference or ask Anoop) instead of being committed anyway — this is the scope-lock in practice.
4. Write tests with the code. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and fix until all pass. Do not stop at the first error; keep fixing.
5. UI changes: check with Playwright (dev-only). If Playwright is not installed yet, add it once as a dev dependency of `apps/web` (`pnpm --filter @oksy/web add -D @playwright/test`) in its own commit.
6. Use the read-only Supabase MCP to check live tables and counts yourself; never ask Anoop for what you can read. Use Context7 for current library docs (Next.js, Supabase, Google APIs) before guessing an API.
7. Tests that depend on pilot sheet layouts use the golden fixtures in `packages/rules/test/fixtures/pilots/` (headers and value shapes only, no patient data).
8. Schema change: write the migration in `supabase/migrations/`, test it locally (`bash scripts/db-test-local.sh` if Docker runs), do NOT apply to live. Collect the SQL summary for Anoop's OK.
9. Run `pnpm build`. Then follow the `close-substage` skill.
10. If blocked (missing decision, live migration needed, access problem), finish everything else first, then report the block in one line.
