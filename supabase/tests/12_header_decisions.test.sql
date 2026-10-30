-- Stage 1b-i: one mapping decision per hospital + scheme + header (decide_header).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.users_roles (email, role) values
  ('t-1b-admin@example.test', 'ADMIN'),
  ('t-1b-user@example.test', 'USER');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000001b1', 't-1b-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000001b2', 't-1b-user@example.test', 'authenticated', 'authenticated');

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

insert into public.hospitals (hospital_code, hospital_name, district, status)
values ('HOSP32P999992', 'Test Hospital Decisions', 'ERNAKULAM', 'ACTIVE');
insert into public.column_mappings (hospital_code, spreadsheet_id, tab_name, header_fp, source_header, source_column, canonical_field, confidence, method, status, scheme, header_key, review_reason)
values
  ('HOSP32P999992', 'FAKEsheetDECISIONS000000000001', 'OCT 2026', 'slno|billamount', 'BILL AMOUNT', 1, 'bill_amount', 0.95, 'ALIAS', 'PROPOSED', 'PRIVATE', 'billamount', 'values do not look like amounts'),
  ('HOSP32P999992', 'FAKEsheetDECISIONS000000000001', 'SEP 2026', 'slno|billamount', 'BILL AMOUNT', 1, 'bill_amount', 0.95, 'ALIAS', 'PROPOSED', 'PRIVATE', 'billamount', null);

select has_table('public', 'header_decisions', 'header_decisions table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.header_decisions'::regclass), 'RLS active on header_decisions');
select ok(not has_table_privilege('authenticated', 'public.header_decisions', 'INSERT')
          and not has_table_privilege('authenticated', 'public.header_decisions', 'UPDATE'), 'logged-in users change decisions only through decide_header');

-- A User without the Hospitals edit tick cannot decide.
select pg_temp.act_as('00000000-0000-0000-0000-0000000001b2');
set local role authenticated;
select throws_ok($$select public.decide_header('HOSP32P999992', 'PRIVATE', 'billamount', 'bill_amount')$$, '42501', null, 'USER cannot decide a header');
reset role;

-- Admin decides once: both tabs with the header are covered, the review reason is cleared.
select pg_temp.act_as('00000000-0000-0000-0000-0000000001b1');
set local role authenticated;
select is((select public.decide_header('HOSP32P999992', 'PRIVATE', 'billamount', 'bill_amount', true)), 2, 'one decision covers both tabs');
select throws_ok($$select public.decide_header('HOSP32P999992', 'PRIVATE', 'billamount', 'no_such_field')$$, '22023', null, 'unknown field refused');
select throws_ok($$select public.decide_header('HOSP32P999992', 'PRIVATE', 'notseen', 'IGNORE')$$, 'P0002', null, 'a header never seen in this hospital + scheme is refused');
-- Ignore is a decision, saved as one (the same row, changed).
select lives_ok($$select public.decide_header('HOSP32P999992', 'PRIVATE', 'billamount', 'IGNORE')$$, 'Ignore is saved');
reset role;

select is((select canonical_field || '|' || method || '|' || decided_by::text from public.header_decisions where hospital_code = 'HOSP32P999992'),
          'IGNORE|MANUAL|00000000-0000-0000-0000-0000000001b1', 'one row per hospital + scheme + header, with who decided');
select is((select count(*)::int from public.column_mappings where hospital_code = 'HOSP32P999992' and review_reason is not null), 0, 'review reason cleared');

-- Moving the per-tab approvals: a plain "TDS" beside "TDS AMOUNT" (old approvals disagree,
-- as on live HOSPPVTP0001/0002) gets no decision; a "TDS" alone still takes tds_amount_stated.
insert into public.hospitals (hospital_code, hospital_name, district, status)
values ('HOSP32P999993', 'Test Hospital TDS Only', 'ERNAKULAM', 'ACTIVE');
insert into public.column_mappings (hospital_code, spreadsheet_id, tab_name, header_fp, source_header, source_column, canonical_field, confidence, method, status, scheme, header_key)
values
  ('HOSP32P999992', 'FAKEsheetDECISIONS000000000001', 'OCT 2026', 'tds|tdsamount', 'TDS', 2, 'tds_amount_stated', 1, 'MANUAL', 'APPROVED', 'PRIVATE', 'tds'),
  ('HOSP32P999992', 'FAKEsheetDECISIONS000000000001', 'SEP 2026', 'tds|tdsamount', 'TDS', 2, 'IGNORE', 1, 'MANUAL', 'APPROVED', 'PRIVATE', 'tds'),
  ('HOSP32P999992', 'FAKEsheetDECISIONS000000000001', 'OCT 2026', 'tds|tdsamount', 'TDS AMOUNT', 3, 'tds_amount_stated', 1, 'MANUAL', 'APPROVED', 'PRIVATE', 'tdsamount'),
  ('HOSP32P999993', 'FAKEsheetDECISIONS000000000002', 'OCT 2026', 'tds', 'TDS', 2, 'tds_amount_stated', 1, 'MANUAL', 'APPROVED', 'PRIVATE', 'tds');
select is((select private.migrate_header_decisions()), 2, 'move stores TDS AMOUNT and the lone TDS only');
select is((select count(*)::int from public.header_decisions where hospital_code = 'HOSP32P999992' and header_key = 'tds'), 0,
          'TDS beside TDS AMOUNT: no decision stored');
select is((select canonical_field from public.header_decisions where hospital_code = 'HOSP32P999992' and header_key = 'tdsamount'), 'tds_amount_stated',
          'TDS AMOUNT goes to tds_amount_stated');
select is((select canonical_field from public.header_decisions where hospital_code = 'HOSP32P999993' and header_key = 'tds'), 'tds_amount_stated',
          'TDS alone still goes to tds_amount_stated');

select * from finish();
rollback;
