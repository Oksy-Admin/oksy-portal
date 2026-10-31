-- Hospital master (rewritten in Stage 1c: the register import and hospital_aliases are
-- retired, 31-Oct): shared sheets, retired IDs, tick-based reading, staff phones, the worker's
-- access columns, never delete. Fake data only (HOSP32P9xxxxx codes and FAKE sheet IDs).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.users_roles (email, role, active) values
  ('t-viewer@example.test', 'USER', true),
  ('t-editor@example.test', 'USER', true),
  ('t-user@example.test', 'USER', true);
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000007b1', 't-viewer@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000007b2', 't-editor@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000007b3', 't-user@example.test', 'authenticated', 'authenticated');
insert into public.user_access_ticks (email, hospitals_view) values ('t-viewer@example.test', true);
insert into public.user_access_ticks (email, hospitals_view, hospitals_add_edit) values ('t-editor@example.test', true, true);

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

-- Two hospitals share one sheet: it is read under the first one only (D-046).
insert into public.hospitals (hospital_code, hospital_name, district, status) values
  ('HOSP32P900001', 'Test Hospital One', 'TESTDISTRICT', 'ACTIVE'),
  ('HOSP32P900002', 'Test Hospital Two', 'TESTDISTRICT', 'ACTIVE');
insert into public.hospital_sheets (sheet_key, hospital_code, scheme, sheet_status, spreadsheet_id, sync) values
  ('HOSP32P900001|PRIVATE', 'HOSP32P900001', 'PRIVATE', 'LINKED', 'FAKEsheetSHARED00000000000000001', 'YES'),
  ('HOSP32P900002|KASP', 'HOSP32P900002', 'KASP', 'LINKED', 'FAKEsheetHOLD0000000000000000003', 'HOLD');
insert into public.staff_contacts (hospital_code, staff_name, phone) values ('HOSP32P900001', 'Test Desk', '0000000000');
insert into public.district_heads (district, dbdo) values ('TESTDISTRICT', 'Test Head');

select throws_ok($$insert into public.hospital_sheets (sheet_key, hospital_code, scheme, sheet_status, spreadsheet_id, sync)
                   values ('HOSP32P900002|PRIVATE', 'HOSP32P900002', 'PRIVATE', 'LINKED', 'FAKEsheetSHARED00000000000000001', 'YES')$$,
  '23514', null, 'a sheet readable under two hospitals is refused (ID_COLLISION)');
select lives_ok($$insert into public.hospital_sheets (sheet_key, hospital_code, scheme, sheet_status, spreadsheet_id, sync, read_skip_reason)
                  values ('HOSP32P900002|PRIVATE', 'HOSP32P900002', 'PRIVATE', 'LINKED', 'FAKEsheetSHARED00000000000000001', 'YES', 'D-046: read under HOSP32P900001')$$,
  'the shared sheet is kept under the second hospital with a skip reason');

-- A retired ID never comes back as a hospital.
insert into public.retired_ids (retired_id, kept_id, reason) values ('HOSP32P900009', 'HOSP32P900002', 'test merge');
select throws_ok($$insert into public.hospitals (hospital_code, hospital_name) values ('HOSP32P900009', 'Back again')$$,
  '23514', null, 'a retired ID cannot be a hospital again');

-------------------------------------------------------------------------------
-- Reading follows the ticks (decisions section 3)
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000007b3');
set local role authenticated;
select is((select count(*)::int from public.hospitals) + (select count(*)::int from public.hospital_sheets)
          + (select count(*)::int from public.district_heads) + (select count(*)::int from public.retired_ids), 0,
  'a USER without ticks sees no hospital, sheet, district head or retired ID');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000007b1');
set local role authenticated;
select is((select count(*)::int from public.hospitals where hospital_code like 'HOSP32P9%'), 2, 'the Hospitals view tick shows the hospitals');
select is((select count(*)::int from public.hospital_sheets where hospital_code like 'HOSP32P9%'), 3, 'and their sheets');
select is((select count(*)::int from public.district_heads where district = 'TESTDISTRICT'), 1, 'and the district heads');
select is((select count(*)::int from public.staff_contacts), 0, 'the view tick alone shows no staff phone (personal data)');
select throws_ok($$insert into public.staff_contacts (hospital_code, staff_name) values ('HOSP32P900001', 'Not allowed')$$,
  '42501', null, 'the view tick alone cannot add a staff contact');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000007b2');
set local role authenticated;
select is((select count(*)::int from public.staff_contacts where hospital_code = 'HOSP32P900001'), 1, 'the Hospitals edit tick shows staff phones');
select throws_ok($$update public.hospital_sheets set sync = 'YES' where sheet_key = 'HOSP32P900002|KASP'$$,
  '42501', null, 'nobody changes SYNC by writing the table directly');
reset role;

-------------------------------------------------------------------------------
-- Worker: writes the access result columns only
-------------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('request.jwt.claim.sub', '', true);
select lives_ok($$update public.hospital_sheets set access_status = 'OK', last_checked_at = now(), last_ok_at = now()
                   where sheet_key = 'HOSP32P900001|PRIVATE'$$, 'the worker records an access result');
select throws_ok($$update public.hospital_sheets set sync = 'YES' where sheet_key = 'HOSP32P900002|KASP'$$,
  '42501', null, 'the worker cannot change SYNC');
select throws_ok($$delete from public.hospital_sheets where sheet_key = 'HOSP32P900002|KASP'$$,
  '42501', null, 'the worker cannot delete a sheet row');
reset role;

-------------------------------------------------------------------------------
-- Never delete, audit
-------------------------------------------------------------------------------
select throws_ok($$delete from public.hospital_sheets where sheet_key = 'HOSP32P900002|KASP'$$,
  'P0001', null, 'nobody can delete a sheet row (hard rule 5)');
select throws_ok($$delete from public.staff_contacts$$, 'P0001', null, 'staff contacts are retired, never deleted');
select ok((select count(*) from public.audit_log where table_name = 'hospital_sheets') >= 3,
  'sheet rows are in the audit log');

select * from finish();
rollback;
