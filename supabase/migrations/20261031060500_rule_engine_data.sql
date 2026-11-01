-- Stage 2a: rules as data (decisions.md section 9, "rules are never hard-coded"), and
-- today's money rules (decisions.md section 8; requirements.md sections 8 and 11-12).
-- Anoop's answers 31-Oct: fresh ~30-rule list (old IDs kept where the meaning is the same);
-- two-part approvals combine only after a person confirms (Stage 2c, not here).
-- Backup first; apply to live only after Anoop's OK (CLAUDE.md "Schema changes").

-------------------------------------------------------------------------------
-- 1. rule_versions: the check itself, as data (engine.ts), not as a rule ID in code.
-------------------------------------------------------------------------------
alter table public.rule_versions
  add column if not exists check_definition jsonb,
  add column if not exists action text check (action in ('AUTOMATIC', 'AI_SUGGESTION', 'ASK_STAFF')),
  add column if not exists staff_message text,
  add column if not exists approver_note text;
alter table public.rule_versions alter column condition_text drop not null;
comment on column public.rule_versions.check_definition is
  'Stage 2a: the check itself (engine.ts SIMPLE / SIMPLE_FOR_EACH). NULL for REFERENCE rows (the check stays in code) and the R-T01 parameter rule.';
comment on column public.rule_versions.action is 'AUTOMATIC / AI_SUGGESTION / ASK_STAFF (requirements.md section 12).';
comment on column public.rule_versions.approver_note is 'Free text next to approved_by, e.g. "approved with the Stage 2 plan" for a seed with no individual review.';

-------------------------------------------------------------------------------
-- 2. claims_staging: the new money columns (decisions.md section 8). deduction_amount and
--    tds_amount are repurposed (always computed from Stage 2a on; column-dictionary.md
--    section 4). gross_amount, discount_1_amount, discount_1_pct, discount_2_amount,
--    discount_2_pct, discount_2_confirmed, tds_path, discount_2_resolution are retired:
--    the columns stay (old history is never deleted) but nothing writes them from now on.
-------------------------------------------------------------------------------
alter table public.claims_staging
  add column if not exists discount_amount numeric,
  add column if not exists expected_tds_amount numeric,
  add column if not exists expected_settlement_amount numeric,
  add column if not exists balance_amount numeric;
comment on column public.claims_staging.discount_amount is 'The hospital''s own "Discount" column (decisions.md section 8); compared with deduction_amount by rule R-F01.';
comment on column public.claims_staging.deduction_amount is 'Deduction (C) = Bill - Approved - Co-pay. Always computed from Stage 2a; earlier rows may hold a stray sheet value from before the fix.';
comment on column public.claims_staging.tds_amount is 'Total TDS (C): sum of the hospital''s stated TDS per payment. Never derived from a rate, from Stage 2a.';
comment on column public.claims_staging.expected_tds_amount is 'Approved x the normal rate, for comparison only (R-F03). Never written as a fact.';
comment on column public.claims_staging.expected_settlement_amount is 'Expected settlement (C) = Approved - Total TDS.';
comment on column public.claims_staging.balance_amount is 'Balance Amount (C) = Approved - Total TDS - Total Settled. Zero allowed; negative is an Error (R-F06).';
comment on column public.claims_staging.gross_amount is 'Retired Stage 2a (old Discount 1/2 / TDS-path model). Column kept, never written from now on.';
comment on column public.claims_staging.discount_1_amount is 'Retired Stage 2a: see deduction_amount.';
comment on column public.claims_staging.discount_2_amount is 'Retired Stage 2a: see balance_amount.';

-------------------------------------------------------------------------------
-- 3. Retire every old ACTIVE/PROPOSED/PREVIEWED rule_versions row, except R-Y03 (the
--    same-patient-same-admission-date check: still run from code, by packages/worker/src/
--    identity.ts; Stage 2c moves it into the Rule Library). History is kept (decisions.md
--    section 12, "Delete = Inactive"); fresh versions are inserted below for the 36 rules
--    this stage keeps or adds. 25 old rule IDs are not reseeded (no longer meaningful under
--    today's money rules, or never implemented): R-A04, R-A06, R-A08 to R-A12, R-D02, R-M01,
--    R-M02, R-P01 to R-P03, R-S08, R-U02, R-U03, R-Y02, R-Y04 to R-Y10. Their `rules` catalogue
--    rows are left alone too (title stays, for history); only rule_versions rows are retired.
-------------------------------------------------------------------------------
-- One-time data change by this migration (no logged-in user): the G9 guard is off for this
-- statement only (same pattern as migration 20261026215627).
alter table public.rule_versions disable trigger guard_rule_status;
update public.rule_versions
  set status = 'RETIRED'
  where status in ('ACTIVE', 'PROPOSED', 'PREVIEWED') and rule_id <> 'R-Y03';
alter table public.rule_versions enable trigger guard_rule_status;

-------------------------------------------------------------------------------
-- 4. The Stage 2a rule list (packages/rules/src/initial-rules.ts is the one source; this
--    SQL was produced by packages/worker/scripts/rule-seed-sql.ts so it can never drift).
--    `rules` catalogue: 6 REFERENCE (reading-level, stay in code) + 29 CHECK + R-T01 (PARAMETER,
--    untouched below: its existing ACTIVE version and value are unchanged by this migration).
-------------------------------------------------------------------------------
insert into public.rules (rule_id, rule_type, title) values
  ('R-C01', 'CHECK', 'Non-data row (separator, total or banner)'),
  ('R-N02', 'CHECK', 'Cell cannot be read (date, amount or identifier)'),
  ('R-N05', 'CHECK', 'Negative amount in an amount field'),
  ('R-D04', 'CHECK', 'Date in the future'),
  ('R-D05', 'CHECK', 'Date before 01-Jan-2019'),
  ('R-Y01', 'CHECK', 'Header layout changed'),
  ('R-T01', 'PARAMETER', 'Default TDS rate 10 percent'),
  ('R-D01', 'CHECK', 'Discharge earlier than admission'),
  ('R-D03', 'CHECK', 'Settlement earlier than hardcopy sent or admission'),
  ('R-D06', 'CHECK', 'Day-month swap could not resolve the stay'),
  ('R-D07', 'CHECK', 'Hardcopy sent before discharge date'),
  ('R-W01', 'CHECK', 'Stay over 30 days'),
  ('R-A01', 'CHECK', 'Approved amount greater than claimed'),
  ('R-A02', 'CHECK', 'Claimed amount greater than bill'),
  ('R-A03', 'CHECK', 'Settled amount greater than approved'),
  ('R-A05', 'CHECK', 'Approved amount missing for an approved or settled claim'),
  ('R-A07', 'CHECK', 'Approved amount greater than bill'),
  ('R-F01', 'CHECK', 'Discount differs from Bill minus Approved minus Co-pay'),
  ('R-F02', 'CHECK', 'TDS empty on a paid claim'),
  ('R-F03', 'CHECK', 'TDS differs from the normal rate'),
  ('R-F04', 'CHECK', 'Paid amount differs from the expected settlement'),
  ('R-F05', 'CHECK', 'Settled amount equal to approved amount'),
  ('R-F06', 'CHECK', 'Balance Amount is negative'),
  ('R-N01', 'CHECK', 'Patient name empty'),
  ('R-N03', 'CHECK', 'Claim number missing'),
  ('R-N04', 'CHECK', 'Department, procedure or doctor missing'),
  ('R-S01', 'CHECK', 'Settled claim has no UTR'),
  ('R-S02', 'CHECK', 'Settled claim missing settlement date or amount'),
  ('R-S03', 'CHECK', 'Settlement data present but status not Settled'),
  ('R-S04', 'CHECK', 'Approved claim missing approved amount'),
  ('R-S05', 'CHECK', 'Rejected or cancelled claim has approved or settled amount'),
  ('R-S06', 'CHECK', 'Claim status unknown'),
  ('R-S07', 'CHECK', 'Row colour has no confirmed meaning'),
  ('R-S09', 'CHECK', 'Approved claim overdue by 60 days with no payment'),
  ('R-S10', 'CHECK', 'Reason missing for rejected or cancelled claim'),
  ('R-U01', 'CHECK', 'UTR looks implausible'),
  ('R-X01', 'CHECK', 'Status sources disagree')
on conflict (rule_id) do update set rule_type = excluded.rule_type, title = excluded.title;

insert into public.rule_versions
  (rule_id, version, status, severity, condition_text, check_definition, action, staff_message, approved_by, approver_note)
select v.rule_id, coalesce(mv.max_version, 0) + 1, v.status, v.severity, v.condition_text, v.check_definition::jsonb, v.action, v.staff_message,
  (select id from auth.users where email = 'anoop@oksy.in'), 'approved with the Stage 2 plan (31-Oct-2026)'
from (values
  ('R-C01'::text, 'REFERENCE'::public.rule_status, null::public.rule_severity, 'Decided before any field is read; not a condition over cleaned values.', null, null, null),
  ('R-N02'::text, 'REFERENCE'::public.rule_status, null::public.rule_severity, 'A parsing failure, not a business condition.', null, null, null),
  ('R-N05'::text, 'REFERENCE'::public.rule_status, null::public.rule_severity, 'A parsing sanity check, applied to every amount field as it is read.', null, null, null),
  ('R-D04'::text, 'REFERENCE'::public.rule_status, null::public.rule_severity, 'Checked while the date is parsed; an implausible date is never used as a value.', null, null, null),
  ('R-D05'::text, 'REFERENCE'::public.rule_status, null::public.rule_severity, 'Checked while the date is parsed; an implausible date is never used as a value.', null, null, null),
  ('R-Y01'::text, 'REFERENCE'::public.rule_status, null::public.rule_severity, 'About reading the sheet, not one claim''s values; raised by the worker.', null, null, null),
  ('R-D01'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"discharge_date","operator":"BEFORE","compareField":"admission_date"}],"issueField":"discharge_date"}', 'AUTOMATIC', 'Discharge date ({discharge_date}) is before the admission date.'),
  ('R-D03'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"OR","conditions":[{"field":"payment_date","operator":"BEFORE","compareField":"admission_date"},{"field":"payment_date","operator":"BEFORE","compareField":"casesheet_sent_date"}],"issueField":"payment_date"}', 'AUTOMATIC', 'Settlement date ({payment_date}) is before the admission or hardcopy sent date.'),
  ('R-D06'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"date_swap_unresolved","operator":"FLAG_TRUE"}],"issueField":"discharge_date"}', 'ASK_STAFF', 'The stay is over 15 days (or negative) and swapping day and month did not fix it.'),
  ('R-D07'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"casesheet_sent_date","operator":"BEFORE","compareField":"discharge_date"}],"issueField":"casesheet_sent_date"}', 'AUTOMATIC', 'Hardcopy sent date ({casesheet_sent_date}) is before the discharge date.'),
  ('R-W01'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"los_days","operator":"GREATER_THAN","compareValue":30}],"issueField":"discharge_date"}', 'ASK_STAFF', 'Length of stay is over 30 days: please confirm the dates are correct.'),
  ('R-A01'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"approved_amount","operator":"GREATER_THAN","compareField":"claimed_amount"}],"issueField":"approved_amount"}', 'AUTOMATIC', 'Approved amount is greater than the claimed amount.'),
  ('R-A02'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"claimed_amount","operator":"GREATER_THAN","compareField":"bill_amount"}],"issueField":"claimed_amount"}', 'AUTOMATIC', 'Claimed amount is greater than the bill amount.'),
  ('R-A03'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"total_settled","operator":"GREATER_THAN","compareField":"approved_amount"}],"issueField":"settled_amount"}', 'AUTOMATIC', 'Total settled is greater than the approved amount.'),
  ('R-A05'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"is_approved_or_settled","operator":"FLAG_TRUE"},{"field":"approved_amount","operator":"EMPTY"}],"issueField":"approved_amount"}', 'ASK_STAFF', 'Claim is Approved or Settled but has no approved amount.'),
  ('R-A07'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"approved_amount","operator":"GREATER_THAN","compareField":"bill_amount"}],"issueField":"approved_amount"}', 'AUTOMATIC', 'Approved amount is greater than the bill amount.'),
  ('R-F01'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"discount_amount","operator":"NOT_EMPTY"},{"field":"discount_amount","operator":"DIFFERS_BY_MORE_THAN","compareField":"deduction_amount","toleranceAmount":1}],"issueField":"discount_amount"}', 'ASK_STAFF', 'The Discount you entered ({discount_amount}) differs from Bill - Approved - Co-pay ({deduction_amount}).'),
  ('R-F02'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"total_settled","operator":"NOT_EMPTY"},{"field":"total_tds","operator":"EMPTY"}],"issueField":"tds_amount_stated"}', 'ASK_STAFF', 'A payment is recorded but TDS is blank. Expected TDS at 10% of approved is {expected_tds_amount}.'),
  ('R-F03'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"total_tds","operator":"NOT_EMPTY"},{"field":"total_tds","operator":"DIFFERS_BY_MORE_THAN","compareField":"expected_tds_amount","toleranceAmount":1}],"issueField":"tds_amount_stated"}', 'ASK_STAFF', 'TDS entered ({total_tds}) differs from the normal rate''s expected amount ({expected_tds_amount}).'),
  ('R-F04'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"total_settled","operator":"NOT_EMPTY"},{"field":"total_settled","operator":"DIFFERS_BY_MORE_THAN","compareField":"expected_settlement","toleranceAmount":1}],"issueField":"settled_amount"}', 'ASK_STAFF', 'Total settled ({total_settled}) differs from Approved minus TDS ({expected_settlement}).'),
  ('R-F05'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"total_settled","operator":"NOT_EMPTY"},{"field":"total_settled","operator":"EQUALS","compareField":"approved_amount"}],"issueField":"settled_amount"}', 'ASK_STAFF', 'Settled amount equals the approved amount: TDS looks like it was not deducted.'),
  ('R-F06'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"balance_amount","operator":"LESS_THAN","compareValue":0}],"issueField":"balance_amount"}', 'AUTOMATIC', 'Balance (Approved - Total TDS - Total Settled) is negative ({balance_amount}).'),
  ('R-N01'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"patient_name","operator":"EMPTY"}],"issueField":"patient_name"}', 'ASK_STAFF', 'Patient name is empty.'),
  ('R-N03'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"is_under_treatment","operator":"FLAG_FALSE"},{"field":"preauth_or_claim_no","operator":"EMPTY"}],"issueField":"preauth_or_claim_no"}', 'ASK_STAFF', 'Claim number is missing (only an Under Treatment case may have none).'),
  ('R-N04'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE_FOR_EACH","fieldList":["department","treatment_or_surgery","doctor_name"],"operator":"EMPTY"}', 'ASK_STAFF', '{field} is empty.'),
  ('R-S01'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"is_settled","operator":"FLAG_TRUE"},{"field":"has_utr","operator":"FLAG_FALSE"}],"issueField":"utr_no"}', 'ASK_STAFF', 'Claim is Settled but has no UTR.'),
  ('R-S02'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"is_settled","operator":"FLAG_TRUE"},{"field":"settlement_date_or_amount_missing","operator":"FLAG_TRUE"}],"issueField":"settlement_date"}', 'ASK_STAFF', 'Claim is Settled but is missing the settlement date or the settled amount.'),
  ('R-S03'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"is_settled","operator":"FLAG_FALSE"},{"field":"claim_status","operator":"NOT_EQUALS","compareValue":"UNKNOWN"},{"field":"settlement_data_present","operator":"FLAG_TRUE"}],"issueField":"claim_status"}', 'ASK_STAFF', 'A settled amount or UTR is present but the status is not Settled.'),
  ('R-S04'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"is_approved","operator":"FLAG_TRUE"},{"field":"approved_amount","operator":"EMPTY"}],"issueField":"approved_amount"}', 'ASK_STAFF', 'Claim is Approved but has no approved amount.'),
  ('R-S05'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"is_rejected_or_cancelled","operator":"FLAG_TRUE"},{"field":"amounts_present","operator":"FLAG_TRUE"}],"issueField":"claim_status"}', 'ASK_STAFF', 'Claim is Rejected or Cancelled but an approved or settled amount is present.'),
  ('R-S06'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"claim_status","operator":"EQUALS","compareValue":"UNKNOWN"}],"issueField":"claim_status"}', 'ASK_STAFF', 'Claim status could not be worked out from the tab, the status column or a confirmed colour.'),
  ('R-S07'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"status_colour_unconfirmed","operator":"FLAG_TRUE"}],"issueField":"claim_status"}', 'ASK_STAFF', 'This row''s colour has no confirmed meaning for this hospital.'),
  ('R-S09'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"is_approved","operator":"FLAG_TRUE"},{"field":"total_settled","operator":"EMPTY"},{"field":"discharge_date","operator":"BEFORE","compareValue":"TODAY","offsetDays":-60}],"issueField":"approved_amount"}', 'ASK_STAFF', 'Approved more than 60 days ago (from discharge) with no payment yet.'),
  ('R-S10'::text, 'ACTIVE'::public.rule_status, 'E'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"reason_missing_for_rejected_or_cancelled","operator":"FLAG_TRUE"}],"issueField":"claim_status"}', 'ASK_STAFF', 'Claim is Rejected or Cancelled but has no reason.'),
  ('R-U01'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"utr_shape_invalid","operator":"FLAG_TRUE"}],"issueField":"utr_no"}', 'ASK_STAFF', 'UTR does not look like a real UTR (length or characters).'),
  ('R-X01'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, null, '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"status_sources_disagree","operator":"FLAG_TRUE"}],"issueField":"claim_status"}', 'ASK_STAFF', 'The tab, status column and row colour do not all agree on the status.')
) as v(rule_id, status, severity, condition_text, check_definition, action, staff_message)
left join (select rule_id, max(version) as max_version from public.rule_versions group by rule_id) mv on mv.rule_id = v.rule_id;
