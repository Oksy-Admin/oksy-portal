# claude/my-tasks.md – Anoop's tasks

Plain English. Read this before `handoff.md`'s "Waiting on Anoop" list tells you to look here. `/plan-stage` and `/build-substage` check the "Before each stage/sub-stage starts" section below before starting work; if something there is open for the sub-stage about to run, Claude stops and tells you instead of starting.

## Do now

Do these in order — each one unblocks the next.

1. **Add the GitHub secret `VERCEL_DEPLOY_HOOK_URL`**
   - App: vercel.com, then your web browser signed in to GitHub.
   - Vercel first: `oksy-portal` project → **Settings** → **Git** → **Deploy Hooks** → create a **new** hook named "main", branch `main`, copy the URL it gives you. If an old hook is listed there from before, **delete ("revoke") it** so only the new one can be used — an old hook left lying around is a URL that still triggers a deploy for anyone who has it.
   - GitHub: go to `https://github.com/Oksy-Admin/oksy-portal` → **Settings** tab → **Secrets and variables** (left sidebar) → **Actions** → green **New repository secret** button. Name = `VERCEL_DEPLOY_HOOK_URL`. Value = the URL you just copied.
   - Why: a backup step (`.github/workflows/vercel-deploy-hook.yml`) calls this URL after every push to `main`, so a deploy still happens even if Vercel's own auto-deploy is ever skipped. Vercel never sees the URL printed anywhere; GitHub keeps it secret.
   - If skipped: the backup step prints a notice and does nothing — your normal push-triggers-Vercel flow still works by itself, this is just an extra safety net.

2. **`git push origin main`, then check the deployment**
   - App: Mac Terminal, in the `~/Projects/oksy-portal` folder.
   - Exact text: `git push origin main`.
   - What it sends: the Stage 2 planning commits already on `main`, plus this housekeeping pass's two `main` commits (the deploy-hook Action file, and the `apps/web/vercel.json` fix that was silently blocking auto-deploy).
   - What to check afterwards: on vercel.com, the `oksy-portal` project's **Deployments** tab should show a new production deployment starting for this push within a minute or two (that also proves the `vercel.json` fix worked). On github.com, the **Actions** tab should show the "Vercel deploy hook" workflow run green (that proves the new secret works).
   - Why: nothing after this point in the project reaches the live site until `main` is pushed; it also gives you the first real proof the deploy-hook fix works.
   - If skipped: everything below still works locally, but the live site stays on its last pushed commit.

3. **OK the two Stage 2 migrations**
   - What: two SQL files are ready and already tested on a throwaway copy of the database: `supabase/migrations/20261031060500_rule_engine_data.sql` (the Rule Library) and `supabase/migrations/20261031070000_dictionary_entries.sql` (the Words & Names dictionary).
   - Where: ask Claude Code in the terminal to show you both files, or open them yourself in Finder → `~/Projects/oksy-portal/supabase/migrations/` with any text editor.
   - What to do: once you've looked them over (or you're happy to trust the local test pass), tell Claude "OK to apply 20261031060500" and "OK to apply 20261031070000" — each is applied separately, with a backup taken first.
   - Why: nothing in the Rule Library or the Words & Names page works on the real (live) database until these two are applied. Everything so far has only run on a local test copy.
   - If skipped: Stage 2 stays stuck on your Mac and the Vercel preview; it never reaches the real site.

4. **KASP and MEDISEP sample sheet links, robot read access, and the staff rule discussion**
   - What to send: a Google Sheets link to one real (or sample) KASP claims sheet and one MEDISEP claims sheet.
   - What to do: share each sheet with the robot's service account email (Claude can give you the exact address) with **Viewer** access only — never Editor, the robot must never be able to write to a hospital sheet.
   - The staff rule list: a short conversation with you (and Ali, if useful) about which of today's Private Health Insurance money/status rules change for KASP and MEDISEP, before Claude builds the scheme-specific rule rows.
   - Why: the engine is built scheme-agnostic, but it has only ever been tested against Private Health Insurance data; KASP/MEDISEP need their own sample before that work starts safely. Doing it now (rather than waiting) means 2c and the KASP/MEDISEP build-out never block each other later.
   - If skipped: 2c still runs on the 3 Private Health Insurance pilots; this only blocks the KASP/MEDISEP build-out.

5. **`/clear`, then `/build-substage 2c`**
   - What: in the Claude Code terminal, type `/clear` (starts a fresh session so Claude isn't carrying this whole housekeeping conversation into the build), then type `/build-substage 2c`.
   - Why: this is the next piece of Stage 2 (claim checks, two-part approvals, "value is correct") — it only starts once steps 1–4 above are done.

## Before each stage/sub-stage starts (prerequisites)

(none currently open)

## Until the end of the project

- **After every report, tell the Claude chat "report ready".** Claude no longer mirrors files to the Claude Project itself (that step was removed to avoid the repo and the Project drifting apart) — the repo is now the only source of truth, and the Project should hold only instructions plus a short, stable handoff pointer. The chat reads `claude/reports/last-report.md` straight from your Mac through the computer link, so typing "report ready" is normally enough; paste the file's contents yourself only if that chat is not linked to this computer.
  - Why: keeps a readable history in the Claude Project without Claude having to keep two copies of working files in step.
  - If skipped: no functional harm (the repo file is still the truth), but the Claude Project's history of what happened falls behind.
