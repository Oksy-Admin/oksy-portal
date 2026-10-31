-- Stage 1c: the reconcile migration. Tick-based reading (also the 3 tables whose policies
-- were already live), header decisions with the view tick, snapshots kept 12 months, the
-- change log per area, retired tables gone. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into public.users_roles (email, role, active) values
  ('t-14-admin@example.test', 'ADMIN', true),
  ('t-14-ticks@example.test', 'USER', true),
  ('t-14-none@example.test', 'USER', true);
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-000000001401', 't-14-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000001402', 't-14-ticks@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000001403', 't-14-none@example.test', 'authenticated', 'authenticated');
insert into public.user_access_ticks (email, hospitals_view, clean_data_view, rule_library_view)
  values ('t-14-ticks@example.test', true, true, true);
insert into public.user_access_ticks (email) values ('t-14-none@example.test');

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

insert into public.hospitals (hospital_code, hospital_name, district, status) values ('HOSP32P914001', 'Test Hospital 14', 'TESTDISTRICT', 'ACTIVE');
insert into public.hospital_sheets (sheet_key, hospital_code, scheme, sheet_status, spreadsheet_id, sync)
  values ('HOSP32P914001|PRIVATE', 'HOSP32P914001', 'PRIVATE', 'LINKED', 'FAKEsheet14000000000000000000001', 'YES');
insert into public.hospital_id_history (hospital_key, old_hospital_id, new_hospital_id)
  select hospital_key, 'HOSP32P914000', 'HOSP32P914001' from public.hospitals where hospital_code = 'HOSP32P914001';
insert into public.report_downloads (shown_hospital_id, file_type, row_count) values ('HOSP32P914001', 'CSV', 1);
insert into public.rule_upload_batches (file_name) values ('fake-rules.csv');
insert into public.column_mappings (hospital_code, spreadsheet_id, tab_name, header_fp, source_header, source_column, canonical_field, confidence, method, status, scheme, header_key)
  values ('HOSP32P914001', 'FAKEsheet14000000000000000000001', 'OCT 2026', 'a', 'BILL AMOUNT', 1, 'bill_amount', 1, 'MANUAL', 'PROPOSED', 'PRIVATE', 'billamount');
insert into public.header_decisions (hospital_code, scheme, header_key, source_header, canonical_field, method)
  values ('HOSP32P914001', 'PRIVATE', 'billamount', 'BILL AMOUNT', 'bill_amount', 'MIGRATED');
insert into public.jobs (id, kind, sheet_key, mode, status) values ('00000000-0000-0000-0000-000000001410', 'SHEET_RUN', 'HOSP32P914001|PRIVATE', 'DRY_RUN', 'SUCCEEDED');
insert into public.snapshots (id, job_id, hospital_code, sheet_key, spreadsheet_id, taken_at, tabs, raw, raw_sha256) values
  ('00000000-0000-0000-0000-000000001411', '00000000-0000-0000-0000-000000001410', 'HOSP32P914001', 'HOSP32P914001|PRIVATE', 'FAKEsheet14000000000000000000001',
   now() - interval '13 months', '[]', '[]', repeat('a', 64)),
  ('00000000-0000-0000-0000-000000001412', '00000000-0000-0000-0000-000000001410', 'HOSP32P914001', 'HOSP32P914001|PRIVATE', 'FAKEsheet14000000000000000000001',
   now() - interval '1 month', '[]', '[]', repeat('b', 64));
insert into public.reconciliations (hospital_code, sheet_key, job_id, result, counts, sums, differences, snapshot_id)
  values ('HOSP32P914001', 'HOSP32P914001|PRIVATE', '00000000-0000-0000-0000-000000001410', 'PASS', '{}', '{}', '[]', '00000000-0000-0000-0000-000000001411');

-------------------------------------------------------------------------------
-- 1. Reading follows the ticks
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-000000001403');
set local role authenticated;
select is((select count(*)::int from public.hospital_id_history) + (select count(*)::int from public.report_downloads)
          + (select count(*)::int from public.rule_upload_batches) + (select count(*)::int from public.header_decisions)
          + (select count(*)::int from public.snapshots), 0, 'without ticks: none of these tables shows a row');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000001402');
set local role authenticated;
select is((select count(*)::int from public.hospital_id_history), 1, 'Hospitals view tick: ID history');
select is((select count(*)::int from public.report_downloads), 1, 'Clean Data view tick: report downloads');
select is((select count(*)::int from public.rule_upload_batches), 1, 'Rule Library view tick: rule uploads');
select is((select count(*)::int from public.header_decisions), 1, 'Hospitals view tick: header decisions (Stage 1c)');
select is((select count(*)::int from public.snapshots), 0, 'raw sheet copies: not with ticks, Owner and Admin only');
select throws_ok($$insert into public.report_downloads (shown_hospital_id, file_type) values ('HOSP32P914001', 'CSV')$$,
  '42501', null, 'a view tick does not allow writing');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000001401');
set local role authenticated;
select is((select count(*)::int from public.snapshots where hospital_code = 'HOSP32P914001'), 2, 'Admin reads raw sheet copies');
select throws_ok($$select public.purge_old_snapshots()$$, '42501', null, 'only the worker runs the snapshot purge');
reset role;

-------------------------------------------------------------------------------
-- 2. Snapshots: kept 12 months (decision 31-Oct)
-------------------------------------------------------------------------------
select throws_ok($$delete from public.snapshots where id = '00000000-0000-0000-0000-000000001412'$$,
  'P0001', null, 'a snapshot younger than 12 months cannot be deleted');
select throws_ok($$update public.snapshots set raw = '{}'$$, 'P0001', null, 'a snapshot is never changed');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select public.purge_old_snapshots()), 1, 'the purge deletes only the copy older than 12 months');
select throws_ok($$delete from public.snapshots$$, '42501', null, 'the worker cannot delete snapshots directly');
reset role;
select is((select string_agg(id::text, ',') from public.snapshots where hospital_code = 'HOSP32P914001'),
  '00000000-0000-0000-0000-000000001412', 'the younger copy stays');
select is((select snapshot_id::text from public.reconciliations where hospital_code = 'HOSP32P914001'), null,
  'the reconciliation keeps its counts without the deleted copy');
select ok(exists (select 1 from public.audit_log where table_name = 'snapshots' and action = 'DELETE' and (after ->> 'deleted')::int = 1),
  'the purge is one audit entry with the count');

-------------------------------------------------------------------------------
-- 3. The change log covers access, hospital, field and mapping changes
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-000000001401');
set local role authenticated;
select public.set_access_ticks('t-14-none@example.test', '{"hospitals_view": true}', 'test 14');
select public.decide_header('HOSP32P914001', 'PRIVATE', 'billamount', 'IGNORE');
reset role;
update public.hospitals set hospital_name = 'Test Hospital 14 renamed' where hospital_code = 'HOSP32P914001';
update public.mapping_fields set label = label where key = 'remarks';
select ok(exists (select 1 from public.audit_log where table_name = 'user_access_ticks' and record_id = 't-14-none@example.test'), 'access change in the change log');
select ok(exists (select 1 from public.audit_log where table_name = 'hospitals' and action = 'UPDATE' and after ->> 'hospital_code' = 'HOSP32P914001'), 'hospital change in the change log');
select ok(exists (select 1 from public.audit_log where table_name = 'mapping_fields' and record_id = 'remarks'), 'field change in the change log');
select ok(exists (select 1 from public.audit_log where table_name = 'header_decisions' and after ->> 'canonical_field' = 'IGNORE'), 'mapping decision in the change log');

-------------------------------------------------------------------------------
-- 4. Retired tables and functions are gone
-------------------------------------------------------------------------------
select ok(to_regclass('public.hospital_aliases') is null and to_regclass('public.golden_tests') is null
          and to_regclass('public.discount2_decisions') is null and to_regclass('public.import_runs') is null,
  'retired tables do not exist');
select ok(to_regprocedure('public.import_register(jsonb)') is null and to_regprocedure('public.confirm_discount2_decision(uuid, boolean, text)') is null,
  'retired functions do not exist');

select * from finish();
rollback;
