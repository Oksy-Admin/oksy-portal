# handoff.md – Oksy Data Cleanse portal

Short "where are we now" note. Last updated: 31-Oct-2026.

## Current stage
**Current stage: Stage 1 in progress – plan approved by Anoop 31-Oct-2026. 1a done 30-Oct; 1b-i, 1b-ii, 1c, 1d and 1e done 31-Oct-2026 (migrations on live, zero drift). Next: Stage 1 close (code-reviewer run, open decision on `district_heads` / `open_checks`, Anoop's push).**
Next: the Stage 1 close – code-reviewer run on the Stage 1 diff, the open unused-table decision on `district_heads` and `open_checks`, then Anoop pushes; one push at the end of Stage 1.

## What the portal is (one line)
Reads hospital Google Sheets (read-only), cleans the claim data into Supabase, asks hospital staff through Question Sheets, and gives correct combined reports. Details: `claude/requirements.md`.

## Files (read in this order)
1. This file
2. `claude/decisions.md` – all confirmed decisions
3. `claude/requirements.md` – requirements
4. `claude/stage-plan.md` – stages and status
5. `claude/column-dictionary.md`, `claude/insurance-glossary.md` – fields and terms

## Live systems
- Local folder (Mac): `~/Projects/oksy-portal`. GitHub: `Oksy-Admin/oksy-portal` (private, HTTPS remote).
- Vercel project `admin-oksy/oksy-portal`: deploys automatically from `main`. Commits must use the git identity `admin@oksy.in` (a Vercel team member).
- Supabase project `oksy-data-cleanse` (Mumbai, ref `ciorqudslbprfzxedcfy`). Migrations up to `20261031055948` (1e worker rights; 1d `20261031054200`; 1c reconcile `20261031051558`, applied 31-Oct after Anoop's OK; rollback snapshots in `supabase/.temp/backup_before_*_20261031.sql`) are applied to live. Live and the migration files match (`bash scripts/schema-drift.sh`, fingerprint `9a39d2fd…` after 1e).
- Google: hospital sheets in Drive folder `Oksy Hospital Sheets`; Question Sheets in Shared Drive `Oksy Question Sheets Drive`. Robot = Google service account with read access to the 3 pilot sheets.
- Pilots: HOSPPVTP0001 Badagara, HOSPPVTP0002 Tree G Eye Care, HOSPPVTP0003 HMS (links in `claude/requirements.md` section 5).

## Open right now
- Carried into Stage 1: see `claude/stage-plan.md` (1b–1e).

## Never
- Write to a hospital Google Sheet.
- Print or commit secrets.
- Apply a schema change to live before Anoop's OK on the SQL.
- Start the next stage before Anoop approves the current one.
