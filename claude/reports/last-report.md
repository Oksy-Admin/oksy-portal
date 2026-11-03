# Report — KASP/MEDISEP decisions recorded (3-Nov-2026)

## Status: done

## What changed
- `claude/decisions.md`: added new section "17. KASP and MEDISEP (3-Nov-2026)" (after section 16, before section 15) recording:
  - case number as the only unique key for KASP/MEDISEP (Private keeps its own rule); generated at pre-auth, stays the same through settlement and any later grievance, including a rejected pre-auth.
  - case number is 15+ digits and must always be kept as text (sheet, Excel/CSV, database).
  - TDS for KASP/MEDISEP = 10% of approval amount, paid claims only, calculated in the statement/report only, never written into cleaned claim data.
  - KASP Google Sheets cover up to discharge only; approval/settlement/payment/status come only from TMS or DPC Excel.
  - TMS 2 is the newer version of TMS 1; TMS 2 lacks admission/discharge dates (looked up from the hospital sheet by case number); RF Amount in TMS reports is ignored.
  - dialysis sheet columns 1-12 (session dates) are used only to count sessions, not shown in the final report.
  - source trust (TMS 2/DPC most trusted, Google Sheet values may be wrong by desk staff), file coverage (TMS 2 = one hospital, DPC = one or ~5 hospitals), and the full-history-kept-with-source rule.
  - listed as **open, not decided**: TMS 1 master Excel location, TMS1→TMS2 switch date, exact case-number digit count, pre-auth vs admission date tolerance, who uploads TMS 2/DPC files and how often.
  - Section index table updated with the new row; "Last updated" line on the file updated to 3-Nov-2026.
- `claude/insurance-glossary.md`: added short entries for **TMS 1**, **TMS 2**, **DPC (District Project Coordinator)**, **Case number (KASP/MEDISEP)**, **Pre-auth**, **Enhancement**, **Bioauth**, **Dialysis cycle** — each placed under its matching existing section (Schemes, Parties, Claim and money terms, Documents and dates).
- No code, migration, config, `.env`, `stage-plan.md` or `handoff.md` touched.

## Verified
- `grep -n "## 17\. KASP\|17 | KASP" claude/decisions.md` shows both the section index row and the section heading.
- `grep` confirms all eight new glossary terms are present.
- `git status --short` shows only `claude/decisions.md` and `claude/insurance-glossary.md` modified (plus this report) — nothing else touched.

## Decisions needed from Anoop
None — this was a docs-only recording task. The five open items listed in section 17 ("Open") still need Anoop's answer before any KASP/MEDISEP TMS-import build work can use them.

## Commit
Not yet committed — one commit pending: `docs: record 3-Nov-2026 KASP/MEDISEP decisions`. Not pushed (per instructions).
