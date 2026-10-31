# CLAUDE.md – Oksy Data Cleanse portal

**Current stage: Stage 1 finished 31-Oct-2026 (all sub-stages done, migrations on live with zero drift, code-reviewer run with one Must fixed), waiting for Anoop's push. Next: Stage 2 plan, not started.**

## Read first, in this order
1. `handoff.md` – where we are now and the next step
2. `claude/decisions.md` – every confirmed decision (wins over everything else)
3. `claude/requirements.md` – what the portal must do
4. `claude/stage-plan.md` – stages, sub-stages, done-criteria, status
5. `claude/column-dictionary.md` and `claude/insurance-glossary.md` – fields and terms, when needed

If one of these files is missing, stop and report it. Do not guess its content.
Never ask Anoop a decision that is already in `claude/decisions.md`.

## Hard rules
- **Never write to a hospital Google Sheet.** The portal only reads them. The robot writes only to the Question Sheets it creates.
- **AI never guesses** a missing UTR, date, amount or claim number, and never changes bill, approved or settled amounts.
- **Secrets:** never print or commit API keys, service account JSON or `.env` values. Do not open `.env.local` files in chat. `.env.local`, `supabase/.temp/` and `.next/` stay git-ignored.
- **Schema changes:** take a backup, write the SQL as a migration in `supabase/migrations/`, show it to Anoop, apply to live only after his OK.
- **Stage-level approval.** Anoop approves a whole stage plan once; sub-stages are then built one after another and reported together. The next stage starts only after Anoop approves. Every migration SQL still needs his OK before live.
- **Discuss first:** for new requirements or redesigns, propose; build nothing until Anoop agrees.

## Git
- Claude makes the commits: small, one purpose each, clear English message. Tell Anoop what each commit contains.
- **Anoop runs `git push` himself** from the Mac Terminal, once at the end of each stage. Claude does not push.
- Remote: HTTPS only (`https://github.com/Oksy-Admin/oksy-portal.git`). The SSH remote (`git@github-oksy`) is broken.
- Vercel deploys automatically from GitHub `main` after a push. Database changes are not deployed by a push; they are applied separately (see Schema changes).
- One tool (Claude Code, Codex or Antigravity) works on one file at a time; commit, then switch tools.

## Talking to Anoop
- Reply in **English**, plain words, short: done / blocked / decision needed. Code, file names and commit messages in English.
- Write every final report also to `claude/reports/last-report.md` (overwrite it each time), so Anoop can read it without copying from the terminal.
- Anoop is not a programmer. For any step he must do: which app, which screen, exact text to type or click, what to check, what it is for, what happens if skipped.
- Every question gives the reason and Claude's recommendation, answerable yes/no. At most 3–5 questions at a stage gate.
- Do not paste long code or long outputs in chat.

## Closing a sub-stage (same session)
1. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; check the done-criteria in `claude/stage-plan.md`.
2. Update the status table in `claude/stage-plan.md` (DONE + date + evidence).
3. Update the "Current stage" line here, in `AGENTS.md` and in `handoff.md`.
4. Add any new decision to `claude/decisions.md` (move replaced ones to its "Superseded" table).
5. Report to Anoop and wait for approval.

## Saving prompts (target ~55 prompts to the pilot finish line)
- One prompt = one full sub-stage: build → tests until green → commits → close. Do not stop to ask what is already decided.
- Skills in `.claude/skills/`: `/plan-stage N`, `/build-substage Nx`, `/close-substage Nx`.
- Stop hook (`scripts/claude-stop-check.sh`) runs typecheck, lint and test on uncommitted code changes; fix failures in the same prompt.
- `.claude/settings.json` allows routine commands and blocks `git push`, live `supabase db push` and reading `.env` files.
- Agents in `.claude/agents/`: `design-reviewer` (mandatory in `/plan-stage`), `code-reviewer` (end of each stage). MCP (`.mcp.json`): Supabase read-only, Context7 docs.
- Read only what the task needs; keep outputs short; `/clear` after each closed sub-stage.

## Commands
See `README.md` (`pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm worker`).
