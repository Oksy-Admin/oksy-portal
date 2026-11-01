-- Stage 2b: dictionary_entries (status words, colours, insurer/TPA/department, doctor names).
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into public.users_roles (email, role) values
  ('t-2b-admin@example.test', 'ADMIN'),
  ('t-2b-user@example.test', 'USER');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000002b1', 't-2b-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000002b2', 't-2b-user@example.test', 'authenticated', 'authenticated');

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

insert into public.hospitals (hospital_code, hospital_name, district, status) values
  ('HOSP32P999971', 'Test Dictionary Hospital One', 'ERNAKULAM', 'ACTIVE'),
  ('HOSP32P999972', 'Test Dictionary Hospital Two', 'ERNAKULAM', 'ACTIVE');

select has_table('public', 'dictionary_entries', 'dictionary_entries table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.dictionary_entries'::regclass), 'RLS active on dictionary_entries');
select ok(not has_table_privilege('authenticated', 'public.dictionary_entries', 'INSERT')
          and not has_table_privilege('authenticated', 'public.dictionary_entries', 'UPDATE'), 'logged-in users change entries only through the functions');
select ok(has_table_privilege('service_role', 'public.dictionary_entries', 'SELECT')
          and has_table_privilege('service_role', 'public.dictionary_entries', 'INSERT')
          and not has_table_privilege('service_role', 'public.dictionary_entries', 'UPDATE'), 'the worker reads and suggests only, never decides');

-- A hospital-scoped kind needs a hospital; a scheme-wide kind must not have one.
select throws_ok($$insert into public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status)
  values ('STATUS_WORD', 'PRIVATE', null, 'paid', 'paid', 'SETTLED', 'SUGGESTED')$$, '23514', null, 'STATUS_WORD without a hospital is refused');
select throws_ok($$insert into public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status)
  values ('INSURER', 'PRIVATE', 'HOSP32P999971', 'star', 'Star', 'Star Health', 'SUGGESTED')$$, '23514', null, 'INSURER with a hospital is refused');
-- Only a CONFIRMED status word must already be a real Stage word; a guess may be anything.
select lives_ok($$insert into public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status)
  values ('STATUS_WORD', 'PRIVATE', 'HOSP32P999971', 'xyzzy', 'Xyzzy', 'Xyzzy', 'SUGGESTED')$$, 'a SUGGESTED row may hold any guess');
select throws_ok($$update public.dictionary_entries set status = 'CONFIRMED' where spelling_key = 'xyzzy'$$, '23514', null, 'a CONFIRMED status word must be a real Stage word');

-- A User without the Hospitals edit tick cannot decide.
select pg_temp.act_as('00000000-0000-0000-0000-0000000002b2');
set local role authenticated;
select throws_ok($$select public.decide_dictionary_entry('STATUS_WORD', 'PRIVATE', 'HOSP32P999971', 'paid', 'CONFIRMED', 'SETTLED')$$, '42501', null, 'USER cannot decide a dictionary entry');
reset role;

-- Admin confirms a brand new status word.
select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');
set local role authenticated;
create temp table t_id1 (id uuid);
insert into t_id1 select public.decide_dictionary_entry('STATUS_WORD', 'PRIVATE', 'HOSP32P999971', 'paid', 'CONFIRMED', 'SETTLED', 'HMS 25-Oct answers');
reset role;
select is((select standard_value from public.dictionary_entries where id = (select id from t_id1)), 'SETTLED', 'the entry is confirmed as decided');
select is((select count(*)::int from public.dictionary_entries where kind = 'STATUS_WORD' and hospital_code = 'HOSP32P999971' and spelling_key = 'paid' and status <> 'RETIRED'), 1, 'one current row per kind + scheme + hospital + spelling');

-- A confirmed entry is never overwritten: changing it retires the old row and adds a new one.
select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');
set local role authenticated;
create temp table t_id2 (id uuid);
insert into t_id2 select public.decide_dictionary_entry('STATUS_WORD', 'PRIVATE', 'HOSP32P999971', 'paid', 'CONFIRMED', 'APPROVED', 'correction');
reset role;
select isnt((select id from t_id1), (select id from t_id2), 'a changed confirmation is a new row, not the same one');
select is((select status from public.dictionary_entries where id = (select id from t_id1)), 'RETIRED', 'the old row is retired, never deleted');
select is((select superseded_by from public.dictionary_entries where id = (select id from t_id1)), (select id from t_id2), 'the old row points at the row that replaced it');
select is((select count(*)::int from public.dictionary_entries where kind = 'STATUS_WORD' and hospital_code = 'HOSP32P999971' and spelling_key = 'paid' and status <> 'RETIRED'), 1, 'still one current row after the change');

-- Rejecting a spelling still blocks it from being suggested again (never asked twice).
select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');
set local role authenticated;
select public.decide_dictionary_entry('DOCTOR', 'PRIVATE', 'HOSP32P999971', 'notadoctor', 'REJECTED', 'notadoctor', 'not a real name');
reset role;
select is((select status from public.dictionary_entries where kind = 'DOCTOR' and hospital_code = 'HOSP32P999971' and spelling_key = 'notadoctor'), 'REJECTED', 'a rejected spelling is kept, not deleted');

-- Bulk confirm (Policy B + D pre-fill): Hospital Two gets the same word as Suggested.
insert into public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status, evidence)
values ('STATUS_WORD', 'PRIVATE', 'HOSP32P999972', 'paid', 'paid', 'SETTLED', 'SUGGESTED', '{"source":"pre-filled"}');

select pg_temp.act_as('00000000-0000-0000-0000-0000000002b2');
set local role authenticated;
select throws_ok($$select public.bulk_confirm_dictionary('STATUS_WORD', 'PRIVATE', 'HOSP32P999972', '[{"spelling_key":"paid","standard_value":"APPROVED"}]')$$, '42501', null, 'USER cannot bulk confirm');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');
set local role authenticated;
select throws_ok($$select public.bulk_confirm_dictionary('STATUS_WORD', 'PRIVATE', 'HOSP32P999972', '[{"spelling_key":"paid","standard_value":"SETTLED"},{"spelling_key":"paid","standard_value":"SETTLED"}]')$$, '22023', null, 'a spelling twice: refused');
select throws_ok($$select public.bulk_confirm_dictionary('INSURER', 'PRIVATE', 'HOSP32P999972', '[{"spelling_key":"star","standard_value":"Star Health"}]')$$, '22023', null, 'bulk confirm is only for status words and doctor names');
create temp table t_batch (id uuid);
insert into t_batch select public.bulk_confirm_dictionary('STATUS_WORD', 'PRIVATE', 'HOSP32P999972', '[{"spelling_key":"paid","standard_value":"APPROVED"}]');
reset role;
select is((select count(*)::int from public.dictionary_entries where kind = 'STATUS_WORD' and hospital_code = 'HOSP32P999972' and spelling_key = 'paid' and status = 'CONFIRMED'), 1, 'bulk confirm matched by exact standard value, even though Hospital One later changed its own to APPROVED');
select is((select count(*)::int from public.audit_log where table_name = 'dictionary_entry_batches' and record_id = (select id::text from t_batch)), 1, 'one audit entry for the bulk action');

select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');
set local role authenticated;
select is((select public.undo_dictionary_batch((select id from t_batch))), 1, 'undo puts it back to Suggested');
reset role;
select is((select status from public.dictionary_entries where kind = 'STATUS_WORD' and hospital_code = 'HOSP32P999972' and spelling_key = 'paid'), 'SUGGESTED', 'undone: back on the decision list, not deleted');

select * from finish();
rollback;
