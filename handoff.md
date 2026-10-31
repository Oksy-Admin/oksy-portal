# handoff.md – Oksy Data Cleanse portal

Short "where are we now" note. Last updated: 31-Oct-2026.

## Current stage
**Current stage: Stage 2 approved 31-Oct-2026, built on branch `stage-2-rule-library` (not merged to `main`). 2a and 2b done 31-Oct-2026 (2a: rule engine as data, money rules rewritten; 2b: dictionary_entries replaces hard-coded status words/colours/names, hms-profile.ts retired). Migrations `20261031060500_rule_engine_data.sql` and `20261031070000_dictionary_entries.sql` tested locally, waiting for Anoop's OK before live. Next: `/build-substage 2c`.**
Next: `/build-substage 2c`.

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
