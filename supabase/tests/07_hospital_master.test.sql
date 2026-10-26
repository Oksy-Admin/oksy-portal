-- M4 tests: Hospital Master import (G11), counts check, shared sheets, access columns.
-- Fake data only (HOSP32P9xxxxx codes and FAKE sheet IDs are not real).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into public.users_roles (email, role) values
  ('t-helper@example.test', 'HELPER'),
  ('t-user@example.test', 'USER');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000b3', 't-helper@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b4', 't-user@example.test', 'authenticated', 'authenticated');

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

-- A small register: 3 hospitals (2 ACTIVE, 1 STOPPED), 1 retired ID, 5 sheet rows
-- (4 LINKED, 1 coded), SYNC 3 YES / 1 HOLD / 1 NA, 1 staff row. Hospitals 900001 and
-- 900003 share one sheet: read under 900001 only (like Hearts Malabar, D-046).
create temp table t_payload (p jsonb);
grant select on t_payload to authenticated;
insert into t_payload values ($${
  "file_name": "test_register.xlsx",
  "file_sha256": "0000000000000000000000000000000000000000000000000000000000000001",
  "register_version": "test",
  "expected": {"hospitals": 3, "active": 2, "stopped": 1, "retired_ids": 1, "linked": 4, "coded_no_url": 1,
               "sync_yes": 3, "sync_hold": 1, "staff": 1},
  "district_heads": [{"district": "TESTDISTRICT", "dbdo": "Test Head", "rbdo": "Test Region", "note": null}],
  "hospitals": [
    {"hospital_code": "HOSP32P900001", "hospital_name": "Test Hospital One", "district": "TESTDISTRICT", "status": "ACTIVE"},
    {"hospital_code": "HOSP32P900002", "hospital_name": "Test Hospital Two", "district": "TESTDISTRICT", "status": "ACTIVE"},
    {"hospital_code": "HOSP32P900003", "hospital_name": "Test Hospital Three", "district": "TESTDISTRICT", "status": "STOPPED"}],
  "retired_ids": [{"retired_id": "HOSP32P900009", "kept_id": "HOSP32P900002", "retired_on": "2026-10-23", "reason": "test merge"}],
  "aliases": [{"hospital_code": "HOSP32P900001", "alias": "TEST HOSP ONE", "source": "test"}],
  "sheets": [
    {"hospital_code": "HOSP32P900001", "scheme": "PRIVATE", "reg_no": 1, "sheet_status": "LINKED",
     "spreadsheet_id": "FAKEsheetSHARED00000000000000001", "sheet_url": "https://docs.google.com/spreadsheets/d/FAKEsheetSHARED00000000000000001/edit", "sync": "YES"},
    {"hospital_code": "HOSP32P900003", "scheme": "PRIVATE", "reg_no": 2, "sheet_status": "LINKED",
     "spreadsheet_id": "FAKEsheetSHARED00000000000000001", "sheet_url": "https://docs.google.com/spreadsheets/d/FAKEsheetSHARED00000000000000001/edit", "sync": "YES",
     "read_skip_reason": "D-046: shared sheet, read under HOSP32P900001 only"},
    {"hospital_code": "HOSP32P900002", "scheme": "PRIVATE", "reg_no": 3, "sheet_status": "LINKED",
     "spreadsheet_id": "FAKEsheetTWO00000000000000000002", "sheet_url": "https://docs.google.com/spreadsheets/d/FAKEsheetTWO00000000000000000002/edit", "sync": "YES"},
    {"hospital_code": "HOSP32P900002", "scheme": "KASP", "reg_no": 4, "sheet_status": "LINKED",
     "spreadsheet_id": "FAKEsheetHOLD0000000000000000003", "sheet_url": "https://docs.google.com/spreadsheets/d/FAKEsheetHOLD0000000000000000003/edit", "sync": "HOLD"},
    {"hospital_code": "HOSP32P900001", "scheme": "MEDISEP", "reg_no": 5, "sheet_status": "UNDERPROCESS", "sync": "NA"}],
  "staff": [{"hospital_code": "HOSP32P900001", "staff_name": "Test Desk", "designation": "Desk", "phone": "0000000000"}],
  "open_checks": [{"check_no": 1, "status": "OPEN", "hospital_code": "HOSP32P900001", "what_to_decide": "test"}]
}$$);

-------------------------------------------------------------------------------
-- USER cannot save; HELPER can (G11)
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b4');
set local role authenticated;
select throws_ok($$select public.import_register((select p from t_payload))$$,
  '42501', 'Only HELPER, APPROVER or ADMIN can save the register (G11)', 'USER cannot save the register');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3');
set local role authenticated;
select throws_ok($$select public.import_register(jsonb_set((select p from t_payload), '{expected,linked}', '5'))$$,
  '23514', null, 'a count that differs from RECONCILIATION stops the import');
select is((select count(*)::int from public.hospital_sheets where hospital_code like 'HOSP32P9%'), 0, 'nothing was saved by the refused import');
select lives_ok($$select public.import_register((select p from t_payload))$$, 'HELPER saves a register whose counts match');
select is((select count(*)::int from public.hospital_sheets where hospital_code like 'HOSP32P9%'), 5, 'all 5 sheet rows saved');
select is((select count(*)::int from public.hospitals where hospital_code like 'HOSP32P9%'), 3, '3 hospitals saved');
select is((select access_status from public.hospital_sheets where sheet_key = 'HOSP32P900002|PRIVATE'), 'NOT_CHECKED',
  'a new sheet starts NOT_CHECKED');
select isnt((select missing_from_register_since from public.hospitals where hospital_code = 'HOSP32P000107'), null,
  'a hospital not in the new register is marked missing, not deleted');

-- Re-running creates no duplicates and changes nothing. Both runs share one transaction
-- time, so the second run is found as the run that did not exist before it.
create temp table t_runs_before as select id from public.import_runs;
select lives_ok($$select public.import_register((select p from t_payload))$$, 'the same register can be saved again');
select is((select (affected ->> 'hospital_sheets')::int + (affected ->> 'hospitals')::int + (affected ->> 'staff_contacts')::int
             from public.import_runs where id not in (select id from t_runs_before))
          - 0, 0, 'the second import changed no row');
select is((select count(*)::int from public.hospital_sheets where hospital_code like 'HOSP32P9%'), 5, 'still 5 sheet rows (no duplicates)');
select is((select count(*)::int from public.import_runs), 2, 'both imports are recorded');

-- Shared sheet without a decision: refused, never read twice.
select throws_ok($$select public.import_register(
    jsonb_set((select p from t_payload), '{sheets,1,read_skip_reason}', 'null'))$$,
  '23514', null, 'a sheet readable under two hospitals is refused (ID_COLLISION)');

-- A retired ID cannot come back as a hospital.
select throws_ok($$select public.import_register(jsonb_set((select p from t_payload), '{hospitals,0,hospital_code}', '"HOSP32P900009"'))$$,
  '23514', null, 'a retired ID cannot be a hospital again');

-- Direct writes are not allowed; only the import function writes.
select throws_ok($$update public.hospital_sheets set sync = 'YES' where sheet_key = 'HOSP32P900002|KASP'$$,
  '42501', null, 'HELPER cannot change SYNC directly');
reset role;

-------------------------------------------------------------------------------
-- USER sees names but not sheet links, staff or open checks
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b4');
set local role authenticated;
select is((select count(*)::int from public.hospital_sheets), 0, 'USER cannot see sheet links');
select is((select count(*)::int from public.staff_contacts), 0, 'USER cannot see staff phones');
select is((select count(*)::int from public.hospital_aliases), 1, 'USER can see hospital aliases');
reset role;

-------------------------------------------------------------------------------
-- Worker: writes the access result columns only
-------------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('request.jwt.claim.sub', '', true);
select lives_ok($$update public.hospital_sheets set access_status = 'OK', last_checked_at = now(), last_ok_at = now()
                   where sheet_key = 'HOSP32P900002|PRIVATE'$$, 'the worker records an access result');
select throws_ok($$update public.hospital_sheets set sync = 'YES' where sheet_key = 'HOSP32P900002|KASP'$$,
  '42501', null, 'the worker cannot change SYNC');
select throws_ok($$delete from public.hospital_sheets where sheet_key = 'HOSP32P900002|KASP'$$,
  '42501', null, 'the worker cannot delete a sheet row');
select lives_ok($$insert into public.google_events (kind, file_id) values ('CHECK_ACCESS', 'FAKEsheetTWO00000000000000000002')$$,
  'the worker logs an access check');
select is((select path from public.google_events where kind = 'CHECK_ACCESS'), 'READ', 'an access check is a read-path event');
reset role;

-------------------------------------------------------------------------------
-- Never delete, append-only run log, audit
-------------------------------------------------------------------------------
select throws_ok($$delete from public.hospital_sheets where sheet_key = 'HOSP32P900002|KASP'$$,
  'P0001', null, 'nobody can delete a sheet row (hard rule 5)');
select throws_ok($$update public.import_runs set file_name = 'x'$$, 'P0001', null, 'import runs are append-only');
select ok((select count(*) from public.audit_log where table_name = 'hospital_sheets') >= 5,
  'sheet rows are in the audit log');

select * from finish();
rollback;
