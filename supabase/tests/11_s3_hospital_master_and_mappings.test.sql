-- S3 tests: Hospital Master worker rights, version groups, and G1 column mapping approval.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.users_roles (email, role) values
  ('t-s3-helper@example.test', 'HELPER'),
  ('t-s3-user@example.test', 'USER');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 't-s3-helper@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 't-s3-user@example.test', 'authenticated', 'authenticated');

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

-- 1. Table version_groups exists and RLS is enabled
select has_table('public', 'version_groups', 'version_groups table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.version_groups'::regclass), 'RLS active on version_groups');

-- 2. service_role cannot write to hospitals or version_groups
select ok(not has_table_privilege('service_role', 'public.hospitals', 'INSERT')
          and not has_table_privilege('service_role', 'public.hospitals', 'UPDATE'), 'service_role cannot write to hospitals');
select ok(not has_table_privilege('service_role', 'public.version_groups', 'INSERT')
          and not has_table_privilege('service_role', 'public.version_groups', 'UPDATE'), 'service_role cannot write to version_groups');

-- 3. Set up test hospital and column mapping
insert into public.hospitals (hospital_code, hospital_name, district, status)
values ('HOSP32P999991', 'Test Hospital Mappings', 'ERNAKULAM', 'ACTIVE');

insert into public.hospital_sheets (sheet_key, hospital_code, scheme, reg_no, sheet_status, spreadsheet_id, sync)
values ('HOSP32P999991|PRIVATE', 'HOSP32P999991', 'PRIVATE', 1, 'LINKED', 'FAKEsheetMAPPINGS00000000000001', 'YES');

insert into public.column_mappings (id, hospital_code, spreadsheet_id, tab_name, version_group, header_fp, source_header, source_column, canonical_field, confidence, method, status)
values ('00000000-0000-0000-0000-0000000000d1', 'HOSP32P999991', 'FAKEsheetMAPPINGS00000000000001', 'SHEET1', 'VG-1', 'sl_no|pt_name', 'Patient Name', 1, 'patient_name', 0.95, 'ALIAS', 'PROPOSED');

-- 4. USER cannot approve column mapping (G1 guard)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
set local role authenticated;
select throws_ok(
  $$select public.approve_column_mapping('00000000-0000-0000-0000-0000000000d1'::uuid, 'patient_name')$$,
  '42501',
  null,
  'USER without the Hospitals edit tick cannot approve a column mapping'
);
reset role;

-- 5. The Hospitals edit tick approves column mappings (decision section 5, 27-Oct night)
insert into public.user_access_ticks (email, hospitals_add_edit) values ('t-s3-helper@example.test', true);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select lives_ok(
  $$select public.approve_column_mapping('00000000-0000-0000-0000-0000000000d1'::uuid, 'patient_name')$$,
  'a user with the Hospitals edit tick approves a column mapping'
);
reset role;

-- Verify mapping status is APPROVED
select is(
  (select status from public.column_mappings where id = '00000000-0000-0000-0000-0000000000d1'),
  'APPROVED',
  'column mapping status updated to APPROVED'
);

-- 6. Bulk approve version group mappings
insert into public.column_mappings (id, hospital_code, spreadsheet_id, tab_name, version_group, header_fp, source_header, source_column, canonical_field, confidence, method, status)
values ('00000000-0000-0000-0000-0000000000d2', 'HOSP32P999991', 'FAKEsheetMAPPINGS00000000000001', 'SHEET1', 'VG-1', 'sl_no|pt_name', 'Sl No', 0, 'serial_no', 0.95, 'ALIAS', 'PROPOSED');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is(
  (select public.approve_version_group_mappings('FAKEsheetMAPPINGS00000000000001', 'sl_no|pt_name')),
  1,
  'Bulk approval approves 1 pending PROPOSED mapping'
);
reset role;

select is(
  (select status from public.column_mappings where id = '00000000-0000-0000-0000-0000000000d2'),
  'APPROVED',
  'Bulk approved mapping is now APPROVED'
);

select * from finish();
rollback;
