# CLAUDE.md – Oksy Data Cleanse portal

**Current stage: Stage 2 merged into `main` 1-Nov-2026 (commit `f5aed44`; branch `stage-2-rule-library` fully merged). 2a and 2b done 31-Oct-2026, 2c, 2d and 2e done 1-Nov-2026 (2a: rule engine as data, money rules rewritten; 2b: dictionary_entries replaces hard-coded status words/colours/names, hms-profile.ts retired; 2c: cross-row rules, two-part approval combining, value-is-correct confirmations; 2d: Rule Library page rewritten — 3-part form, plain-words box, save-time conflict check, test before save, CSV/Excel upload; 2e: rule trial (Run Trial job, per-rule summary, Owner/Admin approval) and check sets (pick up to 5 claims per hospital, live pass/fail, Accept new values)). All seven Stage 2 migrations are applied to live, through `20261101160000_column_mappings_sync_decision.sql`, confirmed 1-Nov-2026. 2f in progress: HMS's TDS header and the DISCOUNT/MEMBER NUMBER mapping bug are both fixed live, and "Run now" (write) has succeeded for all 3 pilots — claims written to Supabase for the first time. Waiting on Anoop: each pilot's Trial page (pick a check set, click "Trial approved") and the Dictionary page (250 suggested entries to confirm). Next: Anoop's two remaining live steps, then Stage 2 close (code-reviewer on the whole diff, status table).**

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

## How we work
Git workflow, talking to Anoop, closing a sub-stage, saving prompts and the full token-saving rules all live in **`claude/decisions.md` section 14 ("How we work")** — that is the one copy; nothing here repeats it. Read it before any git action, any report to Anoop, or any sub-stage close.

Session-start reading order: `handoff.md` → `claude/my-tasks.md` → only the `decisions.md` sections the task needs (use its section index + `grep`).

**Prerequisite guard (`/plan-stage`, `/build-substage`):** read `claude/my-tasks.md` first; if an item under "Before each stage/sub-stage starts" is open for this sub-stage, stop and tell Anoop instead of starting.

## Commands
See `README.md` (`pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm worker`).
