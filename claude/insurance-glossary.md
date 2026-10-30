# Glossary – Oksy Data Cleanse

Terms as Oksy uses them in the portal. Confirmed by Anoop Das (27-Oct and 30-Oct-2026). If this file and `claude/decisions.md` differ, `decisions.md` wins.

## Schemes

- **Private Health Insurance:** claims under insurance companies outside the government schemes. Built first.
- **KASP:** Karunya Arogya Suraksha Padhathi, Kerala Government health insurance scheme. Later.
- **KASP Dialysis:** treated as its own sub-scheme; repeat dialysis sessions are not duplicates.
- **MEDISEP:** Medical Insurance scheme for Kerala Government employees and pensioners. Insurer Oriental Insurance; TPAs Vidal and FHPL at the same time. Later.
- **TMS:** the government system from which Oksy downloaded historical claim data up to 2025.

## Parties

- **Insurer:** the insurance company that approves and pays the claim.
- **TPA (Third Party Administrator):** the company that processes claims for the insurer. Insurer and TPA can be the same (for example Star Health).
- **Hospital:** the provider that treats the patient and files the claim.
- **Patient:** the insured person who is treated.
- **Policy Holder:** the person who holds the policy (can differ from the patient).

## Claim and money terms

- **Claim Number:** the insurer/TPA claim number. One claim, one number.
- **Same claim:** same claim number + same admission date + same discharge date.
- **Duplicate:** the same claim appearing again with the same values.
- **Two-part approval:** one claim approved and paid in two parts (first part, then second); combined into one claim.
- **Repeat treatment:** same patient and IP number with a different claim number (for example repeat injections). Not an error.
- **IP Number:** the hospital admission (in-patient) number.
- **UHID:** the hospital's patient ID. Not the IP number.
- **Bill Amount:** the final treatment cost the hospital charges.
- **Pre-auth Approved Amount:** the amount the insurer approved before treatment.
- **Approved Amount:** the part or all of the bill the insurer approves.
- **Co-pay:** the part of the bill the patient pays directly to the hospital.
- **Deduction (Discount):** the amount the hospital gives up. Deduction = Bill − Approved − Co-pay. "Discount" is what staff write; the portal compares it with the calculated Deduction.
- **Bill = Approved + Co-pay + Deduction.**
- **TDS (Tax Deducted at Source):** tax the insurer deducts from the approved amount. Normal rate 10% of Approved. Deducted on every claim.
- **Settled Amount:** the amount actually paid to the hospital, after TDS. Settled equal to Approved is an Error.
- **UTR (Unique Transaction Reference):** the bank reference of a payment. One claim can have several payments and UTRs.
- **Balance Amount:** Approved − Total TDS − Total Settled. Zero allowed, never negative.
- **Balance Status:** Not decided (default; hospital asked) / Waived off (discount to the insurer; not followed up) / Grievance (to be claimed again).
- **Cashless claim:** the insurer pays the hospital directly. Only cashless claims are in scope.

## Documents and dates

- **Admission Date / Discharge Date:** the dates the patient was admitted and discharged.
- **Length of Stay (LOS):** days between admission and discharge. Calculated by the portal.
- **Hardcopy:** a copy of the case sheet sent by courier; required by some insurers only (Hardcopy Required: Yes/No).
- **Hardcopy Sent Date:** the date the case sheet was couriered.
- **POD (Proof of Delivery) Number:** the courier's delivery proof number. Recorded only from the hospital's **POD Start Date**.
- **Settlement Date:** the date of the latest payment.
- **Settlement Delay:** days from discharge to settlement (to today if not settled). Calculated by the portal.
- **Follow-up Date:** the next date to follow up a payment. Data only.

## Claim status

- **Under Treatment:** patient still admitted. May have no claim number.
- **Under Processing:** discharged, not yet approved.
- **Approved:** insurer has approved the amount.
- **Settled:** payment received.
- **Cancelled:** cancelled by the hospital (patient referred, documents not submitted, treatment not covered). Reason mandatory.
- **Rejected:** rejected by the insurer. Reason mandatory.

## Cleaning terms

- **Clean:** no Error and no Warning.
- **Clean once:** one full run with zero Errors and Warnings across all of a hospital's tabs. After this, at most 25 new questions a day.
- **Error:** a wrong or impossible value. Must be fixed.
- **Warning:** a doubtful value. Must be corrected or confirmed.
- **"Value is correct":** a staff answer confirming a flagged value. Recorded with who and when; not asked again.
- **Non-data row:** a total, repeated header, blank row, or a row with only a serial number or formulas. Ignored.
- **Three lanes:** how a value can change — (1) automatic deterministic cleaning, (2) AI suggestion (never applied by itself), (3) human decision. Every change is tagged with its lane.
- **Rule trial:** before a hospital's first questions go out, Anoop sees a per-rule summary of Errors and Warnings once.
- **Check set:** 5 claims per pilot hospital that Anoop knows are correct; re-checked after any mapping or rule change.

## Portal terms

- **Column mapping:** linking a hospital sheet's column header to a standard field.
- **Policy B + D:** a mapping approved once per hospital + scheme is reused across that hospital's tabs; other hospitals see it as a suggestion.
- **Value-shape check:** before reusing a mapping, checking that the column's values look like the field (amounts look like amounts, dates like dates).
- **Ignore:** a column that is not needed; never read, never in a report.
- **Question Sheet:** one Google Sheet per hospital, created by the portal's robot, where staff see and answer questions.
- **Status line:** the one line the portal writes at the top of each Question Sheet after every run.
- **Robot account:** the Google service account the portal uses. It reads hospital sheets and writes only to the Question Sheets it creates.
- **Worker:** the background program that actually reads sheets and cleans them. "Hosted worker" = it runs on a cloud machine on its own (6 AM daily and on Run now).
- **Run now:** starts a run at once for one sheet, one hospital, or all.
- **Change detection:** reading only the sheets and tabs that changed since the last run.
- **Retry:** the worker trying again by itself after a technical failure (at most 3 times).
