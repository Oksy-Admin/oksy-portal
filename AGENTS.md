# AGENTS.md – Oksy Data Cleanse portal

**Current stage: Stage 3b (Fields page) is deployed. Balance Status is active in production; its mapping test awaits a safe source column. Stages 0, 1, 2 and 3 are approved. Migrations 20261027000028, 20261030074527 and 20261030074539 are applied to live. Do not start Stage 4 until Anoop says so.**

## Source of truth (read in this order)
1. `handoff.md` – current stage, decisions, pilot hospitals, working rules
2. `claude/requirements_v2.md` – wins over v1 where they differ
3. `claude/requirements_v1.md` – background only

If one of these files is missing, stop and report it. Do not guess its content.
Do not change the requirements or the decisions in these files.

## Hard rules
- Never write to any hospital Google Sheet. The portal only reads them; clean data lives in Supabase.
- Never commit or print API keys, service account JSON or `.env` values. `.env.local`, `supabase/.temp/` and `.next/` stay git-ignored.
- Before any Supabase schema change: take a backup and write the SQL as a migration file in `supabase/migrations/`. Do not apply a schema change to the remote project before Anoop has seen the SQL.
- Do not delete the untracked `Docs/` folder.
- Small commits, one purpose each, with a clear message.
- Git remote: HTTPS (`https://github.com/Oksy-Admin/oksy-portal.git`). The SSH remote (`git@github-oksy`) is broken; do not use it.
- Report back in short: done / blocked / decision needed.

## Commands
See `README.md` (`pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`).
