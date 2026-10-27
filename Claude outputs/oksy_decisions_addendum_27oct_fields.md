# Oksy Data Cleanse – Decisions Addendum (27-Oct-2026, Stage 3 close and fields)

Add these to the Confirmed Decisions Log. Confirmed by Anoop Das. (The Log itself is not in the repository; this addendum follows the format of oksy_decisions_addendum_27oct_access.md.)

## Stage 3
- **Stage 3 approved** by Anoop Das on 27-Oct-2026.

## Column mapping fields (27-Oct-2026)
- A report has the same columns, in the same order, for every hospital. A hospital without a column shows blank cells.
- Fields added: Phone Number, Policy Holder Name, Room Category, Follow-up Date, Pre-auth Approved Amount. Follow-up log stays.
- **Balance Status:** needed, added as a field. **Query Details:** not needed.
- Hardcopy Sent Date = the existing case-sheet sent date field; POD Number = the existing courier number field. No new fields for them.
- Room No and Room Category both stay as fields; Anoop sets those columns to Ignore himself.
- Column Mappings has **Ignore (not needed)**: the column is not part of the data and not in any report. "extra_fields" is only for columns nobody has decided on yet.
- The Yes/No question for unexpected extra columns is Stage 6. Yes adds the column to every hospital's report (blank where missing); only the Owner decides.
- Header changes between months stay strict: each header layout is confirmed separately. Only Owner and Admin confirm mappings.

## Fields page
- Fields are kept in a database list: an internal key that never changes, a label, a type (text, number, date, amount), aliases, status (Active or Hidden), and a "core" mark for the 35 original fields.
- Owner and Admin manage it on a Fields page: add, rename (label only, so mappings never break), change type (warning first once data exists), change aliases, hide or show, delete only when no column uses the field (otherwise "in use, hide instead").
- Column Mappings offers the Active fields, Ignore, and "+ Create new field". Hidden fields are not offered for new mappings.
- New fields keep their data in the extra data of each claim; no new database column per field.
- Reports show every Active field in a fixed order.
- Core fields (the 35 original ones) cannot be deleted, and their type cannot be changed. Their label and aliases can be edited. *(Anoop's decision, 27-Oct.)*
