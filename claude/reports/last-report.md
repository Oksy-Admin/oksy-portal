# Status check: local / GitHub / Supabase / Vercel (1-Nov-2026)

Read-only alignment check. No code changed; no migration applied; nothing pushed (it was already pushed). Docs updated to match verified facts.

## Anoop must do now

1. **Approve the pilot trial, each of the 3 hospitals.** App: the portal, each hospital's Trial page (`/hospitals/[code]/trial`) for Badagara, Tree G, HMS. What: review the per-rule summary, pick up to 5 known-correct claims as the check set (search by claim number), click "Trial approved". For: Stage 2's own done-criteria — needs your eyes on real data, Claude can't do it. If skipped: Stage 2 stays open (`rule_trials` and `check_set_claims` are still 0 rows live, checked today).
2. **Confirm the Dictionary entries.** App: the portal, Dictionary page. What: confirm each suggested Insurer/TPA/Doctor/Department word → standard value. For: 2b's done-criteria. If skipped: Stage 2 stays open (250 still SUGGESTED, 36 already CONFIRMED).
3. **Nothing else is blocking.** `git push` is not needed — `origin/main` already matches local HEAD and Vercel production. `ANTHROPIC_API_KEY` is already set on Vercel. KASP/MEDISEP sheets are due Monday 2-Nov-2026 — not yet, don't send today.

## Alignment table

| Item | Local | GitHub | Supabase live | Vercel live |
|---|---|---|---|---|
| Commit / migration | `f5aed44` (main, clean) | `origin/main` = `f5aed44` ✔ | migrations through `20261101160000` ✔ | production deployment = `f5aed44` ✔ |
| Branch `stage-2-rule-library` | fully merged into `main` ✔ | `origin/stage-2-rule-library` = `d830eaf`, merged (ancestor check) ✔ | n/a | last preview deployment = `d830eaf` ✔ |
| Deploy hook (GitHub Action) | — | latest run: success, 16s ✔ | — | — |
| `git user.email` | `admin@oksy.in` ✔ | — | — | — |

Everything lines up. The one real gap found was **Supabase was ahead of the docs**: `CLAUDE.md`/`handoff.md`/`my-tasks.md` still said the TDS migration (`20261101150000`) was unapplied and the pilot trial hadn't started — live data shows both migrations applied and all 3 pilots already have claims written (`claims_staging`: Badagara 495, Tree G 12, HMS 361 rows; 3 successful "Run now" WRITE jobs today). Docs are now corrected to match.

## Decision needed

1. **`MEMBER NUMBER` conflict between `decisions.md` and live.** `decisions.md` §5's "Five more pilot headers" table says MEMBER NUMBER → Ignore; but the live `header_decisions` row for Badagara and the 1-Nov pilot-fix (migration `20261101160000`) both have it decided as `policy_or_card_no`. One of the two is stale. Recommend: correct `decisions.md` §5 to `policy_or_card_no` (matches live and the deliberate fix) — **yes/no?**
2. **No backup file found for the two just-applied migrations.** Every earlier migration has a matching `pg_dump` in `supabase/.temp/backup_before_<version>_*.sql`; none exists yet for `20261101150000` or `20261101160000`. Both are low-risk (data-only `UPDATE`s, no deletes), but the SOP says backup-first. Recommend: confirm you took one some other way (Supabase dashboard snapshot, manual dump) — **yes it's covered / no, take one now?**
