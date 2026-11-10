# Report — 10-Nov-2026 dictionary decisions recorded; CONFIRM rows blocked

## Status: blocked (decisions recorded; nothing written to the live dictionary yet)

## What changed
- `claude/decisions.md`: added section "18. Dictionary decisions (10-Nov-2026)" (index table updated, "Last updated" line updated) recording Anoop's a-h decisions from `dictionary-actions-2026-11-10.xlsx`, plus the directory-file comparison and the apply blocker (below).
- `claude/my-tasks.md`: item 3 ("Confirm the pilot words and names") updated with a 10-Nov note: 158 of the 250 entries now have a decision (119 CONFIRM / 19 STANDALONE / 20 HOLD) but the 119 CONFIRM rows are not yet applied; doctor names (74 entries) still untouched.
- `claude/reports/backup-dictionary-entries-2026-11-10.csv`: full export of `dictionary_entries` (286 rows, all kinds/statuses), taken before any change — the required backup.
- No code, migration, or live data touched.

## Directory file comparison (asked for first)
`India_Healthcare_Directory_updated.xlsx` vs the original `India_Healthcare_Directory.xlsx`:
- Both have the same 76 departments / 39 insurers / 21 TPAs, and the **"Standardized ... Name" columns Anoop's CONFIRM rows use are identical** between the two files — so this doesn't change which CONFIRM rows apply or their values.
- But the "updated" file **dropped columns**: Other Names/Aliases, Status (Active/Hidden) and Notes/To verify on all three sheets, and IRDAI Registration No. + Validity on the TPA sheet.
- The Insurance Companies sheet's Hardcopy Required column, blank in the original, is now **"NO" for all 39 insurers** in the updated file. Your own open task list still has "Fill Hardcopy Required per insurer" as unconfirmed, so this looks like a placeholder/export artifact, not a real decision — **I have not treated it as confirmed.** Flagged in decisions.md section 18; the original file stays the source for aliases, notes, registration numbers and Hardcopy Required until you tell me the "NO" fill is real.

## Blocked: Step 3, the 119 CONFIRM rows
`decide_dictionary_entry()` and `bulk_confirm_dictionary()` are SECURITY DEFINER functions gated on `private.has_tick('hospitals_add_edit')`, which resolves through `auth.uid()` — only ever set inside a real signed-in web-app session (decisions.md section 14: Supabase MCP is read-only by design). Checked live, read-only, 10-Nov: the SQL connection available to me can't even run `private.current_app_role()` ("permission denied for function"), and a direct `decide_dictionary_entry(...)` call was separately refused by the write guard. So I cannot apply these from a script, exactly the case you told me to stop on. Options, cheapest first:

1. **You confirm them yourself on the Dictionary page (recommended for today — zero new code).** No bulk-confirm exists yet for Insurer/TPA/Department (only status words and doctor names have it), so it's 119 individual clicks, each already carrying the right standard value as a pre-filled suggestion since your spelling matches. Cost: 0 prompts, your time only.
2. **Browser-automate it against your own signed-in session.** You sign into the portal once in Chrome; I drive the 119 confirm clicks through the real Dictionary page using Claude in Chrome, so the write still goes through your real Owner session and the same audited function — just faster. Cost: 0 new-code prompts, but needs you present (or at least signed in) while it runs, and you should spot-check a sample afterwards.
3. **Build a one-time bulk-confirm path for these three kinds** (a migration extending `bulk_confirm_dictionary` to match against an uploaded file instead of "another hospital already confirmed it", plus a small UI hook). Out of this task's scope ("do not build any new feature") and needs your OK on the migration SQL anyway — only worth it if you expect more CONFIRM batches like this one later. Cost: ~2 prompts.

I did not pick one — tell me which.

## Decisions needed (report only, as asked — Step 4)

**(i) NORKA pair rule** (one spelling → TPA + insurer together, not a simple swap):
1. *Recommended.* A small hard-coded pair map in `packages/rules` (2 entries: NORKA Care → Vidal + New India; NORKA Care Plus → Vidal + United India) applied by a new rule next to `HMS-TPA-IS-INSURER`. Cost: ~1 prompt.
2. A data-driven "spelling pair" extension to `dictionary_entries` (new kind or columns) so future pairs don't need code. Cost: ~2-3 prompts; more general, not needed for just 2 known pairs.
3. No automation — route "norkacare"/"norkacareplus"/"norka" to the Question Sheet every time, filled by hand. Cost: 0 prompts, ongoing manual work forever.

**(ii) Hospital-level default department** (Tree G = Ophthalmology always):
1. *Recommended.* A `hospital_profile_facts` column (e.g. `default_department`), set for Tree G; `clean.ts` fills department from it when the field is blank/unrecognized. Cost: ~1 prompt (migration + rule + tests).
2. Apply only at report time (department shown as Ophthalmology on Tree G's reports, never stored in cleaned data). Weaker: Rule Library/Trial/AI suggestions still see it as missing. Cost: ~1 prompt, less useful.
3. No automation — keep asking per claim. Cost: 0 prompts, ongoing manual work.

**(iii) Standalone TPA cells** (19 rows, TPA cell actually holds an insurer name):
1. *Recommended.* Confirm each as an ordinary TPA entry whose standard_value is the matching INSURER's own standard name (not the literal "No TPA") — reuses the live `tpa_cell_may_hold_insurer` swap exactly as built for HMS 25-Oct. Where your note names the insurer (oriental, reliance/relaince family) I'd use that; where it says "Insurer = ?" I'd use the same spelling's own CONFIRMED Insurer row already in this same file (tataaig, icicilombard, hdfcergo, nivabupa, starhealth, universalsompo, sbigeneral, bajajallianz, adityabirla, carehealth, cholams, futuregenerali all already have one). Cost: 0 new code — but only takes effect for a hospital with `tpa_cell_may_hold_insurer = true`, which today is HMS only; Badagara/Tree G would need that one-row fact confirmed too, or the TPA field just stores the insurer's legal name as text (mislabeled but not lost).
2. Make the swap unconditional (drop the per-hospital flag, always apply when a TPA cell's text matches a confirmed insurer). Cost: ~1-2 prompts (migration + `clean.ts` change); applies to all 3 pilots immediately, but changes behaviour for any hospital that genuinely has no TPA concept without an explicit per-hospital confirmation first.
3. Leave all 19 SUGGESTED, untouched, until you decide. Cost: 0 prompts; TPA-holds-insurer cases outside HMS stay as today.

Tell me your pick for each of (i)/(ii)/(iii) and for the Step-3 apply blocker, and I'll build/apply in the next prompt.

## Verified
- `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass (no code was touched; run to confirm nothing broke).
- `git status --short` shows only `claude/decisions.md`, `claude/my-tasks.md`, the two new reference `.xlsx` files, `claude/reports/backup-dictionary-entries-2026-11-10.csv` and this report — nothing else touched. No migration, no `.env`, no live write.

## Commit
Pending: `docs: record 10-Nov-2026 dictionary decisions`. Not pushed (per instructions).
