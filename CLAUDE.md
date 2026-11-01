# CLAUDE.md – Oksy Data Cleanse portal

**Current stage: Stage 2 approved 31-Oct-2026, built on branch `stage-2-rule-library` (not merged to `main`). 2a and 2b done 31-Oct-2026, 2c and 2d done 1-Nov-2026 (2a: rule engine as data, money rules rewritten; 2b: dictionary_entries replaces hard-coded status words/colours/names, hms-profile.ts retired; 2c: cross-row rules, two-part approval combining, value-is-correct confirmations; 2d: Rule Library page rewritten — 3-part form, plain-words box, save-time conflict check, test before save, CSV/Excel upload). All four Stage 2 migrations so far (`20261031060500_rule_engine_data.sql`, `20261031070000_dictionary_entries.sql`, `20261101120000_claim_checks_two_part.sql`, `20261101130000_rule_library_page.sql`) are applied to live by Anoop, 1-Nov-2026 (backup taken first each time; `20261101120000` fixed for live drift — no R-Y03 row in `public.rules` — before applying; `20261101130000` backed up as schema-2d and data-2d files). Next: `/build-substage 2e`.**

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
