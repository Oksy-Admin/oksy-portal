# CLAUDE.md – Oksy Data Cleanse portal

**Current stage: Stage 1b (mapping model) – planning, waiting for Anoop's approval of the plan. Stage 0 closed; Stage 1a (file clean-up) done 30-Oct-2026. Do not build 1b until Anoop approves its plan.**

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
- **One stage (and sub-stage) at a time.** The next starts only after Anoop approves.
- **Discuss first:** for new requirements or redesigns, propose; build nothing until Anoop agrees.

## Git
- Claude makes the commits: small, one purpose each, clear English message. Tell Anoop what each commit contains.
- **Anoop runs `git push` himself** from the Mac Terminal. Claude does not push.
- Remote: HTTPS only (`https://github.com/Oksy-Admin/oksy-portal.git`). The SSH remote (`git@github-oksy`) is broken.
- Vercel deploys automatically from GitHub `main` after a push. Database changes are not deployed by a push; they are applied separately (see Schema changes).
- One tool (Claude Code, Codex or Antigravity) works on one file at a time; commit, then switch tools.

## Talking to Anoop
- Reply in **Malayalam**, plain words, short: done / blocked / decision needed. Code, file names and commit messages in English.
- Anoop is not a programmer. For any step he must do: which app, which screen, exact text to type or click, what to check, what it is for, what happens if skipped.
- Every question gives the reason and Claude's recommendation, answerable yes/no. At most 3–5 questions at a stage gate.
- Do not paste long code or long outputs in chat.

## Closing a sub-stage (same session)
1. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; check the done-criteria in `claude/stage-plan.md`.
2. Update the status table in `claude/stage-plan.md` (DONE + date + evidence).
3. Update the "Current stage" line here, in `AGENTS.md` and in `handoff.md`.
4. Add any new decision to `claude/decisions.md` (move replaced ones to its "Superseded" table).
5. Report to Anoop and wait for approval.

## Commands
See `README.md` (`pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm worker`).
