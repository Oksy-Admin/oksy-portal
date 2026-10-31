# Last report – 31-Oct-2026: 1e done – Stage 1 sub-stages all done

**Status: 1e is done. All Stage 1 sub-stages are done, and their migrations are on live with zero drift. Not pushed.**

## Drive modified-time test (TEST sheet, Question Sheets drive; now in the trash)
1. Robot typed a value (API): did NOT move within ~75 s.
2. Robot formatting only: did NOT move.
3. Robot formula `=NOW()` + "recalculate every minute": moved (may include steps 1–2 arriving late).
4. Nobody edits, `=NOW()` recalculates by itself (3 min): did NOT move.
5. Your browser edit (admin@oksy.in, ~15:10 IST): moved to 15:09:46 IST, within seconds.
- **Recorded decision:** the modified time does not move reliably after a value change, so every run reads the full sheet. Change detection stays off until proven.

## Run time per sheet (3 runs each, nothing written)
- Badagara: about 4.9–7.0 s; Tree G: about 2.0–2.7 s; HMS: about 4.1–5.3 s.
- 3 Sheets API calls per sheet. 130 sheets ≈ 390 calls and roughly 10–15 minutes.
- All three stop at "layout" (headers still to decide), so claim writing is not in these numbers.

## Found and fixed
- The worker key could not read the field list on live, so every real sheet run failed. This was the cause of the failed runs on 29-Oct.
- Fixed by migration `20261031055948` (applied with your OK; backup first; zero drift after).

## For you
- `apps/web/.env.local`: `GOOGLE_QUESTION_SHEETS_FOLDER_ID` ends with a typed `\n`. Remove those 2 characters before Stage 4 (Question Sheets).
- While checking that, one search of mine showed that `.env.local` line (the folder ID only, not a key) in my session. It should not have; nothing else from the file was shown.

## Commits since the last report
- `7e3973c` measure-runs script
- `6cdd2d4`, `06802f1` worker rights migration (live as `20261031055948`)
- `b7e936e` Drive modified-time test script
- `docs: close Stage 1e` (this close)

## Left to close Stage 1
1. **Code review:** the code-reviewer agent on everything not yet pushed (`origin/main..HEAD`, 53+ commits). I fix every "Must" finding and list the rest. One prompt.
2. **Your decision:** `district_heads` and `open_checks`. Keep them (for a future register import) or remove them (needs a migration).
3. **Your push** (after 1 and 2): in the Mac Terminal, type `cd ~/Projects/oksy-portal`, then `git push`. Check that it ends without "error" or "rejected". Vercel then deploys the web app; the database is already up to date.
4. Mirror the updated docs to the Claude Project: `CLAUDE.md`, `handoff.md`, `claude/decisions.md`, `claude/stage-plan.md`.
