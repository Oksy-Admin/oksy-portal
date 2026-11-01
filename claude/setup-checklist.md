# claude/setup-checklist.md – repo/process setup list

One row per setup used to run this project with Claude Code. "Active" means `scripts/check-setup.sh` (greps the repo, no Claude, no network) can confirm it right now — run it any time with `bash scripts/check-setup.sh`. A setup with no row in that script is tracked here but never called "Active" on the strength of this list alone (`decisions.md` section 14, 31-Oct).

| # | Setup | Where it lives | Proof | Rating | Usage cost | Frequency |
|---|---|---|---|---|---|---|
| 1 | Stage-level approval | `claude/decisions.md` §14; `claude/stage-plan.md` | Anoop approves a whole stage once; sub-stages then run without re-asking | Must keep | Low | Once per stage |
| 2 | Fewer, larger prompts | `claude/decisions.md` §14 | ~55-prompt budget table in `stage-plan.md`; one prompt = one sub-stage | Must keep | Low | Every prompt |
| 3 | Skills: `/plan-stage`, `/build-substage`, `/close-substage` | `.claude/skills/*/SKILL.md` | `scripts/check-setup.sh` row 4–5; files exist and are followed each stage/sub-stage | Must keep | Low | Every stage/sub-stage |
| 4 | Stop hook (typecheck/lint/test on uncommitted code) | `.claude/settings.json` `hooks.Stop` → `scripts/claude-stop-check.sh` | `scripts/check-setup.sh` row 2 | Must keep | Medium (reruns 3 checks) | Every turn with uncommitted code changes |
| 5 | Permissions allow/deny, incl. `rm -rf` block | `.claude/settings.json` `permissions` | `scripts/check-setup.sh` row 1 | Must keep | Low | Every tool call |
| 6 | Supabase MCP (read-only) | `.mcp.json` (`read_only=true` in the URL) | `scripts/check-setup.sh` row 6; live checks in every `/build-substage` and `/close-substage` | Must keep | Low–Medium (per call) | Every sub-stage |
| 7 | Context7 (library docs) | `.mcp.json` | `scripts/check-setup.sh` row 6; used this session to confirm agent/skill `model` support | Worthful | Low | As needed |
| 8 | Vercel MCP | Account-level connection (not `.mcp.json` — see decision 31-Oct) | Used this session (`get_project`, `list_deployments`) to find the `deploymentEnabled` bug | Worthful | Low–Medium (per call) | At stage close, or when debugging a deploy |
| 9 | Playwright UI checks | `apps/web` dev dependency; run from `/build-substage` step 5 | Test runs recorded in `stage-plan.md` evidence (e.g. 1b-ii, 1c) | Worthful | Medium (spins up a browser) | UI changes only |
| 10 | Golden fixtures (pilot headers/shapes, no patient data) | `packages/rules/test/fixtures/pilots/` | Used by `pilots.test.ts` and others; referenced in `/build-substage` step 7 | Must keep | Low (fixed data) | Every test run touching mapping/rules |
| 11 | Stage branch + Vercel preview | `git` (`stage-2-rule-library` etc.); `apps/web/vercel.json` | `decisions.md` §14 "Stage work on its own branch" | Must keep | Low | Once per stage |
| 12 | Model routing (agents opus, build/close sonnet) | `.claude/agents/{design,code}-reviewer.md` (`model: opus`) | `decisions.md` §14, 31-Oct; confirmed via Context7 that skills have no `model` field | Worthful | — (model choice, not a call) | Every review / every session |
| 13 | Prompting rules (ask-once, no recap, short replies) | `claude/decisions.md` §14 | Followed in every report in `claude/reports/` | Must keep | Low | Every prompt |
| 14 | Lean context: session-start files under 25 KB | `handoff.md`, `claude/my-tasks.md`, `CLAUDE.md` | `scripts/check-setup.sh` row 10 | Must keep | Low | Every session start |
| 15 | `design-reviewer` agent | `.claude/agents/design-reviewer.md` | `scripts/check-setup.sh` row 3; mandatory step in `/plan-stage` | Must keep | Medium (full subagent run) | Once per stage plan |
| 16 | `code-reviewer` agent | `.claude/agents/code-reviewer.md` | `scripts/check-setup.sh` row 3; mandatory step in `/close-substage` (last sub-stage) | Must keep | Medium (full subagent run) | Once per stage close |
| 17 | Scope-lock + file-scope guard + minimal-diff | `.claude/skills/build-substage/SKILL.md` steps 2–3 | `scripts/check-setup.sh` row 4 | Must keep | Low | Every sub-stage |
| 18 | Destructive-command block (`git push`, `git reset --hard`, `rm -rf`, `supabase db push`) | `.claude/settings.json` `permissions.deny` | `scripts/check-setup.sh` row 1 | Must keep | Low | Every tool call |
| 19 | Secret scan | `.husky/pre-commit` → `scripts/secret-scan.sh` (gitleaks) | `scripts/check-setup.sh` row 7 | Must keep | Low (runs on commit only) | Every commit |
| 20 | Supabase advisors check in `/close-substage` | `.claude/skills/close-substage/SKILL.md` step 8 (`get_advisors`) | `scripts/check-setup.sh` row 5 (text match) | Worthful | Low (one read-only call) | Once per sub-stage close |
| 21 | "Anoop must do now" block in every report | `.claude/skills/close-substage/SKILL.md` step 8–9 | `scripts/check-setup.sh` row 5 | Must keep | Low | Every close-substage report |
| 22 | `my-tasks.md` guard in `/plan-stage` and `/build-substage` | `.claude/skills/{plan-stage,build-substage}/SKILL.md` step 1 | `scripts/check-setup.sh` row 8 (file exists) + manual read of the skill text | Must keep | Low | Every stage plan / sub-stage start |
| 23 | `apps/web/vercel.json` `deploymentEnabled` not `false` (git auto-deploy is the only deploy path — no backup deploy-hook Action, removed 1-Nov-2026) | `apps/web/vercel.json` | `scripts/check-setup.sh` row 9 | Must keep | — | Checked every `/close-substage` |
| 24 | `scripts/check-setup.sh` | `scripts/check-setup.sh` | Run once this session (output in `claude/reports/last-report.md`) | Must keep | Low (pure grep, no network) | Every `/close-substage` |
| — | Nightly Claude health-check | Not built | — | **Can skip / not wired** | — | — |
| — | `explain-usage` at stage close | Not built | — | **Can skip / not wired** | — | — |

**Why the last two are "Can skip / not wired" (`decisions.md` §14, 31-Oct):** a nightly Claude-run check costs a Claude session just to poll a status that doesn't need a model to read — a plain GitHub Action that emails Anoop only on failure does the same job for free, and it's deferred until the hosted worker exists (Stage 3) since there's no daily run to watch yet. `explain-usage` (a usage/cost summary) was considered for the `/close-substage` checkpoint but not added — `scripts/check-setup.sh` plus the Supabase advisors check already cover what that checkpoint needs, and a cost summary doesn't change what Claude does next.
