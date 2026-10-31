# Report – 31-Oct-2026 – Repo housekeeping (no feature work)

## Anoop must do now
- **OK the two Stage 2 migrations** — `20261031060500_rule_engine_data.sql` and `20261031070000_dictionary_entries.sql`. Confirmed on live (Supabase MCP, read-only `list_migrations`): live stops at `20261031055948`; these two are **not yet applied**. Nothing changed by this housekeeping pass. Steps: `claude/my-tasks.md` → "Do now" item 1.
- **Add GitHub secret `VERCEL_DEPLOY_HOOK_URL`** — a new backup deploy-hook Action now exists on `main` and needs it to do anything. Steps: `claude/my-tasks.md` → "Do now" item 2.
- **Vercel vs `main`:** Vercel's last production deploy (commit `63e3920`) matches what was `main`'s head before this session. This session added one more commit to `main` directly (the deploy-hook workflow file, `e694a63` — see "Git" below) that is **not yet live or pushed**; that is expected until you push `main`. No mismatch to act on today.
- **Open `my-tasks.md` items not urgent today:** KASP/MEDISEP sample sheet links + robot access + the staff rule discussion — needed only before the KASP/MEDISEP scheme-fit check, not before `/build-substage 2c`.

## What this session did
Pure housekeeping per your scope-lock list — no feature code touched, `pnpm typecheck/lint/test/build` not run (nothing in `apps/web`, `packages/*` changed). **2c was not started.**

1. **Slimmed the always-read docs:**
   - `claude/stage-plan.md`: Stage 0 + Stage 1 full detail moved to new `claude/archive/stage-history.md`; only the status table and Stage 2 (current) + Stage 3 (next) detail remain. 56 KB → 31 KB.
   - `claude/decisions.md`: section 15 "Superseded" moved to new `claude/archive/decisions-superseded.md`; a section index (number, title, approximate line range) added at the top.
   - `AGENTS.md`: now a short pointer to `CLAUDE.md` plus only the Codex/Antigravity-specific lines (61 → 11 lines).
   - `CLAUDE.md`: Git / Talking to Anoop / Closing a sub-stage / Saving prompts / Token-saving sections removed (all duplicated `decisions.md` §14); kept hard rules, reading order, and a pointer to §14. 61 → ~20 lines.
   - `handoff.md`: rewritten to one page — current position, next step, "Waiting on Anoop" list, live systems, Never list.
   - New session-start order (in `CLAUDE.md`, `handoff.md`): `handoff.md` → `claude/my-tasks.md` → only the `decisions.md` sections the task needs.

2. **New `claude/my-tasks.md`** (Do now / Before each stage starts / Until the end of the project), with full plain-English steps for: the two migration OKs, the GitHub secret, KASP/MEDISEP access + staff rule discussion (tagged as a prerequisite for the scheme-fit check, not for 2c–2f), and pasting `last-report.md` into the Claude Project chat after every report.

3. **`/plan-stage` and `/build-substage` skills** now read `claude/my-tasks.md` first and stop if a "Before each stage/sub-stage starts" item is open for that sub-stage.

4. **`/close-substage` skill reworked:**
   - Report now opens with the "Anoop must do now" block (live Supabase/Vercel MCP checks + open `my-tasks.md` items) — demonstrated above.
   - Dropped "mirror to the Claude Project"; replaced with "tell Anoop to paste `last-report.md` into the Claude Project chat".
   - `stage-plan.md` now gets one status-table line per sub-stage; full evidence goes to `claude/reports/` instead of being appended to the plan file.

5. **Vercel deploy check:** the Vercel project's Root Directory is `apps/web`, so Vercel reads `apps/web/vercel.json` (not the repo-root one) for git config. It had `deploymentEnabled: false`, silently overriding the root file's `true`. Evidence: the last 3 production deployments' commit messages are manual `chore: redeploy latest main` / `trigger Vercel deploy` commits — only explainable as a workaround for auto-deploy not firing. Fixed: `apps/web/vercel.json` → `true` (one line).

6. **New `.github/workflows/vercel-deploy-hook.yml`**, committed directly on `main` (branch switch, as it must exist on `main` to run) — calls the Vercel Deploy Hook on every push to `main` if `VERCEL_DEPLOY_HOOK_URL` is set; otherwise prints a notice and exits 0. Never echoes the URL.

7. **`decisions.md` §14** got one new dated entry (31-Oct) recording all of the above as policy: repo is the sole source of truth; Claude Project holds only instructions + a stable handoff pointer; deploy-hook Action + Vercel "Skip deployments" off; `my-tasks.md` guard; "Anoop must do now" block in every report; Vercel check at stage close; terminal replies stay English, chat may be Malayalam.

## Commits (this session, one purpose each)
On `stage-2-rule-library` (not pushed):
- `ccb3c1f` docs: archive Stage 0/1 detail out of stage-plan.md
- `4690d1a` docs: add a section index to decisions.md, archive Superseded
- `901b802` docs: trim CLAUDE.md and AGENTS.md to remove duplication
- `15ebe5c` docs: rewrite handoff.md to one page, add claude/my-tasks.md
- `eb7a611` docs(skills): add my-tasks.md guard; rework close-substage report
- `dc36584` fix(vercel): enable git deployments in apps/web/vercel.json

On `main` (not pushed — needed there specifically so the Action exists on `main`):
- `e694a63` ci: add backup Vercel deploy-hook Action on push to main

Not touched (outside scope, left as found): `.agents/`, `.codex/`, `apps/web/AGENTS.md` (untracked, pre-existing).

## Next
`/build-substage 2c` once the two migrations have your OK. Not started this session.
