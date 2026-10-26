-- Migration 0009: the worker corrects PROPOSED mappings only. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into public.hospitals (hospital_code, hospital_name, status) values ('HOSP32P909001', 'Test Hospital Nine', 'ACTIVE');
insert into public.column_mappings (hospital_code, spreadsheet_id, tab_name, header_fp, source_header, source_column, canonical_field, confidence, method, status)
values
  ('HOSP32P909001', 'FAKEsheetNINE00000000000000000001', 'PAID', 'fp', 'PAYMENT RECEIVED DATE', 0, null, 0, 'UNMATCHED', 'PROPOSED'),
  ('HOSP32P909001', 'FAKEsheetNINE00000000000000000001', 'PAID', 'fp', 'DOA', 1, 'admission_date', 1, 'MANUAL', 'APPROVED');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$update public.column_mappings set canonical_field = 'payment_date', confidence = 0.95, method = 'ALIAS'
                  where source_header = 'PAYMENT RECEIVED DATE'$$, 'the worker corrects a PROPOSED mapping');
select throws_ok($$update public.column_mappings set canonical_field = 'discharge_date' where source_header = 'DOA'$$,
  '42501', null, 'an APPROVED mapping cannot be changed by the worker');
select throws_ok($$update public.column_mappings set status = 'APPROVED' where source_header = 'PAYMENT RECEIVED DATE'$$,
  '42501', null, 'the worker cannot approve a mapping (G1)');
reset role;
select ok(exists (select 1 from public.audit_log where table_name = 'column_mappings' and action = 'UPDATE'),
  'the correction is in the audit log');

select * from finish();
rollback;
