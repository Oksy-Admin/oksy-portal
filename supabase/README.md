# Database (Supabase)

- `migrations/`: every database change, as SQL files applied in order. Never change tables by hand in the dashboard.
- `tests/`: security tests (pgTAP) with fake data; run with `bash scripts/db-test-local.sh`.

Migrations reach the cloud project `oksy-data-cleanse` (Mumbai, Free) through the Supabase GitHub
integration of `admin@oksy.in` ("Deploy to production" on the `main` branch), or by
`supabase db push` run by Muhammed Ali. Claude Code never logs in to Supabase.
