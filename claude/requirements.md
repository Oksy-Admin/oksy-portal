# Oksy Data Cleanse – Requirements

Single requirements file. It merges requirements v1 (26-Oct-2026), v2 (27-Oct-2026) and the 30-Oct-2026 decisions, and replaces all three.
Owner: Anoop Das (anoop@oksy.in). Last updated: 30-Oct-2026 night.

- `claude/decisions.md` holds every confirmed decision with its date. If this file and `decisions.md` differ, **`decisions.md` wins** and this file is corrected.
- Do not change the meaning of this file without Anoop's explicit approval.
- Stage order and status: `claude/stage-plan.md`. Field list: `claude/column-dictionary.md`. Terms: `claude/insurance-glossary.md`.

---

## 1. Background and problem

- Oksy Healthcare LLP gives health insurance claim support to private hospitals in Kerala. Oksy staff work at each hospital's insurance desk and record every insured patient's claim in Google Sheets.
- Oksy combines these sheets to analyse business performance, send monthly reports to hospitals, generate Oksy's invoices and run other business work.
- Staff do not keep the sheets properly and each hospital keeps them differently, so combining and cleaning has become a large task.
- Every month, before the 10th, every hospital must get an accurate claim report. Counts and totals are not enough: every detail of every claim must be correct (patient, dates, amounts, doctor, department, status, payments, UTR, TDS, balance). A wrong report cannot be sent; the same data feeds Oksy's invoices.

## 2. Goal and direction

1. Clean all hospital Google Sheets **every day** and keep one combined clean dataset in Supabase. The sheets are live and staff keep making the same mistakes, so this is a daily cycle, not a one-time job.
2. Keep a list of every rule created while cleaning. Give it to the developer of **Oksy Reports** (Oksy's separate website) so the same mistakes are blocked there, and give hospital staff an English "do not make these mistakes" guide.
3. From the clean data, design a uniform Google Sheet template per scheme. Later, data entry moves to Oksy Reports with the same columns.
4. **How we build:** improve the existing portal, do not rebuild it. Minimum clicks, minimum manual work, maximum automation; the backend does the heavy lifting. Quality over speed (no build deadline).
5. **Pilot first:** the 3 pilot hospitals are cleaned fully first; more hospitals are added only after that.

## 3. Scope

- **Schemes:** Private Health Insurance first; KASP, MEDISEP and others later on the same engine. Only the data "space" for other schemes is prepared now.
- **Private Health Insurance:** each claim can have a different insurer and TPA.
- **KASP and MEDISEP:** one insurer and TPA set for a period; TPAs can change with tenders, so the Scheme → Insurer → TPA link has valid-from / valid-to dates. MEDISEP: Oriental Insurance since the start, TPAs Vidal and FHPL at the same time, so each MEDISEP row needs its TPA. "KASP Dialysis" is its own sub-scheme. KASP/MEDISEP details (claimed amount, dialysis, rules) are discussed later with a sample sheet.
- **Cashless claims only.**
- **Historical data up to 2025** (from the government TMS system) is already held by Oksy; a TMS import with a template comes later. Google Sheets hold recent data only.

### Sheet layouts the portal must handle
- A separate Google Sheet per scheme (some hospitals have several sheets).
- One Google Sheet with one tab per scheme.
- One sheet, one scheme.
- One tab with several schemes (needs a Scheme column).
- Seen so far: one tab per month (OCT 2026, SEP 2026), sometimes a pre-made tab for next month, and helper tabs such as "TPA LIST".

## 4. Users and access

- Owner (Anoop Das, anoop@oksy.in), Admin (Muhammed Ali, admin@oksy.in), Users approved by Owner or Admin.
- Google sign-in; new sign-ins see nothing until approved. Page-level view and action ticks for Users. Run now is open to every approved user.
- Full rules: `decisions.md` section 3.
- Hospitals never use the portal. They use only their own sheet and their Question Sheet.

## 5. Hospitals

- For each hospital: Hospital ID, name, other names, status (Active / Stopped), schemes, the Google Sheet for each scheme (no tab names), and the Question Sheet link.
- Hospital ID and name can be changed any time; claims follow the change (the portal keeps its own permanent key).
- Entered one by one or by bulk upload with a **preview before save**.
- Robot access check per sheet (OK / Pending / Failed), read-only.

**Hospital list upload template** (one row = one hospital + one scheme):

| # | Column | Example | Needed |
|---|---|---|---|
| 1 | Hospital ID | HOSPPVTP0001 | Required |
| 2 | Hospital Name | (full name) | Required |
| 3 | Other Names | name one; name two | Optional |
| 4 | Status | Active or Stopped | Required |
| 5 | Scheme | Private, KASP or MEDISEP | Required |
| 6 | Google Sheet Link | link of that scheme's sheet | Required |
| 7 | Question Sheet Link | link, or blank so the portal creates it | Optional |

**Pilot hospitals (Private Health Insurance):**

| Hospital ID | Hospital | Google Sheet |
|---|---|---|
| HOSPPVTP0001 | The Badagara Sahakarana Asupathri Ltd, Vadakara | https://docs.google.com/spreadsheets/d/1-_vGLhW2hptEPDAVBnjN5tgZjJLHFWDq3d3zZobM-5g/edit |
| HOSPPVTP0002 | Tree G Eye Care Hospital, Manjeri | https://docs.google.com/spreadsheets/d/1LvE15UQa1QjUPcT76ymrpBslvvEs-baHAEE33GEv-dI/edit |
| HOSPPVTP0003 | HMS: Hearts Malabar Clinical Solutions Hospital, Kottakkal | https://docs.google.com/spreadsheets/d/1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ/edit |

## 6. Daily cycle and runs

1. Every day at **6:00 AM** a cleaning run on all listed sheets (hosted worker; no 6 PM run).
2. Issues go to each hospital's Question Sheet.
3. Staff answer (in their own sheet or in the Question Sheet).
4. The next run uses the answers. Sheets become clean over time.

- **Run now:** one sheet, one hospital, all (scheme levels later). One run per sheet at a time; 1-minute cool-down; a question is never sent twice; every run is logged with who started it and its scope.
- **Change detection:** read only changed files/tabs and clean only changed rows, once the Drive modified-time test passes; until then, full read every run. Each run records the sheet version it read.
- **Automatic retry** for technical failures (max 3, growing waits); other failures become an alert with the reason. Retries never change data and never create duplicates.
- **Visible run status:** last successful run, failed sheets, retry state, alert if the 6 AM run has not finished.
- The portal **only reads** hospital sheets. It never writes to them.

## 7. Reading sheets and column mapping

- The portal lists all tabs of a linked sheet and reads tabs whose header matches the confirmed mapping. Helper tabs are ignored; pre-made future tabs are held back.
- Rows with only a serial number or only formulas are non-data rows and are ignored. Totals and repeated header rows too.
- Status-named tabs (PAID, PENDING, AUG PENDING…): open item (section 18).
- **Mapping policy B + D:** approval per hospital + scheme, reused across that hospital's tabs on an exact normalised header match, after a value-shape check. Other hospitals' confirmed mappings appear as suggestions; a new hospital confirms pre-filled headers with one "Confirm all" click. Bulk confirm: Owner/Admin, exact matches, max 50, list shown first, undoable. Full rules: `decisions.md` section 5.
- Damaged header cells (a TPA name instead of "TPA", `#VALUE!` in the TDS header): AI maps by position and neighbouring columns and asks for confirmation.
- Staff formulas (Length of Stay, Settlement Delay, Balance Amount, TDS %) are auto-Ignored; the portal calculates its own.
- Each column maps to a field, Ignore, or a new field. Extra columns that nobody has decided on are not used.

## 8. Claims and statuses

- **Claim number** = insurer/TPA claim number. Only Under Treatment cases may have none; a case with admission and discharge dates always has one.
- **Same claim** = same claim number + same admission date + same discharge date. Same values again = duplicate; different values = flagged; a two-part approval is combined into one claim.
- Same patient + same IP number + different claim number = repeat treatment (not an error). Same patient + same admission date twice = duplicate warning.
- **Six statuses:** Under Treatment; Under Processing (discharged, not approved); Approved; Settled; Cancelled (by the hospital; reason mandatory); Rejected (by the insurer; reason mandatory).

| In the hospital sheet | Standard status |
|---|---|
| No discharge date | Under Treatment |
| Discharged, no approval yet | Under Processing |
| "Claim approved" and similar | Approved |
| "Paid", "Settled" (and typos such as "Seteled") with a payment | Settled |
| "Preauth rejected" | Rejected (reason mandatory) |
| "Case cancelled" | Cancelled (reason mandatory) |

- A rejected pre-auth or cancelled case may have no discharge date or claim number; the hospital is asked if the claim number is missing.
- Each hospital's status words are mapped once (AI suggests, a user confirms). Colours are never used without the hospital's confirmation.

## 9. Portal layout (4 menus)

**Top bar on every page:** quick search (claim number, patient, UTR, hospital); scheme selector (All / Private / KASP / MEDISEP); Run now; last and next run; signed-in user.

1. **Home** – status cards (hospitals Active/Stopped; Google Sheet files total, clean, need fixing — tabs are never counted); live run bar (including sheets skipped as unchanged); "Needs your decision" list (headers, tab types, new columns, names, status words, rule conflicts; with evidence, Accept/Change and Confirm all); scheme-wise table (KASP/MEDISEP "Not started" until enabled); hospitals with open questions (Question Sheet link, pending, oldest open, Copy reminder, Copy all reminders; red when pending over 2 days); questions sent / answered / pending; Month Close checklist before the 10th; alerts (sheet not updated for 3 and 7 working days, robot cannot open a sheet, run failed or late).
2. **Hospitals** – list (add, upload with preview, download template, robot access); hospital profile with tabs: Overview, Sheets & tabs, Column mapping (one row per header), Questions, Run history. Scorecard later.
3. **Data & Reports** – Claims (filters; claim detail with all fields, payments/UTRs, issues, change history with lane and reason, link to the source row); Payments (UTR); Payment follow-up (approved with no payment after 60 days by default, Grievance balances, by insurer/TPA); Download report. Saved presets and Insights later.
4. **Settings** – Users & Access; Fields; Rule Library (plain-words box, test before save, rule export for the Oksy Reports developer, staff guide); Audit & Runs (run history, reconciliation, change log; small cost panel later); Portal settings (Owner only); Standard template. Dictionary and scheme edit screens later; TMS upload later.

**Build order:** the 4-menu layout and light theme come after the cleaning engine (`stage-plan.md`).
**UI:** light/day theme, restrained futuristic feel (clean white cards, soft glass top bar, thin progress lines, motion only for live status). No developer words on screens.
**Removed:** Admin › Users (duplicate), Admin › Sheet tabs (automatic now), old Reports & Reconciliation page (merged), legacy Register / Desk staff / open checks sections ("Desk Google accounts" hidden until Question Sheets).

## 10. Clean-data columns

(C) = calculated by the portal. Exact keys and types: `column-dictionary.md`.

| Group | Columns |
|---|---|
| Hospital | Hospital ID, Hospital Name, Scheme, Source (sheet / tab / row), Record source (Google Sheet / TMS import) |
| Patient | Patient Name, UHID, IP Number, Policy Number / Card ID, Policy Holder Name, Phone Number |
| Insurance | Insurer, TPA, Claim Number |
| Treatment | Admission Date, Discharge Date, Length of Stay (C), Department, Doctor, Procedure / Treatment, Room Category |
| Amounts | Bill Amount, Pre-auth Approved Amount, Approved Amount, Co-pay, Discount (stated), Deduction (C) |
| Status | Claim Status, Cancellation Reason, Rejection Reason, Remarks (all remark columns joined) |
| Hardcopy | Hardcopy Sent Date, POD Number |
| Follow-up | Follow-up Date (data only) |
| Settlement | Total Settled (C), Total TDS (C), TDS stated, Settlement Date (C, latest payment), Settlement Delay (C), Balance Amount (C), Balance Status |
| Cleaning | Cleaning Status, Error count, Warning count, Last Checked |

- **Payments list:** one row per payment: Settlement Date, Settled Amount, UTR, TDS. The claim shows totals; reports show all UTRs.
- **Not included:** Diagnosis, Claimed Amount (for Private), Claim Type, Query Details.
- **Postponed (Owner-only):** Invoice Month, Invoice Number, Oksy Commission.
- Same columns, same order, for every hospital; blank where a hospital lacks a column. New fields added on the Fields page are stored in `extra_fields` and appear in reports.

## 11. Money rules

- **Bill = Approved + Co-pay + Deduction.** Deduction = Bill − Approved − Co-pay; if the staff's Discount differs, the hospital is asked.
- **TDS is deducted on every claim**, normal 10% of Approved. A different rate on a claim is flagged and asked.
- **Settled equal to Approved is an Error.**
- The portal never works out TDS from Approved − Paid. Payment with empty TDS → hospital asked; the question shows the expected 10%.
- Expected settlement = Approved − TDS; a difference beyond about ₹1 is flagged.
- **Balance = Approved − Total TDS − Total Settled.** Zero allowed; negative is an Error.
- **Balance Status:** Not decided (default; asked to the hospital) / Waived off (discount to the insurer; not followed up) / Grievance (to be claimed again).
- **Settlement Delay:** Settlement Date − Discharge Date if settled; today − Discharge Date if not.

## 12. Rules area (Rule Library)

- No rule is hard-coded. Users add rules one by one or upload them; Edit; Delete = Inactive (history kept). Every change is logged.
- Fields: Rule ID, name, description, scope (Global, Scheme, Hospital, Insurer, TPA, or combinations), severity (Error / Warning), validity (from / to), action (Automatic / AI suggestion / Ask hospital staff), message to staff (English).
- **Rule form, three parts:** which rows (scope, status, validity) → what to check (column, condition, compared with a column or value) → what to do (severity, action, message).
- Plain-words box: AI fills the form; a user checks and saves. Conflict warning on save. Test before save.
- **Trial before questions:** before a hospital's first questions go out, Anoop sees a per-rule summary once; a check set of 5 known-correct claims per pilot hospital is re-checked after any mapping or rule change.

### Initial rule list (extended during cleaning)
- Discharge date not before admission date (Error).
- Approved not above bill; settled not above approved.
- Cancelled or Rejected must have a reason.
- Admission and discharge dates present → claim number required.
- Claim number must not repeat (subject to the claim identity rule, section 8).
- TDS different from the normal rate → flagged and asked.
- Settled equal to approved (Error); TDS empty on a paid claim (asked); Discount differing from Bill − Approved − Co-pay (asked).
- Same patient and same admission date twice (Warning).
- Policy number equal to phone number (asked); implausible year, e.g. 1016 (Error); text in a date or numeric column (asked).
- Policy Holder Name empty when a claim number is present (Warning).
- Hardcopy Sent Date before discharge date (Error).
- POD Number missing when Hardcopy Sent Date is present (Warning; only from the hospital's POD Start Date).
- Settled without UTR; future date (Errors).
- Stay over 30 days; approved 60 days ago with no payment; same UTR on several claims; department or doctor missing (Warnings).

## 13. Clean, Error and Warning

- **Clean = no Error and no Warning.** Warnings are not ignored.
- A Warning clears when staff correct the value or confirm "value is correct" (recorded with who and when; never asked again).
- **Clean once** = one full run with zero Errors and Warnings across all the hospital's tabs.

## 14. Cleaning engine and AI

- **Three lanes:** (1) deterministic, automatic; (2) AI suggestion, never applied by itself; (3) human decision (portal users or hospital staff). Every change is tagged with its lane; human decisions record a reason.
- **Automatic formatting fixes:** spaces and line breaks in names, claim numbers and phone numbers; mixed `/` and `-` in dates; dates in any format; amounts written in any format; insurer/TPA spellings to the confirmed list.
- **Day–month swap:** only when stay is over 15 days; if swapping gives a stay within 15 days it is fixed, otherwise asked.
- **AI is used for:** column mapping suggestions; tab type suggestions; non-data rows; standard names (insurer, TPA, doctor per hospital, department, procedure); status words; cancellation/rejection reason categories; possible duplicates; values in the wrong column; unusual cases; grouping and wording questions; understanding staff answers; plain words → rule form; suggesting new rules from error patterns; monthly report summary; reminder drafts (sent by a person).
- **AI never:** guesses a missing UTR, date, amount or claim number; changes bill, approved or settled amounts; decides status from colour without hospital confirmation; approves, saves rules, skips tabs or sends messages. AI sees headers, cell shapes and counts, never patient names, phones or policy numbers.
- Master lists (insurer with Hardcopy Required Yes/No, TPA, department, doctor per hospital) are built from the data and confirmed once. "TPA LIST" tabs are a starting point.

## 15. Question Sheet

- One per hospital (all schemes), created by the robot in the Shared Drive; shared with staff by a person once.
- Tabs: HOW TO ANSWER, SETUP QUESTIONS (meaning or confirmation, answered in the Question Sheet), ROW FIXES (wrong values, corrected in the hospital's own sheet), HISTORY. Every question has a Scheme column and a clear row reference.
- Before clean once: all questions, errors first. After clean once: at most 25 new a day, errors first. Never repeated. Similar questions grouped; dropdown / Yes-No answers where possible. Questions close automatically when the source is fixed.
- Status line at the top after every run (`decisions.md` section 11). The portal never messages hospitals.

## 16. Reports

- Built from clean data at download time; nothing stored. Excel or CSV.
- **Filters:** hospitals (all / selected), scheme, insurer, TPA, claim status (e.g. Approved with no payment), date type (admission / discharge / payment) with from–to, only cases still to be cleaned, only cases with balance.
- One row per claim with all its UTRs; a Status column (`Clean` / `Fixing Required – reason`); exact amounts; dates dd-mmm-yyyy; Indian digit grouping.
- Claims changed after a download are marked "changed since download". Amounts cannot be edited in the portal.
- **Reconciliation:** source rows = classified rows; financial totals match; 0 unexplained differences.

## 17. Already in place

- Shared Drive, robot account (Google service account) and robot mail; robot has read access to the 3 pilot sheets.
- Built and approved (Stage 0): sign-in, roles and ticks; Hospitals page with the 3 pilots; sheet reading (tab discovery, AI mapping suggestions, non-data rows, Run now queue); Fields page (35 core fields + custom fields). See `stage-plan.md`.

## 18. Open items

- Status-named tabs (PAID, PENDING, AUG PENDING): proposed method — compare claim numbers; skip the tab if all its claims exist in month tabs, otherwise ask.
- Exact method of combining a two-part approval (Stage 2).
- Drive modified-time test (does every cell edit change it?).
- Worker hosting choice and cost (after measuring run time per sheet).
- KASP/MEDISEP details and a sample sheet.
- POD flag wording for insurers that do not require hardcopy.
- Final Oksy Reports template; standard Google Sheet template per scheme.
