# Stage 3 report – Reading sheets

Date: 27-Oct-2026. Scope: tab discovery, column mapping with AI (confirmed once), non-data rows, Run now at three levels. No Stage 4 work started. Status: **DONE – awaiting Anoop's approval.**

## 1. What changed and why
- **Tab discovery** (requirements v2 section 5). Every run lists the sheet's tabs (one metadata call). Tabs named like a month (`OCT 2026`, `SEP-2026`, `OCTOBER 2026`, `sep 26`) are month tabs. A month after the current month is a pre-made future tab and waits. Every other tab is a helper tab: DENY, never read. For month tabs the robot reads rows 1 to 10 only, to find the header. A month tab whose header matches a layout a person confirmed becomes ALLOW on its own; a different header waits for a person. A person's own decision on a tab (Sheet tabs page) is never changed by the robot.
- **Column mapping, confirmed once.** The alias list maps the usual headers. For the columns it cannot map, the AI (Claude, model `claude-opus-5-5`, low effort) proposes a field from the header text, its position, its neighbours, and the shape of the cells (how many look like dates, numbers, text or `#VALUE!`). **The AI never sees a cell value**, so no patient data leaves the portal, and it cannot guess or change a UTR, date or amount; it only proposes which field a column is. AI proposals are stored as PROPOSED with confidence 80% or less. A sheet's data is read only after a person confirms the whole layout once ("Approve All Proposed" on Column Mappings). That one confirmation covers every month tab with the same header. A half-confirmed layout does not count.
- **Non-data rows.** Rows with only a serial number, or a serial number plus a formula value such as 0 in LOS, are classed NON_DATA_ROW and skipped. Each run now reports `rows: {read, nonData, data}`.
- **Run now at three levels** (requirements v2 section 4). Top bar: all hospitals. Hospitals row: one hospital. Each scheme sheet: one sheet ("Run sheet"). The buttons show "Running" while a run is queued or running. One sheet uses `request_sheet_run` (unchanged). All / one hospital use the new `request_runs`, which calls `request_sheet_run` for each sheet, so the same approved-user gate and one-run-per-sheet check apply. This was needed because a User without the Hospitals tick cannot list the sheets.
- **Stage 3 runs are read-only for clean data** (Anoop, 27-Oct-2026): Run now queues `DRY_RUN`. The run stores tabs, snapshot, mapping proposals and checks; no `claims_staging` rows until Stage 4 is approved.
- **Read-only on hospital sheets.** All Google calls are on the read path (`LIST_TABS`, `READ_TAB`); nothing writes to a hospital sheet.

## 2. Database change
- `supabase/migrations/20261027000026_stage3_ai_mapping_run_scopes.sql`: allows method `AI` on `column_mappings`; adds `request_runs(scope, hospital, mode)` and `active_sheet_runs()`. `request_sheet_run` is not changed.
- Backup before applying: `supabase/.temp/backup_before_0026_20261027.sql` (git-ignored). This is a targeted backup with the before-state and a rollback script, because a full `supabase db dump` needs a CLI login. The affected tables were empty.
- Anoop approved, then applied to live 27-Oct-2026. Recorded on live as version `20261027110411` (name `stage3_ai_mapping_run_scopes`). Checked: constraint includes AI; `request_sheet_run` definition unchanged (same md5 before and after); `authenticated` can execute the new functions, `anon` cannot.

## 3. Files changed
| File | Change |
|---|---|
| `packages/rules/src/tabs.ts` (new) | Month tab names, future and helper tabs |
| `packages/rules/src/mapping.ts`, `index.ts` | `CANONICAL_FIELDS` list; mapping method `AI` |
| `packages/google/src/read.ts` | `readHeaderRows`: rows 1 to 10 of named tabs; refuses credential-like tabs before any call |
| `packages/worker/src/discovery.ts` (new) | Tab discovery, auto ALLOW on a confirmed header, layout proposals |
| `packages/worker/src/ai-mapping.ts` (new) | AI suggestions (counts and headers only), safety filter, Claude call |
| `packages/worker/src/sheet-run.ts` | Uses discovery; reads data only through a confirmed mapping; reports rows read / non-data / data |
| `packages/worker/src/runner.ts`, `multi-sheet-runner.ts` | Pass the AI suggester (only when `ANTHROPIC_API_KEY` is set) |
| `packages/worker/package.json`, `pnpm-lock.yaml` | `@anthropic-ai/sdk` 1.3.0 (exact) |
| `apps/web/app/(portal)/run-now-actions.ts`, `run-now.tsx` (new) | Run now action and button for the three levels |
| `apps/web/app/(portal)/layout.tsx` | Top bar Run now (all hospitals) |
| `apps/web/app/(portal)/hospitals/page.tsx`, `hospital-table.tsx` | Real Run now per hospital (was an `alert()`) and per sheet; "Running" state |
| `supabase/migrations/20261027000026_stage3_ai_mapping_run_scopes.sql` (new) | See section 2 |
| Tests: `packages/rules/test/tabs.test.ts`, `packages/worker/test/discovery.test.ts`, `ai-mapping.test.ts` (new); `sheet-run.test.ts`, `packages/google/test/read.test.ts` (updated) | Fake data only |

Suggested commits (Anoop commits from his Mac): (1) `feat(rules): month tab discovery and AI mapping method`; (2) `feat(google): header probe for month tabs`; (3) `feat(worker): tab discovery, one-time confirmed mapping, AI column suggestions`; (4) `feat(db): AI mapping method and Run now scopes (0026)`; (5) `feat(web): Run now for all, one hospital, one sheet`; (6) `docs: Stage 3 report, Stage 2 close-out, handoff`.

## 4. Checks
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: pass. `pnpm test`: pass (google 40, rules 94, worker 19, web 12 = 165). Secret scan: no leaks.
- Live run, 27-Oct-2026 (3 jobs, `DRY_RUN`, all SUCCEEDED, 8 to 18 s each):

| Pilot | Tabs | Month tabs found | Future (waits) | Helper (not read) | Layouts proposed (alias / AI columns) |
|---|---|---|---|---|---|
| HOSPPVTP0001 Badagara | 11 | OCT 2026, SEP 2026 | NOV 2026 | AUG PENDING, ULCC, PVT DAILYSIS, PAID, CANCELLED, TPA, DEPTS, ULCC TD PENDING | 2 (OCT 24/2, SEP 24/2) |
| HOSPPVTP0002 Tree G | 3 | OCT 2026, SEP 2026 | – | TPA LIST | 1 (OCT 25/1; SEP has the same header) |
| HOSPPVTP0003 HMS | 9 | OCTOBER 2026, sep 26 | – | PENDING, PAID, TPA LIST, TILL AUG 2023, CANCELLED, COLOURS, PORTAL LIST | 2 (OCT 24/2, SEP 24/2) |

- AI example: HMS `OCTOBER 2026` has the TPA header overwritten with an insurer name ("STAR HEALTH"); the AI proposed `tpa_name` for it, which is the case named in requirements v2 section 5. Blank serial header and `DEPARTMENTS` were also proposed correctly.
- Google calls in this run: read path only. Month tabs probed with 6 to 10 rows each; no helper tab and no PORTAL LIST was read.

## 5. Done-criteria check
| Criterion | Result |
|---|---|
| The three pilots' month tabs are found | **PASS** (table above) |
| Mapping is confirmed once per hospital and scheme | **Built; waiting for a person.** 5 layouts are proposed on Column Mappings. Confirming is Owner/Admin work ("Approve All Proposed"); I did not confirm on anyone's behalf. Then each month tab with that header is read on its own. |
| Serial-only rows are skipped | **PASS in tests** (serial-only and serial + LOS 0 rows are NON_DATA_ROW). On live this shows in `rows.nonData` on the first run after confirmation. |
| Each Run now level works (all, one hospital, one sheet) | **PASS at the database and runner**, as an approved User with no Admin role: one sheet queued; one hospital and all hospitals queued the other sheets; the runner processed all 3. Unapproved sign-in refused. The buttons were not clicked in a browser (needs a Google sign-in, which I do not do). |
| Only one run per sheet at a time | **PASS**: a second request for a queued sheet returns ALREADY_RUNNING (23505), also guarded by the unique index `jobs_one_active_per_sheet`. |
| Read-only on hospital sheets | **PASS** (`google_events`: read path only) |

## 6. Decisions still needed (Anoop)
1. **Status-named tabs.** PAID, PENDING, CANCELLED, AUG PENDING, ULCC, ULCC TD PENDING, PVT DAILYSIS, TILL AUG 2023 are treated as helper tabs and **not read**. Some may hold claims (the earlier HMS pilot read PAID and PENDING). Are any of them claim data? A person can set a tab to ALLOW on the Sheet tabs page and the robot respects it.
2. **Month-to-month header changes.** In Badagara and HMS the OCT and SEP headers differ slightly (DEPARTMENT / DEPARTMENTS, a blank serial header, the damaged TPA header), so each needs **2 confirmations**, not 1. Accept this (strict, as v2 says), or let near-identical headers count as the same layout?
3. **Who confirms mappings.** Today only Owner and Admin (database gate). Should a User with the Hospitals add/edit tick confirm too?
4. **Runner.** Run now only queues jobs; `pnpm worker` must be running to read them (today: by hand on Anoop's Mac). Scheduling is Stage 8; until then someone must start the runner.
5. **Claude API.** Monthly spending limit is still not set (handoff 9b). Each new header layout costs one small call (only headers and counts are sent).
6. **SDK version.** `@anthropic-ai/sdk` pinned at 1.3.0, released 23-Oct-2026 (4 days old). Keep or pin an older one?

Also noted, not changed: the Claims page "Run now" panel still points at the old HMS code (HOSP32P000107), and the "Check Access" button cannot work on Vercel (see the Stage 2 close-out).
