# CLAUDE.md – Oksy Data Cleanse portal

**Current stage: Stage 2 approved 31-Oct-2026, built on branch `stage-2-rule-library` (not merged to `main`). 2a and 2b done 31-Oct-2026, 2c, 2d and 2e done 1-Nov-2026 (2a: rule engine as data, money rules rewritten; 2b: dictionary_entries replaces hard-coded status words/colours/names, hms-profile.ts retired; 2c: cross-row rules, two-part approval combining, value-is-correct confirmations; 2d: Rule Library page rewritten — 3-part form, plain-words box, save-time conflict check, test before save, CSV/Excel upload; 2e: rule trial (Run Trial job, per-rule summary, Owner/Admin approval) and check sets (pick up to 5 claims per hospital, live pass/fail, Accept new values)). All five Stage 2 migrations (`20261031060500_rule_engine_data.sql`, `20261031070000_dictionary_entries.sql`, `20261101120000_claim_checks_two_part.sql`, `20261101130000_rule_library_page.sql`, `20261101140000_rule_trials_check_sets.sql`) are applied to live, confirmed 1-Nov-2026. 2f in progress (prompt 1 of 2, 1-Nov-2026): pilot header decisions recorded (`claude/decisions.md` section 5), branch checks all green; waiting on Anoop to fix HMS's "TDS" header in Column Mappings and run the pilot trial on live. Next: Anoop's live steps, then prompt 2 of `/build-substage 2f` (Stage 2 close).**

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
