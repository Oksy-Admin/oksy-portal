-- Stage 1d: claim history lanes (decision section 9), record source, Scheme -> Insurer -> TPA.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into public.users_roles (email, role, active) values
  ('t-15-admin@example.test', 'ADMIN', true),
  ('t-15-user@example.test', 'USER', true);
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-000000001501', 't-15-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000001502', 't-15-user@example.test', 'authenticated', 'authenticated');

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

insert into public.hospitals (hospital_code, hospital_name, district, status) values ('HOSP32P915001', 'Test Hospital 15', 'TESTDISTRICT', 'ACTIVE');
insert into public.claims_staging (record_uid, record_key, hospital_code, scheme, source_file, source_tab, source_row, row_class, content_hash)
  values ('00000000-0000-0000-0000-000000001510', 'HOSP32P915001|PRIVATE|C:FAKE15|2026-10-01|-', 'HOSP32P915001', 'PRIVATE',
          'FAKEsheet15000000000000000000001', 'OCT 2026', 2, 'CLEAN', repeat('c', 64));

-- 1. Record source
select is((select record_source from public.claims_staging where record_uid = '00000000-0000-0000-0000-000000001510'), 'GOOGLE_SHEET',
  'a claim from a Google Sheet says so');
select throws_ok($$update public.claims_staging set record_source = 'EMAIL' where record_uid = '00000000-0000-0000-0000-000000001510'$$,
  '23514', null, 'record source is Google Sheet or TMS import only');

-- 2. Claim history lanes
select lives_ok($$insert into public.change_log (record_uid, field, old_value, new_value)
                  values ('00000000-0000-0000-0000-000000001510', 'bill_amount', '1000', '1000.00')$$,
  'a cleaning change is tagged AUTO by default');
select is((select actor from public.change_log where record_uid = '00000000-0000-0000-0000-000000001510' and field = 'bill_amount'), 'AUTO', 'default lane AUTO');
select throws_ok($$insert into public.change_log (record_uid, field, actor) values ('00000000-0000-0000-0000-000000001510', 'x', 'ENGINE')$$,
  '23514', null, 'the old ENGINE tag is no longer accepted');
select throws_ok($$insert into public.change_log (record_uid, field, actor, decided_by)
                   values ('00000000-0000-0000-0000-000000001510', 'utr_no', 'HUMAN', '00000000-0000-0000-0000-000000001501')$$,
  '23514', null, 'a human change without a reason is refused');
select throws_ok($$insert into public.change_log (record_uid, field, actor, reason)
                   values ('00000000-0000-0000-0000-000000001510', 'utr_no', 'AI_ACCEPTED', 'staff confirmed')$$,
  '23514', null, 'an accepted AI suggestion without who accepted it is refused');
select lives_ok($$insert into public.change_log (record_uid, field, actor, reason, decided_by)
                  values ('00000000-0000-0000-0000-000000001510', 'utr_no', 'HUMAN', 'staff confirmed in the Question Sheet', '00000000-0000-0000-0000-000000001501')$$,
  'a human change with reason and who is kept');
select throws_ok($$update public.change_log set reason = 'changed'$$, 'P0001', null, 'history is never changed');

-- 3. Scheme -> Insurer -> TPA
select is((select string_agg(tpa, ',' order by tpa) from public.scheme_insurers where scheme = 'MEDISEP' and insurer = 'Oriental Insurance'),
  'FHPL,Vidal', 'MEDISEP: Oriental Insurance with Vidal and FHPL at the same time');

select pg_temp.act_as('00000000-0000-0000-0000-000000001502');
set local role authenticated;
select ok((select count(*) from public.scheme_insurers) >= 2, 'every approved user can read the list');
select throws_ok($$insert into public.scheme_insurers (scheme, insurer) values ('KASP', 'Fake Insurer')$$,
  '42501', null, 'a User cannot change the list');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000001501');
set local role authenticated;
select lives_ok($$insert into public.scheme_insurers (scheme, insurer, tpa, valid_from) values ('KASP', 'Fake Insurer', null, '2026-04-01')$$,
  'Admin adds a scheme insurer with a valid-from date');
reset role;

select * from finish();
rollback;
