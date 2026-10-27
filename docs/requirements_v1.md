# Oksy Data Cleanse – Requirements v1

Agreed in discussion with Anoop Das on 26-Oct-2026.
This document records only what Anoop stated or accepted in that discussion. Where it differs from older knowledge files in this Project, **this document wins**.

---

## 1. Background and problem

- Oksy gives health insurance claiming support to private hospitals in Kerala.
- Oksy staff work at each hospital's insurance desk and record every insurance patient's claim details in Google Sheets.
- Oksy combines these sheets to analyse its business performance, send monthly reports to hospitals, generate Oksy's invoices, and run other business work.
- Problem: staff do not maintain the sheets properly, and each hospital maintains them differently. Combining and cleaning the data has become a large task. Invoice generation and hospital reports are difficult.
- Every month on the 10th, every hospital must receive an accurate claim report. Counts and totals are not enough: every detail of every claim must be correct (patient name, admission date, discharge date, amounts, doctor, department, settlement, payments, UTR, TDS, balance). A wrong report cannot be sent.
- The same data is used for Oksy's invoice generation. Wrong data harms Oksy's reputation.
- Counts (number of hospitals, claims, sheets, employees) are not part of this project for now.

## 2. Overall plan

1. Clean all existing Google Sheets (all historical data) and build one combined, clean dataset.
2. Keep a list of every rule created while cleaning.
3. Give that rule list to the developer of **Oksy Reports** (Oksy's separate website) so the same mistakes are blocked there by code.
4. Give hospital staff an English document: "do not make these mistakes".
5. From the clean data, design a uniform Google Sheet template (one template per scheme, because columns can differ by scheme).
6. Hospitals use the template in Google Sheets for some time to get used to it (Oksy Reports needs development time).
7. Oksy Reports gets the same columns in the same order. Data entry in Oksy Reports starts only after the rules are coded there.

The Oksy Reports template/format is not decided yet. It will follow the clean-data columns (section 10).

## 3. Scope

- Schemes to clean: **Private Health Insurance, KASP, MEDISEP**.
- **Phase 1: Private Health Insurance only.**
- Private is not one insurer: each claim can have a different insurance company and a different TPA.
- KASP and MEDISEP: one insurer and TPA for a period of time. TPAs can change when tenders change, so the scheme → insurer → TPA link must be stored with a valid-from / valid-to date.
  - MEDISEP: insurer has been Oriental Insurance since the scheme started. TPAs: Vidal and FHPL, both at the same time. No change so far. So each MEDISEP row needs its TPA.
- Cashless claims only (no reimbursement claims).

### Sheet layouts the portal must handle
- A separate Google Sheet per scheme (some hospitals have several sheets).
- One Google Sheet with one tab per scheme (hospitals with few cases).
- One sheet, one scheme.
- Possibly one tab with several schemes (not known yet; will be seen during cleaning). The portal must be able to handle any layout.

## 4. Users

- Anoop Das, Muhammed Ali (Oksy administrator), and one or two employees they allow.
- Hospitals do not use the portal. They only use their Question Sheet.
- Portal purpose: clean the sheets and let users download combined reports.

## 5. Hospital list (portal input)

For each hospital: name, Hospital ID, schemes, the Google Sheet for each scheme (and tab, if one sheet has several tabs), and the hospital's Question Sheet.
- Can be entered one by one or uploaded in bulk.
- Only sheets in this list are cleaned.
- Commission settings per hospital and scheme (section 12).

## 6. Daily cleaning cycle

This is not a one-time job. The sheets are live and staff keep making the same mistakes.
1. Every day at 6:00 AM, a cleaning run on all listed sheets.
2. Errors found go to each hospital's Question Sheet.
3. Staff answer (in their own sheet or in the Question Sheet).
4. The next run uses the answers. Sheets become clean over time.

The portal only reads hospital sheets. It never writes to them.

## 7. Question Sheet

- One Question Sheet per hospital, showing only that hospital's questions and mistakes.
- Created automatically by the portal's robot account in the Shared Drive when a hospital is added. Sharing it with hospital staff is done by a person, once per hospital.
- Where to answer (each question says which):
  - Wrong values in the sheet (date, amount, UTR) → staff correct them in their own source sheet.
  - Meaning or confirmation (colour meaning, column meaning, "value is correct") → staff answer in the Question Sheet.
- An answer of "value is correct" is recorded with who and when, and is not asked again.

## 8. Dashboard

Staff may not open the Question Sheet every day, so the office must see in the portal:
- Total hospitals, total sheets; in today's run, how many sheets are clean and how many need fixing.
- Per hospital: number of errors and warnings, number of questions sent, answered and pending, and a link to the Question Sheet.
- Office staff use this to check answers, remind the hospital and get answers quickly.
- Hospital staff efficiency: average days to answer, questions pending more than 2 days, and whether the same mistakes keep coming back run after run.

## 9. Claim ID and status

### Claim ID
- The insurer/TPA claim number. It is needed to track the claim on the insurer portal, check status and follow up payments.
- One claim = one number. It never repeats. A repeated claim number is an error.
- Only **Under Treatment** cases may have no claim number. A case with both admission and discharge dates always has a claim number.

### Claim status (6)
1. **Under Treatment**
2. **Under Processing** – discharged, not yet approved.
3. **Approved**
4. **Settled**
5. **Cancelled** – cancelled by the hospital (patient referred, patient did not submit documents, treatment found not covered by the policy at the start). Cancellation reason is mandatory.
6. **Rejected** – rejected by the insurance company (documentation, policy or other reasons). Rejection reason is mandatory.

## 10. Clean-data columns (Draft 2 – also the base for the Oksy Reports template)

(C) = calculated by the portal.

| Group | Columns |
|---|---|
| Hospital | Hospital ID, Hospital Name, Scheme, Source sheet / tab / row |
| Patient | Patient Name, IP Number, Policy Number / Card ID, Phone Number |
| Insurance | Insurer, TPA, Claim Number |
| Treatment | Admission Date, Discharge Date, Length of Stay (C), Department, Doctor, Procedure / Treatment |
| Amounts | Bill Amount, Approved Amount, Co-pay, Deduction (C) |
| Status | Claim Status, Query Details, Cancellation Reason, Rejection Reason, Remarks |
| Settlement (claim level) | Total Settled (C), Total TDS (C), Settlement Date (C, latest payment), Balance Amount (C), Balance Status |
| Invoice | Invoice Month, Invoice Number, Oksy Commission (C) |
| Cleaning | Cleaning Status, Error count, Warning count, Last Checked |

Not included: Diagnosis, Claimed Amount (Bill Amount is used for private insurance), Claim Type (cashless only).

### Payments (separate list)
One claim can have several payments, each with its own UTR. For each payment: Settlement Date, Settled Amount, UTR, TDS. The claim shows the totals; reports show all UTRs.

### Extra columns
If a hospital's sheet has a column not in this list, the portal asks during cleaning whether to add it to the clean report.
- Yes: it becomes part of the data, and rules can apply to it.
- No: it is ignored completely. No flags, no rules.

## 11. Money relationships

- Insurer approves an amount from the bill. The hospital collects the rest from the patient as co-pay. Anything still left is a deduction (for example, a discount the hospital gives the insurer).
  - **Bill = Approved + Co-pay + Deduction** → Deduction = Bill − Approved − Co-pay
- Settlement should be Approved minus TDS.
  - **Balance = Approved − Total TDS − Total Settled**
- Balance Status:
  - **Not decided** – default when payment arrives; goes to the hospital as a question.
  - **Waived off** – discount given to the insurer; will not be followed up.
  - **Grievance** – to be claimed again from the insurer.
- TDS is written by staff. The portal checks it against the normal rate (10%). If one case differs (for example 5%), it is flagged and the hospital is asked for the correct amount. This is a cleaning rule.

## 12. Commission (for Oksy invoices)

Set per hospital and per scheme (the same hospital can have different methods for Private and KASP). Types:
1. Fixed amount
2. One flat rate for all (for example 2–5%)
3. % of bill amount
4. % of approved amount
5. % of approved amount + % of co-pay

Store method, rate and valid-from date. The portal calculates commission per claim. A hospital/scheme with no commission term shows "No term", not zero.

## 13. Rules area

- No rule is hard-coded. All rules are added by users in the portal. The software only provides the screen and an upload template.
- Add one by one or upload in bulk. Add, Edit, Delete. **Delete = make Inactive** (history is kept).
- Anyone with portal access can change rules. No approval step. The portal records who changed what and when.
- Fields: Rule ID, Rule Name, description, scope, severity (Error / Warning), validity period (from / to), action (Automatic / AI / Ask hospital staff), message to staff (English).
- Scope: Global, Hospital, Insurer, TPA, Scheme, or combinations (insurer + hospital, insurer + TPA, etc.). Example of a hospital rule: that hospital's colour codes.
- Conflicting rules: a warning appears when the new rule is created. The user then makes the old rule inactive, or changes the new rule so they do not conflict.

### Rule form (base design, future-ready)
Three parts:
1. **Which rows:** scope, status, validity period.
2. **What to check:** column, condition (must not be empty / must not exceed / must not be before / must not repeat / must be in list …), compared with another column or a value.
3. **What to do:** severity, action, message.

Rules that do not fit the boxes: user writes the rule in plain words, AI fills the form, user checks and saves.
How many and what kind of rules are needed will only be known after cleaning starts, so the rules area must be easy to extend later without rebuilding the portal.

### Rule examples given so far
- Discharge date must not be before admission date.
- Approved amount must not exceed bill amount.
- Settled amount must not exceed approved amount.
- Cancelled or Rejected must have a reason.
- Admission and discharge dates present → claim number required.
- Claim number must not repeat.
- TDS different from the normal rate → flag and ask.

## 14. Clean, Error and Warning

- **Clean = no Error and no Warning.** Warnings are not ignored, because the data goes to hospitals and into invoices.
- A Warning clears when staff correct the value, or staff confirm "value is correct" (recorded with who and when).
- Example Errors: discharge before admission; settled more than approved; Settled without UTR; dates present but no claim number; duplicate claim number; Rejected without reason; future date.
- Example Warnings: stay over 30 days; approved 60 days ago with no payment; same UTR on several claims; department or doctor missing.

## 15. AI in this project

All of these are required:

**Understanding sheets**
1. Map each hospital's column names to standard columns (user confirms once).
2. Find non-data rows (totals, repeated headers, blank rows).
3. Suggest colour meanings (used only after the hospital confirms).

**Standardising**
4. Names: insurer, TPA, doctor (per hospital), department, procedure/treatment.
5. Dates in any format; day–month swap.
6. Amounts written in any format.
7. Status words ("paid", "rej", "query raised") → suggested status.
8. Cancellation and rejection reasons → standard categories.

**Finding doubts**
9. Possible duplicates (same patient, small spelling difference, same admission date).
10. Values in the wrong column (UTR that is a date, claim number that looks like a phone number).
11. Unusual cases (amount far above normal for a department, etc.).

**Questions and rules**
12. Write clear English questions to staff; group similar questions.
13. Understand staff answers.
14. Turn a rule written in plain words into the rule form.
15. Suggest new rules from patterns of errors (feeds the Oksy Reports rule list and the staff "do not do" document).

**Reports**
16. Short summary with each monthly hospital report.
17. Draft reminder messages (sent by a person).

**How AI changes are applied**
- Names: the first time a new name appears, AI suggests the standard name, a user confirms once, then it is applied automatically everywhere.
- Master lists (insurer, TPA, department, doctor per hospital): AI builds them from the data; confirmed once with hospital staff.
- Date swap: checked only when length of stay is over 15 days. If swapping day and month gives a stay within 15 days, AI fixes it. If still in doubt, ask staff.

**AI must never**
- Guess missing UTR, dates or amounts.
- Change bill, approved or settled amounts.
- Decide status from colour without hospital confirmation.

**Ask hospital staff** for: missing UTR, missing settlement date, stay still doubtful after swap, and anything AI cannot settle with confidence.

## 16. Combined report download

Filters:
- All hospitals or selected hospitals
- Date range by admission date, discharge date or payment date
- Insurer
- Only cases still to be cleaned
- Suggested additions: scheme, TPA, claim status (for example Approved but no payment), cases with balance

## 17. Already done

- Shared Drive, robot account and robot mail created.
- Robot has access to the Private Health Insurance sheets.

## 18. Decide later

- Whether old clean data is copied into the new template sheets, or only new entries.
- Whether any hospital keeps several schemes in one tab (seen during cleaning).
- The detailed rule list (built during cleaning).
- Final Oksy Reports template.
