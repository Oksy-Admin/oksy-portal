# Oksy Data Cleanse portal

Read `CLAUDE.md` and `handoff.md` first. Project documents are in `claude/`.

| Folder | What it holds |
|---|---|
| `apps/web` | Next.js portal (Vercel project, region Mumbai `bom1`; deploys from `main`) |
| `packages/rules` | Rule engine, rule selection and money helper (pure TypeScript, unit tests) |
| `packages/google` | Google Sheets and Drive: read path (hospital sheets) and write path (Question Sheets only) |
| `packages/worker` | Background runner: one job per sheet (`pnpm worker`) |
| `supabase/migrations` | Database changes as SQL files (never edit the database by hand) |
| `supabase/tests` | Database security tests (pgTAP), run in CI |
| `scripts/secret-scan.sh` | Secret scan, run before every commit and in CI |
| `scripts/db-test-local.sh` | All migrations and database tests on a throwaway local database (Docker) |
| `scripts/check-aligned.sh` | Read-only check: Mac folder vs GitHub, Supabase and Vercel |
| `.github/workflows/ci.yml` | CI: secret scan, typecheck, lint, tests, build, database tests (deploys nothing) |

## Commands
- `pnpm install`: install (also turns on the pre-commit secret scan)
- `pnpm dev`: portal on http://localhost:3000
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`
- `bash scripts/db-test-local.sh`: database tests
- `pnpm secret-scan`: scan the whole folder and git history
- `bash scripts/check-aligned.sh`: alignment check (`--no-remote` for offline)

## Secrets
Never in the repo, chat or logs. Copy `.env.example` to `apps/web/.env.local` (git-ignored) and fill it in yourself.
On Vercel, set the same names as environment variables in the dashboard.