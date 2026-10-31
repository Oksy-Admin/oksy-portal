# Report – 31-Oct-2026 – Repo housekeeping part 2 (no feature work)

## check-setup.sh result
`bash scripts/check-setup.sh` → **all 11 rows PASS**, exit 0.
```
PASS  settings.json deny list blocks rm -rf and git push
PASS  Stop hook configured in settings.json
PASS  design-reviewer and code-reviewer agents exist
PASS  /build-substage mentions scope-lock
PASS  /close-substage mentions advisors and the Anoop-must-do-now block
PASS  .mcp.json has supabase and context7
PASS  .husky/pre-commit runs the secret scan
PASS  claude/my-tasks.md exists
PASS  .github/workflows/vercel-deploy-hook.yml exists (working tree or main)
PASS  apps/web/vercel.json does not block Git deployments
PASS  session-start files (handoff.md + my-tasks.md + CLAUDE.md) = 12639 bytes, under 25 KB
```

## Anoop must do now
Full plain-English steps for all of these are in `claude/my-tasks.md` → "Do now", in this order:
1. **Add GitHub secret `VERCEL_DEPLOY_HOOK_URL`** — create a **new** Vercel Deploy Hook first and **revoke the old one** if one exists, then add the new URL as the GitHub secret.
2. **`git push origin main`**, then check: Vercel shows a new production deployment starting, and GitHub Actions shows the "Vercel deploy hook" workflow run green. `main` is currently 2 commits ahead of `origin/main` (the deploy-hook Action, and the cherry-picked `apps/web/vercel.json` fix) — see "Git: main" below.
3. **OK the two Stage 2 migrations** (`20261031060500_rule_engine_data.sql`, `20261031070000_dictionary_entries.sql`) — still not on live, unchanged from last report.
4. **KASP/MEDISEP sample sheet links + robot read access + the staff rule list.**
5. **`/clear`, then `/build-substage 2c`.**

Also open, not urgent: confirm HMS's PAID/PENDING tabs hold rupee amounts (not a rate) in the plain "TDS" column — `claude/my-tasks.md` → "Before each stage/sub-stage starts".

No Supabase advisor or Vercel-production-vs-main checks were re-run beyond what's above — this was a docs/config-only session, no 2c build, so there's nothing new on live to flag.

## What this session did
Pure housekeeping, scope-locked to the items given — no feature code touched, `pnpm typecheck/lint/test/build` not run (nothing in `apps/web`/`packages/*` changed). **2c was not started. Nothing pushed.**

**A. Vercel fix on `main`:** cherry-picked `dc36584` (the `apps/web/vercel.json` one-line fix) onto `main` as its own commit `9c3c9d4`, then returned to `stage-2-rule-library`. `main` now: `9c3c9d4` (vercel fix) → `e694a63` (deploy-hook Action, from the prior session) → `63e3920` (last pushed commit).

**B/C. `claude/setup-checklist.md` + `scripts/check-setup.sh`:** 25 setup rows (name, where it lives, proof, Must keep/Worthful/Can skip, usage cost, frequency); the nightly Claude health-check and `explain-usage` are both marked **Can skip / not wired**, with the reason (a plain GitHub Action can watch deploy/run status for free once there's something to watch; a cost summary doesn't change what Claude does next). `check-setup.sh` greps the repo (no Claude, no network) and checks 11 of those rows; result above.

**D. Add-ons:**
1. `.claude/settings.json` deny list: added `Bash(rm -rf*)` (diff: one line added, next to the existing `git push` / `git reset --hard` denials).
2. `/build-substage`: now restates the sub-stage's "Done when" line before building (scope-lock — anything outside it stops and asks Anoop); one-line fixes stay one-line edits; every commit now compares its staged files against the files the plan named, stopping if one isn't listed.
3. `/close-substage`: now runs `scripts/check-setup.sh` and the Supabase advisors check (security + performance, new findings only) before building the report; both feed the "Anoop must do now" block. `explain-usage` was **not** added, as instructed.
4. **Model routing — checked against the current Claude Code docs (Context7) rather than assumed:** agent frontmatter (`.claude/agents/*.md`) supports a `model` field — set `design-reviewer` and `code-reviewer` to `opus`. `SKILL.md` frontmatter has **no** `model` field — a skill always runs in whatever model the session already has, so `/plan-stage`, `/build-substage`, `/close-substage` can't be set to Sonnet from the file; that stays a human choice of session model. **Vercel MCP in `.mcp.json`:** project-level MCP does support OAuth-based remote servers (confirmed via Context7), but I did not add an entry — Vercel MCP already works in this session through the account's own connection, not `.mcp.json`, and I don't have a verified Vercel MCP server URL/OAuth config to add without guessing one (which risks a broken or stuck entry). Skipped; Anoop can add one properly later with `claude mcp add` if ever wanted project-wide.
5. Wording changed everywhere it said "paste `last-report.md` into the Claude chat" (`claude/my-tasks.md`, `handoff.md`, `.claude/skills/close-substage/SKILL.md`) to: tell the Claude chat "report ready" (it reads the file through the computer link; paste only if not linked).

**E. Decisions recorded (`claude/decisions.md`, dated 31-Oct):**
1. Section 5 — new extra field `tds` (label "TDS %", number): Badagara/Tree G's plain "TDS" header maps here; HMS's plain "TDS" maps to `tds_amount_stated`, now labelled **"TDS Amount"** (not yet checked against the real sheet — see my-tasks.md). The earlier "TDS % column → Ignore" (in the 7-headers table) and "plain TDS gets no stored decision" notes both moved to `claude/archive/decisions-superseded.md`. Auto-Ignore still applies to a header literally named "TDS %" (`column-dictionary.md` updated to match in sections 1–3).
2. Section 14 — a setup is "Active" only when `check-setup.sh` can confirm it; `setup-checklist.md` is the one list.
3. Section 14 — nightly Claude health-check replaced by a plan for a non-Claude GitHub Action (emails Anoop only on failure: Vercel deploy status, 6 AM run), built after the hosted worker exists (Stage 3); `explain-usage` confirmed out of the close checkpoint.

**F. `claude/my-tasks.md`:** no "column mapping" items existed to remove (checked — none found). Added the HMS PAID/PENDING TDS check under "Before each stage/sub-stage starts". "Do now" reordered into one 5-step sequence (secret → push+check → migrations OK → KASP/MEDISEP → `/clear` + `/build-substage 2c`), each with full plain-English steps including "revoke the old hook" and what to check in Vercel/GitHub Actions after the push.

## Git
**`stage-2-rule-library`** (current branch, not pushed), new commits this session, oldest first:
- `9c562e2` chore(settings): deny rm -rf in Claude Code permissions
- `dda4e29` chore(agents): route design-reviewer and code-reviewer to opus
- `b638733` docs(skills): scope-lock in build-substage; check-setup + advisors in close-substage
- `63938be` docs(decisions): resolve plain-"TDS" header mapping; setup/health-check policy
- `5f3f519` docs: reorder my-tasks.md Do-now list; add HMS TDS check; wording fix
- `a7ebcf3` feat(scripts): add check-setup.sh and claude/setup-checklist.md

**`main`** (not pushed) — resulting commit list, newest first:
- `9c3c9d4` fix(vercel): enable git deployments in apps/web/vercel.json *(new this session, cherry-picked from `dc36584`)*
- `e694a63` ci: add backup Vercel deploy-hook Action on push to main *(prior session)*
- `63e3920` chore(web): trigger Vercel deploy of the new Column Mappings page *(last pushed commit — `origin/main` HEAD)*

Not touched (outside scope, left as found): `.agents/`, `.codex/`, `apps/web/AGENTS.md` (untracked, pre-existing).

## Next
Once the "Anoop must do now" steps above are done: `/build-substage 2c`. Not started this session.
