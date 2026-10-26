-- S2 Rule Library Seed (file 02 section 4, file 04 section 5 slice S2).
-- Seeds the 53 catalogue rules: 31 ACTIVE (from v1), 16 PROPOSED (shadow mode, D-043, D-066),
-- and 6 RETIRED. Plus worker table grants for rules and rule_versions (least privilege).
-- CLAUDE.md hard rules 5, 8, 9, 10. Applied by Anoop with `supabase db push --linked`.

-------------------------------------------------------------------------------
-- 1. Rules table: rule_id, rule_type, title
-------------------------------------------------------------------------------
insert into public.rules (rule_id, rule_type, title) values
  -- Dates
  ('R-D01', 'CHECK', 'Discharge earlier than admission'),
  ('R-D02', 'CHECK', 'Date order broken'),
  ('R-D03', 'CHECK', 'Settlement earlier than casesheet sent or admission'),
  ('R-D04', 'CHECK', 'Date in the future'),
  ('R-D05', 'CHECK', 'Date before 01-Jan-2019'),
  ('R-D06', 'CHECK', 'Length of stay over 15 days swap check'),

  -- Amounts
  ('R-A01', 'CHECK', 'Approved amount greater than claimed'),
  ('R-A02', 'CHECK', 'Claimed amount greater than bill'),
  ('R-A03', 'CHECK', 'Settled amount greater than approved'),
  ('R-A04', 'CHECK', 'Old Discount 2 check (retired)'),
  ('R-A05', 'CHECK', 'Approved amount missing for approved or settled claim'),
  ('R-A06', 'CHECK', 'Old 10 percent settlement check (retired)'),
  ('R-A07', 'CHECK', 'Approved amount greater than bill'),
  ('R-A08', 'CHECK', 'Discount 1 below zero'),
  ('R-A09', 'CHECK', 'Discount 2 below minus INR 2'),
  ('R-A10', 'CHECK', 'Expected discount percent differs by more than INR 2'),
  ('R-A11', 'CHECK', 'Discount 2 open more than 30 days after settlement'),
  ('R-A12', 'CHECK', 'TDS path check'),

  -- Parameter
  ('R-T01', 'PARAMETER', 'Default TDS rate 10 percent'),

  -- Status
  ('R-S01', 'CHECK', 'Settled claim has no UTR number'),
  ('R-S02', 'CHECK', 'Settled claim missing settlement date or amount'),
  ('R-S03', 'CHECK', 'Settlement fields filled but status not settled'),
  ('R-S04', 'CHECK', 'Approved claim missing approved amount'),
  ('R-S05', 'CHECK', 'Rejected or cancelled claim has approved or settled amount'),
  ('R-S06', 'CHECK', 'Status unknown'),
  ('R-S07', 'CHECK', 'Status from unconfirmed colour'),
  ('R-S08', 'CHECK', 'Required fields of stage missing'),
  ('R-S09', 'CHECK', 'Approved claim overdue by 60 days'),
  ('R-S10', 'CHECK', 'Rejected or cancelled claim missing reason'),

  -- UTR
  ('R-U01', 'CHECK', 'UTR number implausible shape'),
  ('R-U02', 'CHECK', 'Same UTR on rows of different hospitals'),
  ('R-U03', 'CHECK', 'Same UTR on many rows batch settlement'),

  -- Duplicates and identity
  ('R-P01', 'CHECK', 'Duplicate patient admission date in same hospital'),
  ('R-P02', 'CHECK', 'Duplicate claim number across hospitals'),
  ('R-P03', 'CHECK', 'Same policy card number and admission date'),
  ('R-N01', 'CHECK', 'Patient name empty or junk'),
  ('R-N02', 'CHECK', 'Required field NULL or unreadable'),
  ('R-N03', 'CHECK', 'Claim number missing for non-treatment stage'),
  ('R-N04', 'CHECK', 'Department, procedure or doctor missing'),

  -- Master data and other
  ('R-M01', 'CHECK', 'Value not in master data after matching'),
  ('R-M02', 'CHECK', 'Private insurer named on government scheme'),
  ('R-C01', 'CHECK', 'Non data row total subtotal or banner'),
  ('R-X01', 'CHECK', 'Scheme portal export and sheet disagree'),

  -- Sync
  ('R-Y01', 'CHECK', 'Header layout changed'),
  ('R-Y02', 'CHECK', 'Record missing from latest snapshot'),
  ('R-Y03', 'CHECK', 'Duplicate record key in snapshot'),
  ('R-Y04', 'CHECK', 'Settled record changed to non-settled'),
  ('R-Y05', 'CHECK', 'Previously filled field became empty'),
  ('R-Y06', 'CHECK', 'Settled financial fields changed after settlement'),
  ('R-Y07', 'CHECK', 'Hospital mode check (retired)'),
  ('R-Y08', 'CHECK', 'Portal comparison check (retired)'),
  ('R-Y09', 'CHECK', 'Scheme comparison check (retired)'),
  ('R-Y10', 'CHECK', 'Migration freeze check (retired)')
on conflict (rule_id) do update set
  rule_type = excluded.rule_type,
  title = excluded.title;

-------------------------------------------------------------------------------
-- 2. Rule versions table: the 31 ACTIVE rules (from v1)
-------------------------------------------------------------------------------
insert into public.rule_versions
  (rule_id, version, status, severity, tier, auto_fix_allowed, condition_text, action)
values
  -- Dates (ACTIVE)
  ('R-D01', 1, 'ACTIVE', 'E', 'C', false,
   'discharge_date earlier than admission_date',
   'Flag error; cannot migrate until resolved'),
  ('R-D03', 1, 'ACTIVE', 'E', 'C', false,
   'settlement_date earlier than casesheet_sent_date or admission_date',
   'Flag error; cannot migrate until resolved'),
  ('R-D04', 1, 'ACTIVE', 'E', 'C', false,
   'Any date in the future',
   'Flag error; date out of plausible window'),
  ('R-D05', 1, 'ACTIVE', 'E', 'C', false,
   'Any date before 01-Jan-2019',
   'Flag error; date out of plausible window'),

  -- Amounts (ACTIVE)
  ('R-A01', 1, 'ACTIVE', 'E', 'C', false,
   'approved_amount greater than claimed_amount',
   'Flag error; approved amount exceeds claimed amount'),
  ('R-A02', 1, 'ACTIVE', 'W', 'C', false,
   'claimed_amount greater than bill_amount (scheme packages may differ)',
   'Warning; claimed amount exceeds bill amount'),
  ('R-A03', 1, 'ACTIVE', 'E', 'C', false,
   'settled_amount greater than approved_amount',
   'Flag error; settled amount exceeds approved amount'),
  ('R-A05', 1, 'ACTIVE', 'E', 'C', false,
   'Amount zero or NULL for a claim with status APPROVED or SETTLED',
   'Flag error; approved amount missing for approved or settled claim'),

  -- Status (ACTIVE)
  ('R-S01', 1, 'ACTIVE', 'E', 'C', false,
   'SETTLED but no utr_no',
   'Flag error; settled claim has no UTR number'),
  ('R-S02', 1, 'ACTIVE', 'E', 'C', false,
   'SETTLED but no settlement_date or settled_amount',
   'Flag error; settled claim missing settlement date or settled amount'),
  ('R-S03', 1, 'ACTIVE', 'W', 'C', false,
   'Settlement fields filled but status not SETTLED',
   'Warning; settlement data present on non-settled claim'),
  ('R-S04', 1, 'ACTIVE', 'E', 'C', false,
   'APPROVED but approved_amount missing',
   'Flag error; approved claim missing approved amount'),
  ('R-S05', 1, 'ACTIVE', 'W', 'C', false,
   'REJECTED or CANCELLED but approved or settled amount present',
   'Warning; rejected or cancelled claim has approved or settled amount'),
  ('R-S06', 1, 'ACTIVE', 'E', 'C', false,
   'Status UNKNOWN (no confirmed status column or colour)',
   'Flag error; claim status unknown'),
  ('R-S07', 1, 'ACTIVE', 'E', 'C', false,
   'Status from colour not yet confirmed for that hospital',
   'Flag error; status from unconfirmed colour legend (tier C)'),

  -- UTR (ACTIVE)
  ('R-U01', 1, 'ACTIVE', 'W', 'C', false,
   'utr_no implausible (under 8 or over 25 characters, spaces or symbols)',
   'Warning; UTR shape implausible'),
  ('R-U02', 1, 'ACTIVE', 'W', 'C', false,
   'Same utr_no on rows of different hospitals',
   'Warning; UTR seen across different hospitals'),
  ('R-U03', 1, 'ACTIVE', 'I', 'A', false,
   'Same utr_no on many rows: allowed (batch settlement), check the sum',
   'Info; batch settlement UTR verified'),

  -- Duplicates and identity (ACTIVE)
  ('R-P01', 1, 'ACTIVE', 'W', 'C', false,
   'Same hospital, patient_name, admission_date',
   'Warning; mark and link potential duplicate, never delete'),
  ('R-P03', 1, 'ACTIVE', 'W', 'C', false,
   'Same policy_or_card_no and admission_date',
   'Warning; potential duplicate policy card on same admission date'),
  ('R-N01', 1, 'ACTIVE', 'E', 'C', false,
   'Patient_name empty or junk (digits only, xxx)',
   'Flag error; patient name missing or invalid'),
  ('R-N02', 1, 'ACTIVE', 'E', 'C', false,
   'Required (R) field NULL or unreadable',
   'Flag error; required canonical field is missing or unreadable'),

  -- Master data and other (ACTIVE)
  ('R-M02', 1, 'ACTIVE', 'W', 'C', false,
   'Scheme KASP/MEDISEP but a private insurer named',
   'Warning; government scheme with private insurer'),
  ('R-C01', 1, 'ACTIVE', 'I', 'A', true,
   'Row is a total, subtotal, header repeat or blank separator',
   'Classify as NON_DATA_ROW'),
  ('R-X01', 1, 'ACTIVE', 'W', 'C', false,
   'Scheme-portal export and sheet disagree on amount or status',
   'Warning; scheme portal and sheet values differ, keep both'),

  -- Sync (ACTIVE)
  ('R-Y01', 1, 'ACTIVE', 'E', 'C', false,
   'Header layout changed (new, renamed, moved or removed column)',
   'Flag error; stop that sheet until G1 review'),
  ('R-Y02', 1, 'ACTIVE', 'W', 'C', false,
   'Record seen before is missing from latest snapshot (E after 3 consecutive days)',
   'Warning; record disappeared from source sheet'),
  ('R-Y03', 1, 'ACTIVE', 'W', 'C', false,
   'Same record key on more than one row in a snapshot',
   'Warning; duplicate record key within single snapshot'),
  ('R-Y04', 1, 'ACTIVE', 'E', 'C', false,
   'Previously SETTLED record changed to a non-settled status',
   'Flag error; settled status reverted, ask staff'),
  ('R-Y05', 1, 'ACTIVE', 'W', 'A', true,
   'Previously filled field became empty: keep earlier value, an emptied cell never erases a known value',
   'Auto-retain earlier known value, flag warning'),
  ('R-Y06', 1, 'ACTIVE', 'E', 'C', false,
   'Settled amount, UTR or approved amount changed after settlement',
   'Flag error; settled financial value changed after settlement')
on conflict (rule_id, version) do update set
  status = excluded.status,
  severity = excluded.severity,
  tier = excluded.tier,
  auto_fix_allowed = excluded.auto_fix_allowed,
  condition_text = excluded.condition_text,
  action = excluded.action;

-------------------------------------------------------------------------------
-- 3. Rule versions table: the 16 PROPOSED rules (shadow mode, D-043, D-066)
-------------------------------------------------------------------------------
insert into public.rule_versions
  (rule_id, version, status, severity, tier, auto_fix_allowed, parameter_name, parameter_value, condition_text, action)
values
  -- Dates (PROPOSED)
  ('R-D02', 2, 'PROPOSED', 'E', 'C', false, null, null,
   'Date order broken: admission <= discharge <= casesheet_sent <= settlement (equal allowed)',
   'Flag error in shadow mode'),
  ('R-D06', 2, 'PROPOSED', 'W', 'B', true, null, null,
   'LOS more than 15 days: run the swap check. A real stay above 60 days stays W',
   'Auto-apply if unique valid swap (tier B); staff question if ambiguous (tier C)'),

  -- Amounts (PROPOSED)
  ('R-A07', 3, 'PROPOSED', 'E', 'C', false, null, null,
   'approved_amount greater than bill_amount (equal allowed)',
   'Flag error in shadow mode'),
  ('R-A08', 3, 'PROPOSED', 'E', 'C', false, null, null,
   'Discount 1 below zero: approved + copay greater than bill. Not raised if R-A07 raised',
   'Flag error in shadow mode'),
  ('R-A09', 3, 'PROPOSED', 'E', 'C', false, null, null,
   'Discount 2 below minus INR 2: settled + tds greater than approved by > INR 2. Not raised if R-A03 raised',
   'Flag error in shadow mode'),
  ('R-A10', 3, 'PROPOSED', 'W', 'C', false, null, null,
   'A rule states an expected discount percent (Discount 1 or 2) and computed value differs by > INR 2',
   'Warning in shadow mode'),
  ('R-A11', 4, 'PROPOSED', 'W', 'C', false, null, null,
   'Discount 2 above zero and still OPEN more than 30 days after settlement date',
   'Warning in shadow mode'),
  ('R-A12', 5, 'PROPOSED', 'W', 'C', false, null, null,
   'TDS path check: settled / (1 - tds_rate) whole rupee test vs TDS on approved',
   'Warning in shadow mode'),

  -- Parameter (PROPOSED)
  ('R-T01', 3, 'PROPOSED', null, null, false, 'tds_rate', 0.10,
   'Default tds_rate = 10%. Overridden by any more specific ACTIVE rule that sets tds_rate.',
   'Sets default tds_rate to 10% and tds_rate_source to DEFAULT'),

  -- Status (PROPOSED)
  ('R-S08', 2, 'PROPOSED', 'E', 'C', false, null, null,
   'Required fields of the stage missing (file 01 canonical stages)',
   'Flag error in shadow mode'),
  ('R-S09', 2, 'PROPOSED', 'W', 'A', true, null, null,
   'APPROVED, no settlement, discharge + 60 days passed: set overdue_flag, pending_days, aging bucket',
   'Set overdue flag and aging bucket in shadow mode'),
  ('R-S10', 2, 'PROPOSED', 'E', 'C', false, null, null,
   'REJECTED without rejection_reason, or CANCELLED without cancellation_reason',
   'Flag error in shadow mode'),

  -- Duplicates and identity (PROPOSED)
  ('R-P02', 2, 'PROPOSED', 'E', 'C', false, null, null,
   'Duplicate claim no anywhere across all hospitals',
   'Mark, link, flag error in shadow mode'),
  ('R-N03', 2, 'PROPOSED', 'E', 'C', false, null, null,
   'One row = one claim; claim no required for every stage except UNDER_TREATMENT',
   'Flag error in shadow mode'),
  ('R-N04', 2, 'PROPOSED', 'W', 'C', false, null, null,
   'Department, procedure or doctor missing. Source never had column: NOT_RECORDED_IN_SOURCE',
   'Warning in shadow mode, staff question'),

  -- Master data (PROPOSED)
  ('R-M01', 2, 'PROPOSED', 'E', 'C', false, null, null,
   'Scheme, insurer, TPA, department, procedure, doctor or status not in master after matching',
   'Flag error until mapped or approved')
on conflict (rule_id, version) do update set
  status = excluded.status,
  severity = excluded.severity,
  tier = excluded.tier,
  auto_fix_allowed = excluded.auto_fix_allowed,
  parameter_name = excluded.parameter_name,
  parameter_value = excluded.parameter_value,
  condition_text = excluded.condition_text,
  action = excluded.action;

-------------------------------------------------------------------------------
-- 4. Rule versions table: the 6 RETIRED rules
-------------------------------------------------------------------------------
insert into public.rule_versions
  (rule_id, version, status, severity, tier, auto_fix_allowed, condition_text, action)
values
  ('R-A04', 1, 'RETIRED', null, null, false,
   'RETIRED in v2 (replaced by Discount 2 rules R-A08 to R-A11)',
   'Retired; no evaluation'),
  ('R-A06', 1, 'RETIRED', null, null, false,
   'RETIRED in v3, never active (old settled = approved x 0.90 check; replaced by R-T01 parameter)',
   'Retired; no evaluation'),
  ('R-Y07', 1, 'RETIRED', null, null, false,
   'RETIRED in v3: hospital modes',
   'Retired; may return for migration phase'),
  ('R-Y08', 1, 'RETIRED', null, null, false,
   'RETIRED in v3: portal comparison',
   'Retired; may return for migration phase'),
  ('R-Y09', 1, 'RETIRED', null, null, false,
   'RETIRED in v3: scheme comparison',
   'Retired; may return for migration phase'),
  ('R-Y10', 1, 'RETIRED', null, null, false,
   'RETIRED in v3: migration freeze',
   'Retired; may return for migration phase')
on conflict (rule_id, version) do update set
  status = excluded.status,
  severity = excluded.severity,
  tier = excluded.tier,
  auto_fix_allowed = excluded.auto_fix_allowed,
  condition_text = excluded.condition_text,
  action = excluded.action;

-------------------------------------------------------------------------------
-- 5. Worker table grants (least privilege): worker needs read access to rules
-------------------------------------------------------------------------------
grant select on public.rules, public.rule_versions to service_role;

-- Reload schema cache
notify pgrst, 'reload schema';
