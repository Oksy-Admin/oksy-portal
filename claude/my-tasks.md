# claude/my-tasks.md – Anoop's tasks

Plain English. Read this before `handoff.md`'s "Waiting on Anoop" list tells you to look here. `/plan-stage` and `/build-substage` check the "Before each stage/sub-stage starts" section below before starting work; if something there is open for the sub-stage about to run, Claude stops and tells you instead of starting.

## Do now

1. **OK the two Stage 2 migrations**
   - What: two SQL files are ready and already tested on a throwaway copy of the database: `supabase/migrations/20261031060500_rule_engine_data.sql` (the Rule Library) and `supabase/migrations/20261031070000_dictionary_entries.sql` (the Words & Names dictionary).
   - Where: ask Claude Code in the terminal to show you both files, or open them yourself in Finder → `~/Projects/oksy-portal/supabase/migrations/` with any text editor.
   - What to do: once you've looked them over (or you're happy to trust the local test pass), tell Claude "OK to apply 20261031060500" and "OK to apply 20261031070000" — each is applied separately, with a backup taken first.
   - Why: nothing in the Rule Library or the Words & Names page works on the real (live) database until these two are applied. Everything so far has only run on a local test copy.
   - If skipped: Stage 2 stays stuck on your Mac and the Vercel preview; it never reaches the real site.

2. **Add the GitHub secret `VERCEL_DEPLOY_HOOK_URL`**
   - App: your web browser, signed in to GitHub.
   - Screen: go to `https://github.com/Oksy-Admin/oksy-portal` → **Settings** tab → **Secrets and variables** (left sidebar) → **Actions** → green **New repository secret** button.
   - Exact text: Name = `VERCEL_DEPLOY_HOOK_URL`. Value = a Deploy Hook URL from Vercel — get it at vercel.com → the `oksy-portal` project → **Settings** → **Git** → **Deploy Hooks** → create one, name it "main", branch `main`, copy the URL it gives you.
   - Why: a new backup step (`.github/workflows/vercel-deploy-hook.yml`) calls this URL after every push to `main`, so a deploy still happens even if Vercel's own auto-deploy is ever skipped. Vercel never sees the URL printed anywhere; GitHub keeps it secret.
   - If skipped: the backup step prints a notice and does nothing — your normal push-triggers-Vercel flow still works by itself, this is just an extra safety net.

## Before each stage/sub-stage starts (prerequisites)

- **KASP and MEDISEP sample sheet links, robot read access, and the staff rule discussion** — needed before the KASP/MEDISEP "scheme fit" check (checking the engine actually fits those schemes' real data). Not needed for Stage 2's remaining sub-stages (2c–2f), which only use the 3 Private Health Insurance pilots.
  - What to send: a Google Sheets link to one real (or sample) KASP claims sheet and one MEDISEP claims sheet.
  - What to do: share each sheet with the robot's service account email (Claude can give you the exact address) with **Viewer** access only — never Editor, the robot must never be able to write to a hospital sheet.
  - The staff rule discussion: a short conversation with you (and Ali, if useful) about which of today's Private Health Insurance money/status rules change for KASP and MEDISEP, before Claude builds the scheme-specific rule rows.
  - Why: the engine is built scheme-agnostic, but it has only ever been tested against Private Health Insurance data; KASP/MEDISEP need their own sample before that work can start safely.
  - If skipped: no blocker for 2c–2f; this only blocks whichever future sub-stage starts the KASP/MEDISEP build-out (currently Stage 7+ in the plan).

## Until the end of the project

- **Paste `claude/reports/last-report.md` into the Claude Project chat after every report.** Claude no longer mirrors files to the Claude Project itself (that step was removed to avoid the repo and the Project drifting apart) — the repo is now the only source of truth, and the Project should hold only instructions plus a short, stable handoff pointer. Each time Claude finishes a report, open `claude/reports/last-report.md` on your Mac, copy it, and paste it into the Claude Project chat so the Project has a record too.
  - Why: keeps a readable history in the Claude Project without Claude having to keep two copies of working files in step.
  - If skipped: no functional harm (the repo file is still the truth), but the Claude Project's history of what happened falls behind.
