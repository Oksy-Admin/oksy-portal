# handoff.md – Oksy Data Cleanse portal

Short "where are we now" note. Last updated: 31-Oct-2026.

## Current stage
**Current stage: Stage 1 in progress – plan approved by Anoop 31-Oct-2026 (he started `/build-substage 1b-i`). 1a done 30-Oct; 1b-i built 31-Oct-2026, its migration `20261031090000` waits for Anoop's OK before live. Next: 1b-ii.**
Next: Anoop's OK on migration `20261031090000` (then apply to live), and `/build-substage 1b-ii`; then 1c, 1d, 1e; one push at the end of Stage 1.

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
- Supabase project `oksy-data-cleanse` (Mumbai, ref `ciorqudslbprfzxedcfy`). Migrations up to `20261030074539` are applied to live; `20261031090000` (1b-i) is written, not applied.
- Google: hospital sheets in Drive folder `Oksy Hospital Sheets`; Question Sheets in Shared Drive `Oksy Question Sheets Drive`. Robot = Google service account with read access to the 3 pilot sheets.
- Pilots: HOSPPVTP0001 Badagara, HOSPPVTP0002 Tree G Eye Care, HOSPPVTP0003 HMS (links in `claude/requirements.md` section 5).

## Open right now
- Anoop's OK on migration `20261031090000_mapping_header_decisions.sql` (1b-i). Until it is on live, the new worker and Column Mappings page cannot run against live (they need `header_decisions`).
- Carried into Stage 1: see `claude/stage-plan.md` (1b–1e).

## Never
- Write to a hospital Google Sheet.
- Print or commit secrets.
- Apply a schema change to live before Anoop's OK on the SQL.
- Start the next stage before Anoop approves the current one.
