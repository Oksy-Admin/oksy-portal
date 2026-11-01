# Report – 1-Nov-2026 (Claims & Payments fix)

**Done:** Claims & Payments page now works for all 3 pilots (Hospital dropdown, live run status, duplicate-key bug fixed) and the 1-Nov decisions are recorded. **Investigated, not fixed** (outside this job's file scope): the top-bar "Run now (all hospitals)" bug that explains the 0-claims and empty-Trial-page questions.

## Decisions recorded (`claude/decisions.md`, dated 1-Nov-2026)
- Section 9: a value that doesn't match its column's field type or name is an Error or Warning; "value is correct" clears it (desk staff use formulas or write wrong data).
- Section 5: DOD → `discharge_date`; MEMBER NUMBER → Ignore; POLICY HOLDER NAME → `policy_holder_name`; MEMBER NAME → suggest `policy_holder_name` (needs confirmation); HARDCOPY SENT Date → `casesheet_sent_date`.

## Built (`claims/page.tsx`, `claims/run-now.tsx`, `claims/actions.ts`)
1. **Hospital dropdown** (All / each hospital) replaces the hard-coded HMS sheet key. Run now, Check only, the Tab dropdown and the claims list all follow it — `applyFilters`/`cleanFilters` already supported `f.hospital`, so the list/export side needed no change.
2. **Tab dropdown duplicate-key bug fixed.** The query now scopes to the selected hospital's spreadsheet(s) (or all linked sheets for "All") and de-duplicates by tab name. Confirmed live (read-only) that Badagara and HMS both have a tab literally named "CANCELLED" — that's the exact cause of the React error; de-duping collapses it to one option.
3. **Run status now live, no manual refresh.** `RunNow` polls the sheet's latest job every 3s while it's QUEUED/RUNNING and shows one line: "Finished.", "Stopped: N headers need a decision — open Column Mappings." (STOPPED_LAYOUT), "Stopped: the run's totals did not reconcile." (STOPPED_RECONCILIATION), or "Failed: `<reason>`." Buttons re-enable themselves the moment a run ends — previously they could only reflect the page's state at the last full load, so a finished run left the buttons looking stuck.

## Investigated (4a, 4b) — report only, not fixed
These live in `apps/web/app/(portal)/run-now.tsx` / `run-now-actions.ts`, outside this job's file scope (marked read-only in the prompt), so I did not touch them.

**4a — why the top-bar "Run now (all hospitals)" only ever created DRY_RUN jobs and Claims & Payments shows 0 claims:**
- `run-now-actions.ts` hard-codes `const STAGE3_MODE = "DRY_RUN"` with a comment dating to Stage 3, before the cleaning engine existed ("They write no clean data until the cleaning engine (Stage 4) is approved"). That constant was never updated when Stage 2 made the engine real. Every button that goes through `runNowAction` — the top-bar "Run now (all hospitals)", and the Hospitals page's per-hospital/per-sheet "Run sheet" buttons — is DRY_RUN only, regardless of which hospital. Confirmed live (read-only): all three jobs requested 1-Nov-2026 for the 3 pilots are `mode: "DRY_RUN"`.
- **The only button that can WRITE is the Claims page's own "Run now"** (`claims/actions.ts` → `runNow`, now fixed to work per-hospital above) — it reads `mode` from the form, not a hard-coded constant.
- **Does STOPPED_LAYOUT block the write? Yes, always.** `sheet-run.ts` computes `layoutProblems` (undecided headers), and if any exist, returns `result: "STOPPED_LAYOUT"` *before* the write step (`packages/worker/src/sheet-run.ts:462` returns immediately; the `writeRows` call is further down at line 466–469, never reached). Confirmed live: Badagara's and HMS's 1-Nov jobs both show `STOPPED_LAYOUT`, with the exact headers from today's new decisions above — Badagara needs DISCOUNT decided in its ULCC/PAID/PVT DAILYSIS tabs; HMS needs DOD, HARDCOPY SENT Date and PAYMENT FOLLOW UP DATE decided in its CANCELLED/sep 26/PAID/TILL AUG 2023 tabs. Tree G's DRY_RUN job `SUCCEEDED` (no layout problems) but, being DRY_RUN, intentionally never reached the write step either (`if (job.mode === "DRY_RUN") return base;`).
- **Net result:** `claims_staging` has 0 rows for all 3 pilots — not because of a bug in the write logic, but because no WRITE-mode job has ever reached the write step: two sheets are STOPPED_LAYOUT, and the only run that passed layout (Tree G) was DRY_RUN.
- **Not fixed:** changing `STAGE3_MODE` is a one-line, "small and clear" fix, but it sits in a read-only file for this job and affects pages/buttons beyond Claims & Payments (Hospitals page, top bar) — flagging for your OK rather than changing it silently.

**4b — why `/hospitals/[code]/trial` shows nothing:**
- Confirmed live: `rule_trials` is empty (0 rows) for all 3 hospitals — nobody has clicked "Run Trial" yet, because there was nothing to trial.
- Even if clicked, a trial reads from `claims_staging` (`rule-trial-runner.ts`), which is empty for the same reason as 4a. So two things have to happen first: (1) a WRITE run that gets past STOPPED_LAYOUT for Badagara and HMS (today's recorded header decisions should clear most/all of it, once applied in Column Mappings — DISCOUNT is already decided per section 5, so may just need the save to be re-applied / tabs re-read), and Tree G's existing successful read re-run in WRITE mode; then (2) clicking "Run Trial" on each hospital's Trial page.

## Anoop must do now
Everything already in `claude/my-tasks.md` is unchanged and still the path forward (items 1–5). Specifically for today's findings:
1. **Column Mappings:** apply today's 5 new header decisions (DOD, MEMBER NUMBER, POLICY HOLDER NAME, MEMBER NAME, HARDCOPY SENT Date) plus confirm DISCOUNT is actually saved for Badagara's ULCC/PAID/PVT DAILYSIS tabs and PAYMENT FOLLOW UP DATE for HMS's remaining tabs — these are exactly what's blocking Badagara's and HMS's write run (STOPPED_LAYOUT), confirmed live above.
2. **Run the pilot trial on live (my-tasks.md item 2):** on the Claims & Payments page, pick each hospital from the new dropdown and click "Run now" (not "Check only") for all 3. Tree G should write immediately; Badagara and HMS should write once step 1's headers are decided.
3. **Decision needed — the top-bar "Run now (all hospitals)" bug (4a above):** say if you want `STAGE3_MODE` in `run-now-actions.ts` changed from the Stage 3 hard-coded `DRY_RUN` to read the mode properly (small fix, but touches the top bar and Hospitals page buttons too — outside this job's scope, so not changed without your OK).
4. `scripts/check-setup.sh`: all PASS.

## Commits (branch `stage-2-rule-library`, not pushed)
- `c41b516` docs: record 1-Nov pilot header and value-shape decisions
- `3da7b87` fix(claims): hospital dropdown, live run status, no duplicate tab keys

## Checks
`pnpm typecheck`, `pnpm lint`, `pnpm test` (410 tests), `pnpm build` all pass.
Duplicate-key fix verified against live data (Supabase MCP, read-only): Badagara and HMS both have a tab named "CANCELLED" in `sheet_tabs`; the new de-dup-by-tab-name logic collapses the live tab list to 12 unique options with no repeats. A full logged-in Playwright run wasn't done — there's no `/dev/claims` fixture page (all existing e2e specs run against auth-free `/dev/*` fixtures) and faking an Owner/Admin session was outside this job's scope; verification instead used the live (read-only) data above plus the passing build/typecheck/lint/test suite.

## Next
Tell Claude once step 1 and 2 above are done, or once you've decided on point 3. Tell the Claude chat "report ready".
