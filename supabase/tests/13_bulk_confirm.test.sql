-- Stage 1b-ii: bulk confirm of header decisions (exact matches, max 50, one audit entry, undo as a group).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.users_roles (email, role) values
  ('t-1bii-admin@example.test', 'ADMIN'),
  ('t-1bii-user@example.test', 'USER');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000002b1', 't-1bii-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000002b2', 't-1bii-user@example.test', 'authenticated', 'authenticated');

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

-- An older hospital with decisions, and a new one with the same headers (fake data only).
insert into public.hospitals (hospital_code, hospital_name, district, status) values
  ('HOSP32P999981', 'Test Old Hospital', 'ERNAKULAM', 'ACTIVE'),
  ('HOSP32P999982', 'Test New Hospital', 'ERNAKULAM', 'ACTIVE');
insert into public.column_mappings (hospital_code, spreadsheet_id, tab_name, header_fp, source_header, source_column, canonical_field, confidence, method, status, scheme, header_key)
values
  ('HOSP32P999981', 'FAKEsheetBULK0000000000000001', 'OCT 2026', 'a', 'BILL AMOUNT', 1, 'bill_amount', 1, 'MANUAL', 'APPROVED', 'PRIVATE', 'billamount'),
  ('HOSP32P999981', 'FAKEsheetBULK0000000000000001', 'OCT 2026', 'a', 'REMARKS', 2, 'remarks', 1, 'MANUAL', 'APPROVED', 'PRIVATE', 'remarks'),
  ('HOSP32P999981', 'FAKEsheetBULK0000000000000001', 'OCT 2026', 'a', 'WARD', 3, 'IGNORE', 1, 'MANUAL', 'APPROVED', 'PRIVATE', 'ward'),
  ('HOSP32P999982', 'FAKEsheetBULK0000000000000002', 'OCT 2026', 'b', 'Bill Amount', 1, 'bill_amount', 0.95, 'ALIAS', 'PROPOSED', 'PRIVATE', 'billamount'),
  ('HOSP32P999982', 'FAKEsheetBULK0000000000000002', 'OCT 2026', 'b', 'Remarks', 2, 'remarks', 0.95, 'ALIAS', 'PROPOSED', 'PRIVATE', 'remarks'),
  ('HOSP32P999982', 'FAKEsheetBULK0000000000000002', 'OCT 2026', 'b', 'Ward', 3, null, 0, 'UNMATCHED', 'PROPOSED', 'PRIVATE', 'ward');

select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');
set local role authenticated;
select public.decide_header('HOSP32P999981', 'PRIVATE', 'billamount', 'bill_amount');
select public.decide_header('HOSP32P999981', 'PRIVATE', 'remarks', 'remarks');
select public.decide_header('HOSP32P999981', 'PRIVATE', 'ward', 'IGNORE');
reset role;

select ok(not has_table_privilege('authenticated', 'public.header_decision_batches', 'INSERT')
          and not has_table_privilege('authenticated', 'public.header_decision_batches', 'UPDATE'), 'batches change only through the functions');

-- A User cannot bulk confirm (Owner and Admin only).
select pg_temp.act_as('00000000-0000-0000-0000-0000000002b2');
set local role authenticated;
select throws_ok($$select public.bulk_confirm_headers('HOSP32P999982', 'PRIVATE', '[{"header_key":"billamount","canonical_field":"bill_amount"}]')$$, '42501', null, 'USER cannot bulk confirm');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');
set local role authenticated;
select throws_ok($$select public.bulk_confirm_headers('HOSP32P999982', 'PRIVATE', '[{"header_key":"billamount","canonical_field":"approved_amount"}]')$$, '22023', null, 'not an exact match: refused');
select throws_ok($$select public.bulk_confirm_headers('HOSP32P999982', 'PRIVATE', (select jsonb_agg(jsonb_build_object('header_key', 'h' || g, 'canonical_field', null)) from generate_series(1, 51) g))$$, '22023', null, 'more than 50: refused');
select throws_ok($$select public.bulk_confirm_headers('HOSP32P999982', 'PRIVATE', '[{"header_key":"ward","canonical_field":"IGNORE"},{"header_key":"ward","canonical_field":"IGNORE"}]')$$, '22023', null, 'a header twice: refused');
select throws_ok($$select public.bulk_confirm_headers('HOSP32P999982', 'PRIVATE', '[{"header_key":"notseen","canonical_field":"IGNORE"}]')$$, 'P0002', null, 'a header not in this hospital: refused');

create temp table t_batch (id uuid);
grant all on t_batch to authenticated;
insert into t_batch select public.bulk_confirm_headers('HOSP32P999982', 'PRIVATE',
  '[{"header_key":"billamount","canonical_field":"bill_amount"},{"header_key":"remarks","canonical_field":"remarks"},{"header_key":"ward","canonical_field":"IGNORE"}]');
reset role;

select is((select count(*)::int from public.header_decisions where hospital_code = 'HOSP32P999982' and withdrawn_at is null and method = 'BULK'), 3, 'three headers confirmed in one action');
select is((select string_agg(f, ',') from public.header_decision_batches b, jsonb_array_elements(b.items) x, jsonb_array_elements_text(x->'from') f where b.id = (select id from t_batch) and x->>'header_key' = 'ward'), 'HOSP32P999981', 'the batch lists where each decision came from');
select is((select count(*)::int from public.audit_log where table_name = 'header_decision_batches' and record_id = (select id::text from t_batch)), 1, 'one audit entry for the action');
select is((select count(*)::int from public.audit_log a where a.table_name = 'header_decisions' and a.after->>'hospital_code' = 'HOSP32P999982'), 0, 'no audit entry per header');

select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');
set local role authenticated;
select throws_ok($$select public.bulk_confirm_headers('HOSP32P999982', 'PRIVATE', '[{"header_key":"ward","canonical_field":"IGNORE"}]')$$, '23505', null, 'an already decided header: refused');
-- Someone changes one header on its own row: the undo leaves it alone.
select public.decide_header('HOSP32P999982', 'PRIVATE', 'remarks', null);
select is((select public.undo_header_batch((select id from t_batch))), 2, 'undo withdraws the two untouched headers');
select throws_ok($$select public.undo_header_batch((select id from t_batch))$$, '22023', null, 'a second undo is refused');
reset role;

select is((select count(*)::int from public.header_decisions where hospital_code = 'HOSP32P999982' and withdrawn_at is null), 1, 'only the hand-decided header stays decided');
select is((select count(*)::int from public.audit_log where table_name = 'header_decision_batches' and record_id = (select id::text from t_batch)), 2, 'the undo is one more audit entry');

-- After an undo the header can be decided again (bulk or by hand); the row is reused, never deleted.
select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');
set local role authenticated;
select lives_ok($$select public.bulk_confirm_headers('HOSP32P999982', 'PRIVATE', '[{"header_key":"ward","canonical_field":"IGNORE"}]')$$, 'a withdrawn header can be confirmed again');
reset role;
select is((select count(*)::int from public.header_decisions where hospital_code = 'HOSP32P999982' and header_key = 'ward'), 1, 'still one row per hospital + scheme + header');

select * from finish();
rollback;
