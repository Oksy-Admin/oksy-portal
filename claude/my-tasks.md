# claude/my-tasks.md – Anoop's tasks

Plain English. Read this before `handoff.md`'s "Waiting on Anoop" list tells you to look here. `/plan-stage` and `/build-substage` check the "Before each stage/sub-stage starts" section below before starting work; if something there is open for the sub-stage about to run, Claude stops and tells you instead of starting.

## Already done (checked live 1-Nov-2026, read-only alignment check — no action needed)

- TDS header migration (`20261101150000`) and the DISCOUNT/MEMBER NUMBER column-mappings fix (`20261101160000`) — both applied to live.
- "Run now" (write) for all 3 pilots — claims written to Supabase for the first time (Badagara 495, Tree G 12, HMS 361 rows in `claims_staging`).
- `git push origin main` — `origin/main` already matches local HEAD (`f5aed44`); Vercel production deployment matches; the "Vercel deploy hook" GitHub Action ran green on that push.
- `ANTHROPIC_API_KEY` on Vercel production — already set (checked by name only, via Vercel MCP, no value read). The `.env.example` line is already committed.
  - Not checked: whether `apps/web/.env.local` on your Mac also has it (Claude's permission settings block reading `.env.local`) — add it there yourself if `pnpm dev`'s Rule Library plain-words box still says it's missing.

## Do now

Do these in order — each one unblocks the next.

1. **Approve the pilot trial, each of the 3 hospitals** — Trial page (`/hospitals/[code]/trial`) for Badagara, Tree G and HMS.
   - What to do: the page shows a per-rule summary (Errors, Warnings, claims hit, example rows). Pick up to 5 claims you know are correct as that hospital's check set (search by claim number), then click "Trial approved" once the summary looks right. If a rule looks wrong, say so instead of approving — Claude fixes it in the same or the reserve prompt.
   - Why: this is Stage 2's own done-criteria — "the trial summary is approved by Anoop for all 3 pilots; the check sets pass" — and it needs your eyes on real data, so Claude cannot do it for you. (Checked live 1-Nov: `rule_trials` and `check_set_claims` are still 0 rows — none of the 3 have been reviewed yet.)
   - If skipped: Stage 2 cannot close; 2f stays open.

2. **Confirm the pilot words and names** — Dictionary page.
   - What to do: confirm each suggested entry for Insurer, TPA, Doctor name and Department (word → standard value, once per word).
   - Why: 2b's own done-criteria; checked live 1-Nov: 250 entries are still SUGGESTED, 36 are already CONFIRMED.
   - If skipped: Stage 2 cannot close; 2f stays open.

3. **KASP and MEDISEP sample sheet links, robot read access, and the staff rule discussion**
   - What to send: a Google Sheets link to one real (or sample) KASP claims sheet and one MEDISEP claims sheet.
   - What to do: share each sheet with the robot's service account email (Claude can give you the exact address) with **Viewer** access only — never Editor, the robot must never be able to write to a hospital sheet.
   - The staff rule list: a short conversation with you (and Ali, if useful) about which of today's Private Health Insurance money/status rules change for KASP and MEDISEP, before Claude builds the scheme-specific rule rows.
   - Why: the engine is built scheme-agnostic, but it has only ever been tested against Private Health Insurance data; KASP/MEDISEP need their own sample before that work starts safely.
   - If skipped: 2c still runs on the 3 Private Health Insurance pilots; this only blocks the KASP/MEDISEP build-out.
   - **Timing (confirmed 1-Nov-2026): Anoop will share these on Monday 2-Nov-2026 — already discussed; do not chase before then.**

## Before each stage/sub-stage starts (prerequisites)

(none currently open)

## Until the end of the project

- **After every report, tell the Claude chat "report ready".** Claude no longer mirrors files to the Claude Project itself (that step was removed to avoid the repo and the Project drifting apart) — the repo is now the only source of truth, and the Project should hold only instructions plus a short, stable handoff pointer. The chat reads `claude/reports/last-report.md` straight from your Mac through the computer link, so typing "report ready" is normally enough; paste the file's contents yourself only if that chat is not linked to this computer.
  - Why: keeps a readable history in the Claude Project without Claude having to keep two copies of working files in step.
  - If skipped: no functional harm (the repo file is still the truth), but the Claude Project's history of what happened falls behind.
