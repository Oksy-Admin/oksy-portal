-- S1 tests: jobs ("Run now" only queues), snapshots never edited, claims and payments
-- never deleted, cleaned data ADMIN and APPROVER only, exports logged by the exporter.
-- Fake data only (HOSP32P9xxxxx codes and FAKE sheet IDs are not real).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into public.users_roles (email, role) values
  ('t8-approver@example.test', 'APPROVER'),
  ('t8-helper@example.test', 'HELPER'),
  ('t8-user@example.test', 'USER');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000008a1', 't8-approver@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000008a2', 't8-helper@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000008a3', 't8-user@example.test', 'authenticated', 'authenticated');

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

insert into public.hospitals (hospital_code, hospital_name, status) values
  ('HOSP32P908001', 'Test Hospital Eight', 'ACTIVE');
insert into public.hospital_sheets (sheet_key, hospital_code, scheme, sheet_status, spreadsheet_id, sync) values
  ('HOSP32P908001|PRIVATE', 'HOSP32P908001', 'PRIVATE', 'LINKED', 'FAKEsheetEIGHT0000000000000000001', 'YES'),
  ('HOSP32P908001|KASP', 'HOSP32P908001', 'KASP', 'LINKED', 'FAKEsheetEIGHTHOLD00000000000002', 'HOLD');

select is((select sync from public.hospital_sheets where sheet_key = 'HOSP32P000107|PRIVATE'), 'YES',
  'the HMS PRIVATE sheet row exists with SYNC = YES (register v4)');

-------------------------------------------------------------------------------
-- "Run now": open to every approved user (decision section 3, 27-Oct); never a HOLD sheet;
-- one active job per sheet
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a2');
set local role authenticated;
select throws_ok($$select public.request_sheet_run('HOSP32P908001|KASP')$$, '42501', null,
  'a HOLD sheet is never queued (hard rule 4)');
select lives_ok($$select public.request_sheet_run('HOSP32P908001|PRIVATE')$$, 'an approved user (here HELPER) queues a run');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
set local role authenticated;
select throws_ok($$select public.request_sheet_run('HOSP32P908001|PRIVATE')$$, '23505', null,
  'a second run for the same sheet is refused while one is queued');
select is((select count(*)::int from public.jobs where sheet_key = 'HOSP32P908001|PRIVATE' and status = 'QUEUED'), 1,
  'APPROVER sees the queued job');
select throws_ok($$insert into public.jobs (sheet_key) values ('HOSP32P908001|PRIVATE')$$, '42501', null,
  'nobody inserts a job directly');
reset role;
select ok(exists (select 1 from public.audit_log where table_name = 'jobs' and action = 'INSERT'),
  'the queued job is in the audit log');

-------------------------------------------------------------------------------
-- The worker runs the job: snapshot, claim, payment, issue, reconciliation
-------------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.jobs set status = 'RUNNING', started_at = now(), attempts = 1 where sheet_key = 'HOSP32P908001|PRIVATE';
insert into public.snapshots (job_id, hospital_code, sheet_key, spreadsheet_id, tabs, raw, raw_sha256)
  select id, 'HOSP32P908001', sheet_key, 'FAKEsheetEIGHT0000000000000000001', '[]', '{"fake": true}', repeat('a', 64)
    from public.jobs where sheet_key = 'HOSP32P908001|PRIVATE';
insert into public.claims_staging (record_key, hospital_code, scheme, patient_name, bill_amount, approved_amount, copay_amount,
                                   settled_amount, source_file, source_tab, source_row, row_class, content_hash)
  values ('HOSP32P908001|PRIVATE|C:FAKE001', 'HOSP32P908001', 'PRIVATE', 'Fake Patient', 120000, 100000, 5000, 85500,
          'FAKEsheetEIGHT0000000000000000001', 'PAID', 2, 'CLEAN', 'h1');
insert into public.claims_staging (record_key, hospital_code, scheme, source_file, source_tab, source_row, row_class, content_hash)
  values ('HOSP32P908001|PRIVATE|C:FAKE001', 'HOSP32P908001', 'PRIVATE', 'FAKEsheetEIGHT0000000000000000001', 'PAID', 2, 'CLEAN', 'h2')
  on conflict (record_key) do update set content_hash = excluded.content_hash;
insert into public.payments (record_uid, record_key, payment_no, hospital_code, amount_received, utr_no,
                             source_file, source_tab, source_row, content_hash)
  select record_uid, record_key, 1, hospital_code, 85500, '{FAKEUTR0001}', source_file, source_tab, source_row, 'p1'
    from public.claims_staging where record_key = 'HOSP32P908001|PRIVATE|C:FAKE001';
insert into public.issues (record_uid, hospital_code, rule_id, severity, shadow)
  select record_uid, hospital_code, 'R-A12', 'W', true from public.claims_staging where record_key = 'HOSP32P908001|PRIVATE|C:FAKE001';
reset role;
select is((select count(*)::int from public.claims_staging where record_key = 'HOSP32P908001|PRIVATE|C:FAKE001'), 1,
  'an upsert of the same record key keeps one row (no duplicate)');
select is((select hospital_name from public.claims_staging where record_key = 'HOSP32P908001|PRIVATE|C:FAKE001'),
  'Test Hospital Eight', 'the hospital name comes from the Hospital Master');
select is((select bill_amount::text from public.claims_staging where record_key = 'HOSP32P908001|PRIVATE|C:FAKE001'),
  '120000', 'source amounts are exact decimals');

set local role service_role;
select throws_ok($$update public.snapshots set raw = '{}'$$, null, null, 'a snapshot is never edited');
select throws_ok($$delete from public.claims_staging$$, '42501', null, 'the worker cannot delete claims');
select throws_ok($$delete from public.payments$$, '42501', null, 'the worker cannot delete payments');
select throws_ok($$insert into public.jobs (sheet_key) values ('HOSP32P908001|PRIVATE')$$, '42501', null,
  'the worker cannot create jobs, only run them');
reset role;
select throws_ok($$delete from public.claims_staging$$, null, null, 'even the database owner cannot delete claims (hard rule 5)');

-------------------------------------------------------------------------------
-- Who sees cleaned data (hard rule 10)
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a3');
set local role authenticated;
select is((select count(*)::int from public.claims_staging) + (select count(*)::int from public.payments)
        + (select count(*)::int from public.snapshots) + (select count(*)::int from public.jobs), 0,
  'USER sees no claims, payments, snapshots or jobs');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000008a2');
set local role authenticated;
select is((select count(*)::int from public.claims_staging) + (select count(*)::int from public.payments), 0,
  'HELPER sees no cleaned claims or payments');
select is((select count(*)::int from public.jobs where sheet_key = 'HOSP32P908001|PRIVATE'), 1, 'HELPER sees job status');
select throws_ok($$insert into public.export_runs (format, row_count) values ('CSV', 1)$$, '42501', null,
  'HELPER cannot export');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
set local role authenticated;
select is((select count(*)::int from public.claims_staging where record_key like 'HOSP32P908001|%'), 1, 'APPROVER sees cleaned claims');
select is((select count(*)::int from public.payments where record_key like 'HOSP32P908001|%'), 1, 'APPROVER sees payments');
select lives_ok($$insert into public.export_runs (format, filters, row_count, totals) values ('CSV', '{}', 1, '{}')$$,
  'APPROVER logs an export');
select throws_ok($$update public.claims_staging set bill_amount = 1$$, '42501', null,
  'nobody edits cleaned data by hand in the portal (D-026)');
reset role;
select is((select exported_by from public.export_runs order by at desc limit 1),
  '00000000-0000-0000-0000-0000000008a1'::uuid, 'the export log stores who exported');

select * from finish();
rollback;
