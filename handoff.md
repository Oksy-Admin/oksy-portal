# handoff.md – Oksy Data Cleanse portal

Short "where are we now" note, max one page. Last updated: 1-Nov-2026 (status + alignment check; 3 pilots now have claims written live; trial approval and dictionary confirm still open).

## Current stage
**Current stage: see `CLAUDE.md`'s "Current stage" line — that is the one copy.**

## Next step
Waiting on Anoop for 2f's last two live steps (Trial page approval + check sets per pilot; Dictionary page confirmations) — see below. Claude then does Stage 2 close (code-reviewer on the whole diff, status table) in the next prompt.

## Waiting on Anoop
Full detail and exact steps for all of these: `claude/my-tasks.md`.
- Each pilot's Trial page (`/hospitals/[code]/trial`): pick up to 5 known-correct claims as the check set, review the per-rule summary, click "Trial approved". Claims are already live for all 3 pilots (Badagara, Tree G, HMS).
- Dictionary page: confirm the suggested Insurer/TPA/Doctor/Department entries (250 still SUGGESTED, 36 already CONFIRMED, checked 1-Nov).
- KASP/MEDISEP sample sheet links + robot read access + the staff rule discussion — Anoop will share these Monday 2-Nov-2026 (already discussed; not chased before then).
- Recurring: after every report, tell the Claude chat "report ready" (it reads `claude/reports/last-report.md` through the computer link; paste only if that chat is not linked).

## What the portal is (one line)
Reads hospital Google Sheets (read-only), cleans the claim data into Supabase, asks hospital staff through Question Sheets, and gives correct combined reports. Details: `claude/requirements.md`.

## Files (read in this order)
1. This file
2. `claude/my-tasks.md` – Anoop's open tasks
3. `claude/decisions.md` – all confirmed decisions (use its section index)
4. `claude/requirements.md` – requirements
5. `claude/stage-plan.md` – stages and status (current + next stage only; history in `claude/archive/`)
6. `claude/column-dictionary.md`, `claude/insurance-glossary.md` – fields and terms

## Live systems
- Local folder (Mac): `~/Projects/oksy-portal`, branch `main`, matches `origin/main` exactly (checked 1-Nov-2026). GitHub: `Oksy-Admin/oksy-portal` (private, HTTPS remote).
- Vercel project `admin-oksy/oksy-portal`: deploys automatically from `main` (git auto-deploy only — the backup deploy-hook Action was removed 1-Nov-2026, it was building every push twice); latest production deployment matches `origin/main`'s HEAD commit (checked 1-Nov-2026). Commits must use the git identity `admin@oksy.in` (a Vercel team member).
- Supabase project `oksy-data-cleanse` (Mumbai, ref `ciorqudslbprfzxedcfy`). All migrations through `20261101160000_column_mappings_sync_decision.sql` are applied to live (checked 1-Nov-2026).
- Google: hospital sheets in Drive folder `Oksy Hospital Sheets`; Question Sheets in Shared Drive `Oksy Question Sheets Drive`. Robot = Google service account with read access to the 3 pilot sheets.
- Pilots: HOSPPVTP0001 Badagara, HOSPPVTP0002 Tree G Eye Care, HOSPPVTP0003 HMS (links in `claude/requirements.md` section 5).

## Never
- Write to a hospital Google Sheet.
- Print or commit secrets.
- Apply a schema change to live before Anoop's OK on the SQL.
- Start the next stage before Anoop approves the current one.
