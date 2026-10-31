# Last report – 31-Oct-2026: plan for the rest of Stage 1 (1c, 1d, 1e)

**Status: the plan is ready for your approval. Nothing is built yet.** Full plan: `claude/stage-plan.md`, "Detailed plan for 1c, 1d, 1e".

## Sub-stages
| Order | Sub-stage | Prompts | Migration (each needs your OK before live) |
|---|---|---|---|
| 1 | **1c** – fix the database history so a fresh copy rebuilds; restore 7 missing live tables the code uses; drift check script; verify security rules; `/hospitals` gate test; change-log test; bulk upload preview; Balance Status test | 2 | `reconcile_live_schema` |
| 2 | **1d** – claim identity (claim no + admission + discharge date), claim history in `change_log` with lane and reason, record source, Scheme → Insurer → TPA list, unused-table list | 2 | `claim_identity_history_source` |
| 3 | **1e** – run time, API calls and quota per sheet; Drive modified-time test | 1 | none |

## Design review (all applied unless marked open)
- Must: claims still in hospital (no discharge date yet) keep their record when the date is filled in.
- Must: two rows with the same claim in one sheet are merged before saving; the save would fail otherwise.
- Must: the restored tables get security rules for today's roles and ticks, not the old ones.
- Must: the lane tag goes in the existing `change_log.actor` column, named after decisions section 9.
- Should (applied): tests for same IP number / same patient twice / KASP Dialysis repeats; API calls and quota in 1e; one browser edit by you in the 1e test.
- Could (applied): no two-part column now; Stage 2 decides.
- Open: Should 5 and Could 11 (questions 1 and 2 below).
- Not applied: Should 6 (the reviewer thought Docker is missing; it runs on this Mac).

## Questions (yes/no)
1. **Raw sheet copies (`snapshots`) hold patient data on every run. Save a copy only when the sheet changed, and keep copies 12 months?** Why: limits stored patient data and storage at 130 hospitals. Recommended: yes.
2. **Two separate migrations (1c, then 1d) instead of one combined?** Why: the 1c one is needed first (a real write run fails today) and is easier to review alone. Recommended: yes, keep separate.
3. **Do not create these 4 old tables on live and treat them as retired: `hospital_aliases` (replaced by other names), `golden_tests`, `discount`, `import_runs`?** Why: no code needs them; the code still naming them is changed. Recommended: yes.

## Commits
- `86e89e5` 1b-ii migration applied to live as `20261030200918`
- `9a9661d` drift notes
- this commit: `docs: plan Stage 1 (1c, 1d, 1e)`

## Next
Your approval (and answers 1–3), then `/build-substage 1c`.
