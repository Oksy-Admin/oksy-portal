# Decisions – Superseded (archived)

Moved out of `claude/decisions.md` section 15 on 31-Oct-2026 (housekeeping), to keep the live decisions file short. These are old decisions that no longer apply; each row shows what replaced it. Never act on anything in this file — check `claude/decisions.md` for what is valid now.

| Old decision | Replaced by |
|---|---|
| Pilot = HMS only (26-Oct) | 3 pilots (section 4) |
| Hospital other names in a `hospital_aliases` table | `other_names` column (section 4) |
| "Congratulations, your sheet is clean" message / checkbox | Status line (section 11) |
| 7-page portal (v2 section 2) | 4 main menus (section 13) |
| Runs at 6 AM and 6 PM | 6 AM only (section 10) |
| Run now at 5 levels (30-Oct evening) | 3 levels now; scheme levels later (section 10) |
| Stage plan 0–8 (v2 section 12) and Stage Playbook | New stage plan in `stage-plan.md` |
| First monthly report by 10-Nov-2026; critical path first | No build deadline (section 1) |
| Mapping approval per hospital + scheme + header layout; headers strict between months | Policy B + D (section 5) |
| Only Owner and Admin confirm mappings (migration 0027) | Owner, Admin, Users with Hospitals edit tick (section 5) |
| Replies to Anoop in Malayalam (26-Oct) | Replies in English, report also in `claude/reports/last-report.md` (section 14) |
| Room No and Room Category set to Ignore | ROOM CATEGORY → room_category (section 5) |
| Follow-up Remarks as its own column (v2 section 7) | All remark columns → one `remarks` field (section 5) |
| Two remark columns = "duplicate header" error | One `remarks` field (section 5) |
| Query Details as a clean-data column | Not needed (section 6) |
| Settlement Delay from discharge **or hardcopy** date (v2 section 7) | From discharge date only (section 8) |
| Dark cyberpunk UI concept | Light theme (section 13) |
| Global header approval with auto-approve (proposal v1) | Policy B + D (section 5) |
| Separate "Decision Inbox" page | "Needs your decision" list on Home (section 13) |
| Change log page deferred to Stage 6 | Change log required; verify in Stage 1 (stage-plan) |
| Vercel git deployments off | Git deployments ON |
| AI spending limit USD 20 | About USD 25 / INR 2,000 (section 10) |
| Anoop does git commit and push himself | Claude commits, Anoop pushes (section 14) |
| "Do not delete the untracked Docs/ folder" | Rule removed; `docs/` held only copies and is deleted (30-Oct night) |
| Old stage reports kept | Deleted; only the new file set is kept (30-Oct night) |
| Phase 1 critical path = Stages 2, 3, 4, 5, 7 | New stage plan (`stage-plan.md`) |
| Each sub-stage approved by Anoop before the next starts (27-Oct) | Stage-level approval (section 14, 31-Oct) |
| Push after each sub-stage | Push once per stage (section 14, 31-Oct) |
| TDS (amount column) → tds_amount_stated, with rules. TDS % column → Ignore (30-Oct, "7 headers" table) | TDS % column → Ignore kept only for a header literally named "TDS %"; a plain "TDS" header now maps to the new `tds` field (Badagara/Tree G) or to tds_amount_stated / "TDS Amount" (HMS) (section 5, 31-Oct) |
| Plain "TDS" next to "TDS AMOUNT" gets no stored decision; value-based auto-Ignore or the decision list handles it (31-Oct, same day) | Resolved per hospital: new `tds` field (Badagara/Tree G) or TDS Amount (HMS, pending a sheet check) (section 5, 31-Oct) |
