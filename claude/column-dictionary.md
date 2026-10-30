# Column Dictionary – Oksy Data Cleanse

Standard fields every hospital's sheet is mapped to. Last updated: 30-Oct-2026 night.
The live list is the `mapping_fields` table (Settings › Fields). The 35 core fields come from `packages/rules/src/fields.ts`; they cannot be deleted and their type cannot be changed. Fields added on the Fields page store their data in `extra_fields`.
Decisions behind this file: `claude/decisions.md` sections 5–8.

Key: **C** = calculated by the portal (never taken from the sheet). **Ignore** = never read, never in a report.

## 1. Core fields (35)

| Key | Label | Type | Notes |
|---|---|---|---|
| serial_no | Serial No | number | Used only to find non-data rows |
| patient_name | Patient Name | text | |
| patient_ip_no | IP Number | text | Hospital admission (IP) number. **Stage 1b: remove the "UHID" alias** (UHID is its own field, section 2) |
| policy_or_card_no | Policy Number / Card ID | text | Policy number equal to phone number is asked |
| phone_number | Phone Number | text | |
| policy_holder_name | Policy Holder Name | text | Rules apply |
| preauth_or_claim_no | Claim Number | text | Part of the claim identity (with admission and discharge dates) |
| insurer_name | Insurer | text | Standard name from the insurer list |
| tpa_name | TPA | text | Standard name from the TPA list |
| admission_date | Admission Date | date | Part of the claim identity |
| discharge_date | Discharge Date | date | Part of the claim identity |
| treatment_or_surgery | Procedure / Treatment | text | |
| department | Department | text | |
| doctor_name | Doctor | text | Doctor list is per hospital |
| room_no | Room No | text | Not needed in reports (Ignore) |
| room_category | Room Category | text | No rules. ROOM CATEGORY columns map here |
| bill_amount | Bill Amount | amount | Final treatment cost |
| claimed_amount | Claimed Amount | amount | Not used for Private; kept for KASP/MEDISEP later |
| preauth_approved_amount | Pre-auth Approved Amount | amount | Data only |
| approved_amount | Approved Amount | amount | |
| copay_amount | Co-pay | amount | Paid by the patient |
| deduction_amount | Deduction | amount (C) | Bill − Approved − Co-pay |
| discount_amount | Discount | amount | As written by staff; compared with Deduction. Not ignored |
| casesheet_sent_date | Hardcopy Sent Date | date | Rules apply; only for insurers that require hardcopy |
| courier_no | POD Number | text | Rules apply from the hospital's POD Start Date |
| followup_date | Follow-up Date | date | PAYMENT FOLLOW UP DATE maps here. Data only, no rules |
| followup_log | Follow-up Remarks | text | **Not used any more:** follow-up remark columns go to `remarks`. Core field, so it is hidden, not deleted |
| status_text | Claim Status | text | Hospital's own word; mapped to one of the 6 standard statuses |
| rejection_reason | Rejection Reason | text | Mandatory for Rejected |
| cancellation_reason | Cancellation Reason | text | Mandatory for Cancelled |
| payment_date | Settlement Date | date | Per payment |
| payment_amount | Settled Amount | amount | Per payment; amount received after TDS |
| payment_utr | UTR | text | Per payment; never guessed |
| tds_amount_stated | TDS | amount | TDS amount as written by staff; rules apply. The TDS % column is Ignored |
| remarks | Remarks | text | Takes **every** remark column (including follow-up remarks); values joined with " \| " and prefixed by the source column name (prefix to be built in Stage 1b) |

## 2. Added fields (stored in `extra_fields`)

| Key | Label | Type | Notes |
|---|---|---|---|
| balance_status | Balance Status | text | Not decided / Waived off / Grievance. Added 30-Oct. Mapping test waits for a safe source column; never map BALANCE AMOUNT here |
| uhid | UHID | text | Hospital patient ID (not the IP number). To be added in Stage 1b |

The live list also has 3 older custom fields (added 27-Oct); they are reviewed in Stage 1b.

## 3. Auto-Ignored columns (portal calculates its own)

Never shown for approval: **Length of Stay**, **Settlement Delay**, **Balance Amount**, **TDS %**.

## 4. Calculated by the portal

| Value | How |
|---|---|
| Length of Stay | Discharge Date − Admission Date |
| Deduction | Bill − Approved − Co-pay |
| Total Settled | Sum of Settled Amount over the claim's payments |
| Total TDS | Sum of TDS over the claim's payments |
| Settlement Date (claim) | Latest payment date |
| Settlement Delay | Settlement Date − Discharge Date if settled; today − Discharge Date if not |
| Balance Amount | Approved − Total TDS − Total Settled (zero allowed, negative = Error) |
| Cleaning Status, Error count, Warning count, Last Checked | From the cleaning run |

## 5. System columns (every claim)

Hospital ID, Hospital Name, Scheme, Source (sheet / tab / row), Record source (Google Sheet / TMS import).

## 6. Master lists

| List | Columns | Notes |
|---|---|---|
| Insurer | Insurer, Hardcopy Required (Yes/No) | Confirmed once |
| TPA | TPA | Built from the data; "TPA LIST" tabs are a starting point |
| Scheme → Insurer → TPA | Scheme, Insurer, TPA, valid from, valid to | For KASP/MEDISEP; space prepared in Stage 1d |
| Department, Doctor (per hospital), Status words | Hospital word → standard value | Confirmed once |

## 7. Not included / postponed

- Not included: Diagnosis, Claim Type, Query Details.
- Postponed (Owner-only): Invoice Month, Invoice Number, Oksy Commission.

## 8. Open

- POD flag wording for insurers that do not require hardcopy.
- Review of the 3 older custom fields (Stage 1b).
