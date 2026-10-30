# handoff.md – Oksy Data Cleanse portal

Short "where are we now" note. Last updated: 30-Oct-2026 night.

## Current stage
**Stage 1a – file clean-up, in progress.** Stage 0 (everything built up to 30-Oct-2026) is closed.
Next: Anoop reviews the new file set → old files deleted → Claude commits → Anoop pushes → Stage 1b (mapping model) planned and approved.

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
- Supabase project `oksy-data-cleanse` (Mumbai, ref `ciorqudslbprfzxedcfy`). Migrations up to `20261030074539` are applied to live.
- Google: hospital sheets in Drive folder `Oksy Hospital Sheets`; Question Sheets in Shared Drive `Oksy Question Sheets Drive`. Robot = Google service account with read access to the 3 pilot sheets.
- Pilots: HOSPPVTP0001 Badagara, HOSPPVTP0002 Tree G Eye Care, HOSPPVTP0003 HMS (links in `claude/requirements.md` section 5).

## Open right now
- Anoop's review of the new file set (Stage 1a).
- Carried into Stage 1: see `claude/stage-plan.md` (1b–1e).

## Never
- Write to a hospital Google Sheet.
- Print or commit secrets.
- Apply a schema change to live before Anoop's OK on the SQL.
- Start the next sub-stage before Anoop approves the current one.
