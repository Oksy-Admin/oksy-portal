# handoff.md – Oksy Data Cleanse portal

Short "where are we now" note. Last updated: 31-Oct-2026.

## Current stage
**Stage 1 (1b–1e) – whole-stage plan waiting for Anoop's approval.** Stage 0 closed; Stage 1a done 30-Oct-2026 (commit 52cbf41, pushed). Prompt-saving setup (skills, Stop hook, `.claude/settings.json`) done 31-Oct-2026.
Next: Anoop approves the Stage 1 plan, then `/build-substage 1b`, 1c, 1d, 1e in turn; one push at the end of Stage 1.

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
- Anoop's approval of the Stage 1 plan (1b–1e).
- Carried into Stage 1: see `claude/stage-plan.md` (1b–1e).

## Never
- Write to a hospital Google Sheet.
- Print or commit secrets.
- Apply a schema change to live before Anoop's OK on the SQL.
- Start the next sub-stage before Anoop approves the current one.
