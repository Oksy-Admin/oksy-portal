# claude/my-tasks.md – Anoop's tasks

Plain English. Read this before `handoff.md`'s "Waiting on Anoop" list tells you to look here. `/plan-stage` and `/build-substage` check the "Before each stage/sub-stage starts" section below before starting work; if something there is open for the sub-stage about to run, Claude stops and tells you instead of starting.

## Do now

Do these in order — each one unblocks the next.

1. **OK the 2e migration SQL, then apply it to live** (rule trial and check sets, 1-Nov-2026).
   - What: `supabase/migrations/20261101140000_rule_trials_check_sets.sql` — two new tables (`rule_trials`, `check_set_claims`) and three functions (`approve_rule_trial`, `pick_check_set_claim`, `accept_check_set_claim`). Tested locally (`bash scripts/db-test-local.sh`): all migrations replay, all pgTAP tests pass, including new test 18.
   - What to do: take a backup first (same pattern as the four earlier Stage 2 migrations), review the SQL, then apply it to the live Supabase project.
   - Why: 2f (pilot trial on live) needs `rule_trials` and `check_set_claims` to exist live before it can run.
   - If skipped: 2e's code is already built and tested locally; only the live hospital pages can't use it yet.

2. **Add the GitHub secret `VERCEL_DEPLOY_HOOK_URL`**
   - App: vercel.com, then your web browser signed in to GitHub.
   - Vercel first: `oksy-portal` project → **Settings** → **Git** → **Deploy Hooks** → create a **new** hook named "main", branch `main`, copy the URL it gives you. If an old hook is listed there from before, **delete ("revoke") it** so only the new one can be used — an old hook left lying around is a URL that still triggers a deploy for anyone who has it.
   - GitHub: go to `https://github.com/Oksy-Admin/oksy-portal` → **Settings** tab → **Secrets and variables** (left sidebar) → **Actions** → green **New repository secret** button. Name = `VERCEL_DEPLOY_HOOK_URL`. Value = the URL you just copied.
   - Why: a backup step (`.github/workflows/vercel-deploy-hook.yml`) calls this URL after every push to `main`, so a deploy still happens even if Vercel's own auto-deploy is ever skipped. Vercel never sees the URL printed anywhere; GitHub keeps it secret.
   - If skipped: the backup step prints a notice and does nothing — your normal push-triggers-Vercel flow still works by itself, this is just an extra safety net.

3. **`git push origin main`, then check the deployment**
   - App: Mac Terminal, in the `~/Projects/oksy-portal` folder.
   - Exact text: `git push origin main`.
   - What it sends: the Stage 2 planning commits already on `main`, plus this housekeeping pass's two `main` commits (the deploy-hook Action file, and the `apps/web/vercel.json` fix that was silently blocking auto-deploy).
   - What to check afterwards: on vercel.com, the `oksy-portal` project's **Deployments** tab should show a new production deployment starting for this push within a minute or two (that also proves the `vercel.json` fix worked). On github.com, the **Actions** tab should show the "Vercel deploy hook" workflow run green (that proves the new secret works).
   - Why: nothing after this point in the project reaches the live site until `main` is pushed; it also gives you the first real proof the deploy-hook fix works.
   - If skipped: everything below still works locally, but the live site stays on its last pushed commit.

4. **KASP and MEDISEP sample sheet links, robot read access, and the staff rule discussion**
   - What to send: a Google Sheets link to one real (or sample) KASP claims sheet and one MEDISEP claims sheet.
   - What to do: share each sheet with the robot's service account email (Claude can give you the exact address) with **Viewer** access only — never Editor, the robot must never be able to write to a hospital sheet.
   - The staff rule list: a short conversation with you (and Ali, if useful) about which of today's Private Health Insurance money/status rules change for KASP and MEDISEP, before Claude builds the scheme-specific rule rows.
   - Why: the engine is built scheme-agnostic, but it has only ever been tested against Private Health Insurance data; KASP/MEDISEP need their own sample before that work starts safely. Doing it now (rather than waiting) means 2c and the KASP/MEDISEP build-out never block each other later.
   - If skipped: 2c still runs on the 3 Private Health Insurance pilots; this only blocks the KASP/MEDISEP build-out.

5. **Add `ANTHROPIC_API_KEY` to the web app's own environment** (2d, 1-Nov-2026).
   - What: the Rule Library page's plain-words box needs the same Anthropic key the worker already uses, but in `apps/web`'s own environment, not only the worker's.
   - App: Mac Terminal (`apps/web/.env.local`, same value as the worker's `ANTHROPIC_API_KEY` line) and vercel.com (`oksy-portal` project → **Settings** → **Environment Variables** → add `ANTHROPIC_API_KEY` with the same value).
   - Also add the line `ANTHROPIC_API_KEY=` to `.env.example` yourself — this session's permission settings blocked editing that file directly.
   - Why: without it, the plain-words box shows "needs ANTHROPIC_API_KEY added to the web app's environment" and nothing else on the page is affected.
   - If skipped: everything else on the Rule Library page still works; only the plain-words box is unavailable.

## Before each stage/sub-stage starts (prerequisites)

(none currently open)

## Until the end of the project

- **After every report, tell the Claude chat "report ready".** Claude no longer mirrors files to the Claude Project itself (that step was removed to avoid the repo and the Project drifting apart) — the repo is now the only source of truth, and the Project should hold only instructions plus a short, stable handoff pointer. The chat reads `claude/reports/last-report.md` straight from your Mac through the computer link, so typing "report ready" is normally enough; paste the file's contents yourself only if that chat is not linked to this computer.
  - Why: keeps a readable history in the Claude Project without Claude having to keep two copies of working files in step.
  - If skipped: no functional harm (the repo file is still the truth), but the Claude Project's history of what happened falls behind.
