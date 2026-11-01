# handoff.md – Oksy Data Cleanse portal

Short "where are we now" note, max one page. Last updated: 1-Nov-2026 (three Stage 2 migrations applied to live).

## Current stage
**Current stage: Stage 2 approved 31-Oct-2026, built on branch `stage-2-rule-library` (not merged to `main`). 2a and 2b done 31-Oct-2026, 2c done 1-Nov-2026 (2a: rule engine as data, money rules rewritten; 2b: dictionary_entries replaces hard-coded status words/colours/names, hms-profile.ts retired; 2c: cross-row rules, two-part approval combining, value-is-correct confirmations). All three migrations (`20261031060500_rule_engine_data.sql`, `20261031070000_dictionary_entries.sql`, `20261101120000_claim_checks_two_part.sql`) applied to live by Anoop, 1-Nov-2026 (backup taken first; `20261101120000` fixed for live drift — no R-Y03 row in `public.rules` — before applying). Next: `/build-substage 2d`.**

## Next step
`/build-substage 2d` (Rule Library page).

## Waiting on Anoop
Full detail and exact steps for all of these: `claude/my-tasks.md`.
- Add GitHub secret `VERCEL_DEPLOY_HOOK_URL`.
- KASP/MEDISEP sample sheet links + robot read access + the staff rule discussion (needed before the KASP/MEDISEP scheme-fit check, not before 2d–2f).
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
- Local folder (Mac): `~/Projects/oksy-portal`. GitHub: `Oksy-Admin/oksy-portal` (private, HTTPS remote).
- Vercel project `admin-oksy/oksy-portal`: deploys automatically from `main`. Commits must use the git identity `admin@oksy.in` (a Vercel team member).
- Supabase project `oksy-data-cleanse` (Mumbai, ref `ciorqudslbprfzxedcfy`). Migrations up to `20261101120000` are applied to live.
- Google: hospital sheets in Drive folder `Oksy Hospital Sheets`; Question Sheets in Shared Drive `Oksy Question Sheets Drive`. Robot = Google service account with read access to the 3 pilot sheets.
- Pilots: HOSPPVTP0001 Badagara, HOSPPVTP0002 Tree G Eye Care, HOSPPVTP0003 HMS (links in `claude/requirements.md` section 5).

## Never
- Write to a hospital Google Sheet.
- Print or commit secrets.
- Apply a schema change to live before Anoop's OK on the SQL.
- Start the next stage before Anoop approves the current one.
