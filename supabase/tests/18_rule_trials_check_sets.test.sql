-- Stage 2e: rule trial (rule_trials, approve_rule_trial) and check sets (check_set_claims,
-- pick_check_set_claim, accept_check_set_claim). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.users_roles (email, role) values
  ('t-tr-admin@example.test', 'ADMIN'),
  ('t-tr-editor@example.test', 'USER'),
  ('t-tr-viewer@example.test', 'USER');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 't-tr-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 't-tr-editor@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f3', 't-tr-viewer@example.test', 'authenticated', 'authenticated');
insert into public.user_access_ticks (email, rule_library_view, rule_library_add_edit) values
  ('t-tr-editor@example.test', true, true),
  ('t-tr-viewer@example.test', true, false);

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

insert into public.hospitals (hospital_code, hospital_name, status) values
  ('HOSPPVTP0918', 'Test Hospital 2e', 'ACTIVE');
insert into public.claims_staging (record_uid, record_key, hospital_code, scheme, preauth_or_claim_no, claim_status,
                                   bill_amount, approved_amount, settled_amount, source_file, source_tab, source_row, row_class, content_hash) values
  ('00000000-0000-0000-0000-000000001801', 'HOSPPVTP0918|PRIVATE|C:T18A', 'HOSPPVTP0918', 'PRIVATE', 'T18A', 'SETTLED',
   100000, 90000, 85000, 'FAKEsheet18A00000000000000000001', 'OCT 2026', 2, 'CLEAN', 'h18a');

-------------------------------------------------------------------------------
-- 1. rule_trials: view tick reads; add/edit tick (and only the requester) inserts.
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
set local role authenticated;
insert into public.rule_trials (hospital_code) values ('HOSPPVTP0918');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f3');
set local role authenticated;
select ok((select count(*)::int from public.rule_trials) >= 1, 'a view-tick user can read a queued rule trial');
select throws_ok($$insert into public.rule_trials (hospital_code) values ('HOSPPVTP0918')$$, '42501', null,
  'a view-only user cannot queue a rule trial');
reset role;

-------------------------------------------------------------------------------
-- 2. approve_rule_trial: Owner/Admin only, and only once the trial has finished.
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
set local role authenticated;
select throws_ok(
  $$select public.approve_rule_trial((select id from public.rule_trials where hospital_code = 'HOSPPVTP0918' limit 1))$$,
  '42501', null, 'a USER with the add/edit tick cannot approve a trial, only Owner or Admin');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select throws_ok(
  $$select public.approve_rule_trial((select id from public.rule_trials where hospital_code = 'HOSPPVTP0918' limit 1))$$,
  '22023', null, 'a QUEUED trial cannot be approved yet (it has not finished)');
reset role;

update public.rule_trials set status = 'SUCCEEDED', finished_at = now(), summary = '{"totalClaims":1,"cleanClaims":1,"byRule":{}}'::jsonb
  where hospital_code = 'HOSPPVTP0918';

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select lives_ok(
  $$select public.approve_rule_trial((select id from public.rule_trials where hospital_code = 'HOSPPVTP0918' limit 1), 'looks right')$$,
  'Admin approves a finished trial');
select ok((select approved_at is not null and approved_by is not null from public.rule_trials where hospital_code = 'HOSPPVTP0918'),
  'approval is recorded with who and when');
reset role;

-------------------------------------------------------------------------------
-- 3. check_set_claims: no direct write for anyone, even Admin -- pick/accept are the only way in.
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select throws_ok(
  $$insert into public.check_set_claims (hospital_code, record_uid, key_values) values ('HOSPPVTP0918', '00000000-0000-0000-0000-000000001801', '{}'::jsonb)$$,
  '42501', null, 'nobody, not even Admin, can insert into check_set_claims directly');
reset role;

-------------------------------------------------------------------------------
-- 4. pick_check_set_claim: Owner/Admin only; snapshots the claim's key values; capped at 5.
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
set local role authenticated;
select throws_ok(
  $$select public.pick_check_set_claim('00000000-0000-0000-0000-000000001801'::uuid)$$,
  '42501', null, 'a USER with the add/edit tick cannot pick a check-set claim, only Owner or Admin');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select lives_ok($$select public.pick_check_set_claim('00000000-0000-0000-0000-000000001801'::uuid)$$, 'Admin picks a check-set claim');
select is((select (key_values->>'settled_amount') from public.check_set_claims where record_uid = '00000000-0000-0000-0000-000000001801'),
  '85000', 'the snapshot carries the claim''s key values at pick time');
select throws_ok(
  $$select public.pick_check_set_claim('00000000-0000-0000-0000-000000001801'::uuid)$$,
  '23505', null, 'the same claim cannot be picked twice for the same hospital');
reset role;

-------------------------------------------------------------------------------
-- 5. accept_check_set_claim: requires a reason; re-snapshots the current values.
-------------------------------------------------------------------------------
update public.claims_staging set settled_amount = 87000 where record_uid = '00000000-0000-0000-0000-000000001801';

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
select throws_ok(
  $$select public.accept_check_set_claim((select id from public.check_set_claims where record_uid = '00000000-0000-0000-0000-000000001801'), '')$$,
  'P0001', null, 'accepting new values with no reason is refused');
select lives_ok(
  $$select public.accept_check_set_claim((select id from public.check_set_claims where record_uid = '00000000-0000-0000-0000-000000001801'), 'a new payment came in')$$,
  'Admin accepts the new values with a reason');
select is((select (key_values->>'settled_amount') from public.check_set_claims where record_uid = '00000000-0000-0000-0000-000000001801'),
  '87000', 'the snapshot now matches the claim''s current values');
reset role;

select * from finish();
rollback;
