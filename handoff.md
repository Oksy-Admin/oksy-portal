# handoff.md – Oksy Data Cleanse portal

Short "where are we now" note, max one page. Last updated: 1-Nov-2026 (2e done; its migration waits for Anoop's OK).

## Current stage
**Current stage: Stage 2 approved 31-Oct-2026, built on branch `stage-2-rule-library` (not merged to `main`). 2a and 2b done 31-Oct-2026, 2c, 2d and 2e done 1-Nov-2026 (2a: rule engine as data, money rules rewritten; 2b: dictionary_entries replaces hard-coded status words/colours/names, hms-profile.ts retired; 2c: cross-row rules, two-part approval combining, value-is-correct confirmations; 2d: Rule Library page rewritten — 3-part form, plain-words box, save-time conflict check, test before save, CSV/Excel upload; 2e: rule trial (Run Trial job, per-rule summary, Owner/Admin approval) and check sets (pick up to 5 claims per hospital, live pass/fail, Accept new values)). All five Stage 2 migrations (`20261031060500_rule_engine_data.sql`, `20261031070000_dictionary_entries.sql`, `20261101120000_claim_checks_two_part.sql`, `20261101130000_rule_library_page.sql`, `20261101140000_rule_trials_check_sets.sql`) are applied to live, confirmed 1-Nov-2026. 2f in progress (prompt 1 of 2, 1-Nov-2026): pilot header decisions recorded (`claude/decisions.md` section 5), branch checks all green; waiting on Anoop to fix HMS's "TDS" header in Column Mappings and run the pilot trial on live. Next: Anoop's live steps, then prompt 2 of `/build-substage 2f` (Stage 2 close).**

## Next step
2f is in progress (prompt 1 of 2): pilot header decisions recorded, branch checks all green. Waiting on Anoop to fix one Column Mappings row and run the pilot trial on live (see below); Claude then does Stage 2 close (code-reviewer, status table, push by Anoop) in the next prompt.

## Waiting on Anoop
Full detail and exact steps for all of these: `claude/my-tasks.md`.
- Fix HMS's live "TDS" header decision (Column Mappings page: change it from `tds` to `tds_amount_stated`) — it holds a rupee amount, not a percentage, confirmed 1-Nov.
- Run the pilot trial on live (2f): "Run now" (write) for the 3 pilot sheets on the Claims page, then per hospital on its Trial page pick the check set and click "Trial approved", then confirm the Insurer/TPA/Doctor/Department entries the run creates on the Dictionary page.
- Add `ANTHROPIC_API_KEY` to `apps/web`'s own environment (`.env.local` and Vercel) so the Rule Library's plain-words box works; also add the line to `.env.example` (this session's permission settings blocked that file).
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
- Local folder (Mac): `~/Projects/oksy-portal`. GitHub: `Oksy-Admin/oksy-portal` (private, HTTPS remote).
- Vercel project `admin-oksy/oksy-portal`: deploys automatically from `main`. Commits must use the git identity `admin@oksy.in` (a Vercel team member).
- Supabase project `oksy-data-cleanse` (Mumbai, ref `ciorqudslbprfzxedcfy`). Migrations up to `20261101130000` are applied to live.
- Google: hospital sheets in Drive folder `Oksy Hospital Sheets`; Question Sheets in Shared Drive `Oksy Question Sheets Drive`. Robot = Google service account with read access to the 3 pilot sheets.
- Pilots: HOSPPVTP0001 Badagara, HOSPPVTP0002 Tree G Eye Care, HOSPPVTP0003 HMS (links in `claude/requirements.md` section 5).

## Never
- Write to a hospital Google Sheet.
- Print or commit secrets.
- Apply a schema change to live before Anoop's OK on the SQL.
- Start the next stage before Anoop approves the current one.
