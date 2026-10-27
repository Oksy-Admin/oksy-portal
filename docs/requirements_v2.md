# Oksy Data Cleanse – Requirements v2 (decisions and build plan)

Agreed in discussion with Anoop Das on 27-Oct-2026, after requirements v1 (26-Oct-2026).
Read together with `requirements_v1.md`. **Where v2 differs from v1, v2 wins.** Anything not mentioned here stays as in v1.
Design mock-ups for every page below were made on 27-Oct-2026 in the Claude artifact "Oksy Portal Final Model" (sample data only).

---

## 1. What changed from v1

1. **Commission is postponed.** Section 12 of v1 (commission methods, rates, valid-from) is not part of the build now. The Invoice group of columns (Invoice Month, Invoice Number, Oksy Commission) is postponed with it. Business features like this will be planned later and will be **visible to the Owner only**, not to Admins.
2. **No tab names in the hospital list.** The portal finds data tabs itself (section 5).
3. **Roles are Owner, Admin and User** (section 3). v1 said "anyone with portal access"; this is now controlled.
4. **"Run now"** is required at three levels: all hospitals, one hospital, one Google Sheet (section 4).
5. **Question volume:** all questions at first, then at most 25 a day (section 6).
6. **Clean-data columns grow** (section 7) because the hospitals' own sheets carry more columns, and the data must be complete.
7. **Money rule for TDS is stricter** (section 8).
8. **Pages are merged** from 8 to 7 (section 2).
9. **Pilot is three hospitals**, not one (section 11).
10. **Formats:** dates `dd-mmm-yyyy` (for example 27-Oct-2026). Amounts in Indian rupees with Indian digit grouping (₹1,20,000). Large totals on summary cards may be shown in lakhs (₹4.35 L); claim-level amounts and downloaded reports always show the exact amount.

---

## 2. Final portal: 7 pages

| # | Page | Replaces (old menu) | Purpose |
|---|---|---|---|
| 1 | Dashboard | Home | Where every sheet stands right now |
| 2 | Hospitals | Hospitals + Column Mappings | Hospital profiles, sheet links, live sheet status, column mapping |
| 3 | Questions | Questions | Question Sheet status per hospital, reminder drafts |
| 4 | Clean Data | Claims & Payments + download part of Reports | Combined clean claims, payments, report download |
| 5 | Rule Library | Rule Library | Add / edit / make inactive rules |
| 6 | Audit & Runs | Reconciliation part of Reports | Run history, reconciliation, change log |
| 7 | Settings › Users and Access | Settings | People, roles, access, approval of new sign-ins |

Every page has a **Run now** button in the top bar, the last run time, and the signed-in person's name and role.
Removed from the old Home page: "Row classification" and "Scheme rollout" boxes (development status, not daily work).

### 2.1 Dashboard
- Hospitals: **Active** and **Stopped** counts.
- Google Sheets: total **files** (tabs are never counted; a hospital with 3 Google Sheets and 22 tabs counts 3), **clean** and **need fixing**.
- Scheme-wise table: KASP, MEDISEP, Private Health Insurance and Total, with sheets, cleaned, need fixing, progress.
- **Live run** banner: progress of the run in progress (Done / Reading / Queued / Cannot read).
- **Live sheet status**: each sheet with its state (Reading, Queued, Clean, Needs fixing, Cannot read), note, last read time and a Run now button.
- Hospitals with open questions (only those hospitals): Hospital ID, name, **Question Sheet link**, Question Sheet last updated date, average cleaned rows per day versus new rows per day, pending questions, and a **Copy reminder** button. Staff copy the message and send it to the hospital themselves. The portal never sends messages.
- Questions to hospitals: sent, answered, pending, pending more than 2 days.
- Extra panels: Alerts (sheet not updated for 3 and 7 working days, robot cannot open a sheet, new column waiting for a Yes/No), mistakes that keep coming back, answer speed by hospital, days left to the 10th.

### 2.2 Hospitals
- Cards: Active/Stopped, scheme sheets linked / link missing, live sheet state, robot access (OK / Pending / Failed), Question Sheets (created / not created / not shared).
- One row per hospital: Hospital ID, name and other names, schemes with links, Question Sheet, live sheet status, robot access, status, Run now, Edit.
- Buttons: Add hospital, **Upload hospital list**, **Download template**, Check access.
- **Hospital profile** (opened by Edit): Hospital ID, name, status (Active/Stopped), **several other names** of the same hospital, Question Sheet link, and for each scheme the Google Sheet link, last read time, column mapping state (confirmed / to confirm) and Run now. **Hospital ID and name can be changed at any time**; claims follow the change and nothing is lost (the portal keeps its own permanent internal key).
- No commission anywhere on this page.

**Hospital list upload template** (one row = one hospital + one scheme; hospital details repeat on each of its rows):

| # | Column | Example | Needed |
|---|---|---|---|
| 1 | Hospital ID | HOSPPVTP0001 | Required |
| 2 | Hospital Name | (full name) | Required |
| 3 | Other Names | name one; name two (separate with `;`) | Optional |
| 4 | Status | Active or Stopped | Required |
| 5 | Scheme | KASP, MEDISEP or Private | Required |
| 6 | Google Sheet Link | link of that scheme's sheet (no tab name) | Required |
| 7 | Question Sheet Link | link, or blank so the portal creates it | Optional |

### 2.3 Questions
Cards: sent, answered, pending, pending over 2 days. Table per hospital: setup questions, row fixes, answered, oldest open (working days), Question Sheet link, Copy reminder. Side panels: question types (SETUP = meaning or confirmation, answered in the Question Sheet; ROW FIX = wrong value, corrected in the hospital's own sheet) and the reminder draft.

### 2.4 Clean Data
Tabs: **Claims**, **Payments (UTR)**, **Download report**. Filters: all or selected hospitals, scheme, insurer, TPA, claim status (for example Approved but no payment), date type (admission, discharge, payment) with from/to, only cases still to be cleaned, only cases with balance. Download as Excel or CSV. One row per claim; all UTRs of its payments are listed. Amounts cannot be edited here.

### 2.5 Rule Library
No rule is hard-coded. Add one by one or upload; Edit; **Delete = Inactive**. Plain-words box: user types the rule, AI fills the three-part form (which rows / what to check / what to do), user checks and saves. Conflict check on save. Fields as in v1 section 13. The old Type, Version, Shadow mode and Reference rules concepts are dropped from the screen.

### 2.6 Audit & Runs
Tabs: **Run history** (when, who started it, scope, sheets read, clean, need fixing, cannot read, result), **Reconciliation** (source rows = classified rows, financial totals match, 0 unexplained differences), **Change log** (hospital edits, rule changes, access changes, "value is correct" answers, with who and when).

### 2.7 Settings › Users and Access
Role cards, add-a-person form, people table, per-person access ticks, and a **Waiting for approval** list for new sign-ins (section 3). People are never deleted; Retire keeps them in the history.

---

## 3. Roles, sign-in and access

- **Owner:** Anoop Das, `anoop@oksy.in`. Full access. Adds Admins and **sets what Admins can see**. Future owner-only areas (such as commission) are hidden from Admins. Cannot be retired.
- **Admin:** Muhammed Ali, `admin@oksy.in`. Works in the pages the Owner allows. **Approves new users and sets their access.** An Admin's own access is set **only by the Owner**.
- **User:** everyone else. Sees and does only what the Admin ticked. Cannot open Settings.
- **Sign-in:** Google sign-in. Anyone can sign in and ask for access, but sees no data until an Admin or the Owner approves and sets a role. (Assumption: the approval list shows the Google email and name of the person asking.)
- Access ticks per page: Dashboard (view, copy reminders); Hospitals (view, add and edit); Questions (view, mark as answered); Clean Data (view, download reports); Rule Library (view, add and edit); Audit & Runs (view).
- **Run now is open to everyone who can see the page.** A run only refreshes the latest status and changes nothing in the hospital sheets, so it needs no special permission.
- Every access change goes to the change log.

---

## 4. Run now

- Three levels: **all hospitals** (top bar), **one hospital** (Hospitals row, Dashboard row), **one Google Sheet** (Dashboard live row, hospital profile scheme row). Reading a single sheet is faster and uses less Google quota.
- The 6:00 AM daily run and the 6:00 PM evening check continue as before. Run now is in addition.
- Each run refreshes the cleaning status of the sheets it covers. The portal only **reads** the hospital sheets and never writes to them.
- While a run for a sheet is in progress its button shows "Running"; a second press must not start a second run of the same sheet (one run per sheet at a time).
- A question that already exists is never sent twice.
- Every run is recorded in Audit & Runs with who started it and its scope.

---

## 5. How sheets are read (tabs and layouts)

The hospital sheets seen so far (three Private Health Insurance sheets) have **one tab per month** (for example OCT 2026, SEP 2026), sometimes a pre-made tab for next month, and **helper tabs** such as "TPA LIST".

- Hospital list has no tab column. The portal lists all tabs of a linked Google Sheet and reads the tabs whose header matches the standard header.
- Helper tabs are ignored. The "TPA LIST" tab can be used as the starting point of the TPA master list.
- **A new month tab with the same header as the confirmed one is included automatically.** A tab with a different header waits for a decision from a person, and is not read until then.
- Pre-made future tabs, and rows that contain only a serial number or only formulas (for example a 0 in the LOS column), are ignored as non-data rows.
- Column mapping is done by AI and confirmed once per hospital and scheme. Header cells can be damaged in the hospital's file (for example the TPA header replaced by a TPA name, or `#VALUE!` in the TDS header); the AI maps such columns by position and neighbouring columns and asks for confirmation.
- Staff formulas (Length of Stay, Settlement Delay) are ignored; the portal calculates its own.
- The portal must handle: one Google Sheet per scheme, one Google Sheet with one tab per scheme, and (to be seen later) several schemes in one tab.

---

## 6. Question Sheet policy

- One Question Sheet per hospital, as in v1 section 7. Tabs planned: HOW TO ANSWER, SETUP QUESTIONS, ROW FIXES, HISTORY.
- **First cleaning of a hospital: all questions, with no limit.** AI groups similar questions; errors come before warnings.
- **After the hospital's sheets have been clean once** (no Error and no Warning): new questions are limited to **25 a day**; the rest wait in a queue.
- **If there is nothing to ask,** the Question Sheet shows a message: "Congratulations, your sheet is clean. Thank you."
- A "value is correct" answer is recorded with who and when and is not asked again.
- Run now may add new questions at once, but never repeats an existing one and respects the 25 a day limit once the hospital has been clean.

---

## 7. Clean-data columns (v1 section 10 plus these changes)

(C) = calculated by the portal.

**Added to the clean data and to every report:**
- Room Category (no rule)
- Policy Holder Name (**rules apply**)
- Hardcopy Sent Date (**rules apply**)
- POD Number (**rules apply**)
- Follow-up Date, Follow-up Remarks, Pre-auth Approved Amount (kept as data; rules can be added later)
- Settlement Delay in days (C), from discharge or hardcopy date to payment date, calculated by the portal

Length of Stay stays (C). Staff-entered LOS and settlement delay are not used.

**Postponed:** Invoice Month, Invoice Number, Oksy Commission.

**Initial rules for the three "rules apply" columns** (to be tuned during the first cleaning, they are only a starting point):
- Policy Holder Name must not be empty when a claim number is present (Warning).
- Hardcopy Sent Date must not be before the discharge date (Error).
- POD Number is required when a Hardcopy Sent Date is present (Warning).

Other extra columns in a hospital's sheet follow v1 ("the portal asks whether to add it"; Yes = part of the data, No = ignored completely).

---

## 8. Money rules (update to v1 section 11)

- **Bill = Approved + Co-pay + Deduction.** Hospitals call the deduction "Discount". Deduction is calculated as Bill − Approved − Co-pay; if the staff's Discount differs from the calculated value, the hospital is asked.
- **TDS is deducted on every claim.** Normal rate 10% of the approved amount.
- **A Settled (paid) amount equal to the Approved amount is an Error** (TDS was not deducted, or the amount was entered wrongly). The hospital is asked.
- The portal does **not** work out TDS from "Approved − Paid". If a payment is recorded and TDS is empty, the hospital is asked to enter it, and the question shows the expected 10% value.
- Expected settlement = Approved − TDS. A paid amount that differs from this (allowing rounding of about ₹1) is flagged and asked.
- **Balance = Approved − Total TDS − Total Settled.** Balance Status (Not decided / Waived off / Grievance) as in v1.

---

## 9. Claim status words and special cases

AI suggests the standard status for each hospital's own words; a user confirms each word once, then it is applied automatically. Colours are never used without the hospital's confirmation.

| In the hospital sheet | Standard status |
|---|---|
| No discharge date | Under Treatment |
| Discharged, no approval yet | Under Processing |
| "Claim approved" and similar | Approved |
| "Paid", "Settled" (and typos such as "Seteled") with a payment | Settled |
| "Preauth rejected" | Rejected (reason mandatory) |
| "Case cancelled" | Cancelled (reason mandatory) |

- A rejected pre-authorisation or cancelled case may have no discharge date and no claim number. Only Under Treatment cases are allowed to have no claim number; for Rejected and Cancelled cases without one, the hospital is asked.
- Repeat treatments: the **same patient with the same IP number and a different claim number is not an error** (for example repeat injections). Duplicate warnings fire only when the **claim number repeats**, or when the **same patient and the same admission date** appear twice.
- A policy number that equals the phone number (value in the wrong column), text in a date column, an implausible year (for example 1016), and "DAYCARE" in a numeric column are asked to the hospital. The AI does not guess the correct year.
- Formatting-only fixes are applied automatically: spaces and line breaks inside names, claim numbers and phone numbers, mixed `/` and `-` in dates, different spellings of insurer and TPA names (to the confirmed master list).
- Insurer and TPA can be the same (for example Star Health); the master lists are built by AI from the data and confirmed once.

---

## 10. Dates and amounts: AI limits (unchanged from v1)
AI never guesses a missing UTR, date or amount and never changes bill, approved or settled amounts. Day–month swap is checked only when the stay is over 15 days.

---

## 11. Pilot hospitals (Private Health Insurance)

Hospital IDs were set on 27-Oct-2026 and **can be changed later** (the portal keeps the history).

| Hospital ID | Hospital | Google Sheet (Private Health Insurance) |
|---|---|---|
| HOSPPVTP0001 | The Badagara Sahakarana Asupathri Ltd, Vadakara | https://docs.google.com/spreadsheets/d/1-_vGLhW2hptEPDAVBnjN5tgZjJLHFWDq3d3zZobM-5g/edit |
| HOSPPVTP0002 | Tree G Eye Care Hospital, Manjeri | https://docs.google.com/spreadsheets/d/1LvE15UQa1QjUPcT76ymrpBslvvEs-baHAEE33GEv-dI/edit |
| HOSPPVTP0003 | HMS: Hearts Malabar Clinical Solutions Hospital, Kottakkal | https://docs.google.com/spreadsheets/d/1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ/edit |

The robot account already has access to the Private Health Insurance sheets.

### What the three sample sheets showed (patterns only)
- All three use the same company template (same column order), so column mapping is easy; small differences exist (DEPARTMENT / DEPARTMENTS, extra Pre-auth Approval Amount in one).
- Typical mistakes: year typos in dates; `/` and `-` mixed in one column; text in date columns; text in the LOS column; insurer and TPA names written in many ways; phone number in the policy number column; line breaks and extra spaces in cells; empty rows with only serial numbers; damaged header cells; formula errors (`#VALUE!`) in LOS, settlement delay and TDS.
- Claim status is often empty or free text; TDS and balance columns are usually empty although payments exist.
- Bill = Approved + Co-pay + Deduction holds for most rows; a few differ.
- Policy Holder Name is empty in one hospital's whole sheet, so that rule will create many questions in the first round (acceptable under the "all questions first" policy).

---

## 12. Build plan

**Phase 1 = Private Health Insurance only** (KASP and MEDISEP follow later, with the scheme → insurer → TPA link and valid-from / valid-to as in v1).

| Stage | Work |
|---|---|
| 0 | Align Supabase database, GitHub and Vercel with the local folder. Fix the current load errors (Hospitals "Cannot load", Rule Library missing column). |
| 1 | Users and Access: Google sign-in, Owner / Admin / User, approval, access ticks, change log. |
| 2 | Hospitals: profile (editable ID, several names, status), upload template and bulk upload, Question Sheet link, robot access check. Load the 3 pilot hospitals. |
| 3 | Reading sheets: tab discovery, column mapping with one-time confirmation, non-data row detection, **Run now** for one sheet, one hospital, all. |
| 4 | Rule Library and the cleaning engine: Error / Warning, "value is correct", initial rules from section 13. |
| 5 | Question Sheets (created by the robot in the Shared Drive) and the Questions page; first-round and 25-a-day policy. |
| 6 | Dashboard with live status. |
| 7 | Clean Data and report download. |
| 8 | Audit & Runs, reconciliation, 6:00 AM and 6:00 PM schedules. |

**Phase 1 is done when,** for the three pilot hospitals: the daily and Run now cleaning work; questions reach the Question Sheets and answers come back; the Dashboard shows the live state; and a complete, correct monthly report (every detail of every claim) can be downloaded before the 10th.

---

## 13. Initial rule list (to be extended during cleaning)
From v1: discharge not before admission; approved not above bill; settled not above approved; cancelled or rejected must have a reason; admission and discharge dates present means claim number required; claim number must not repeat; TDS different from the normal rate is flagged.
Added in v2: settled equal to approved is an Error; TDS empty on a paid claim is asked; deduction differing from Bill − Approved − Co-pay is asked; same patient and same admission date twice is a Warning; policy number equal to phone number is asked; implausible year is an Error; the three "rules apply" columns in section 7.
All rules are entered in the Rule Library by users; none is hard-coded.

---

## 14. Open items and assumptions
- "Clean once" for the 25-a-day policy is taken as: the hospital's sheets have reached no Error and no Warning at least once. (Assumption, confirm.)
- Hospital IDs 0001 to 0003 were assigned in the order Badagara, Tree G, HMS. (Assumption, change if needed.)
- Hospital ID format `HOSPPVTP####` is taken from the three given IDs; the meaning of each part is not recorded.
- The Owner's screen for setting an Admin's access has not been designed yet.
- Whether the portal should later produce a ready report file per hospital (instead of staff downloading with filters) is open; Phase 1 uses download only.
- AI features need a Claude API key and a monthly spending limit; **Anoop decides**.
- The local `CLAUDE.md`, knowledge files and project instructions still need to be rewritten from v1 and v2 once the local folder is connected.
- Column Mappings and Claims & Payments pages of the current portal were not reviewed; check they lose nothing when merged.
- Commission, invoices and any other business features: later, Owner-only.
