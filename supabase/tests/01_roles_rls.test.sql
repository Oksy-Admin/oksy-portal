-- M2 exit tests (brief file 12 A8): roles, RLS, audit, never-delete. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Fake people (example.test is a reserved, non-routable domain).
insert into public.users_roles (email, role) values
  ('t-admin@example.test', 'ADMIN'),
  ('t-approver@example.test', 'APPROVER'),
  ('t-helper@example.test', 'HELPER'),
  ('t-user@example.test', 'USER');

-- Their first Google sign-in creates auth.users rows; the trigger links them.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 't-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 't-approver@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 't-helper@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 't-user@example.test', 'authenticated', 'authenticated');

select is((select count(*)::int from public.users_roles
            where email like 't-%@example.test' and user_id is not null), 4,
  'first sign-in links each registered email to its login');

-- 1. Invite only: an unregistered Google account cannot create a login.
select throws_ok(
  $$insert into auth.users (id, email, aud, role) values
    ('00000000-0000-0000-0000-0000000000ff', 'stranger@example.test', 'authenticated', 'authenticated')$$,
  '42501', 'This account is not registered for the Oksy portal',
  'an unregistered account cannot sign in');

-- Fake hospital and personal data.
insert into public.hospitals (hospital_code, hospital_name) values ('HOSP32P999901', 'Test Hospital One');
insert into public.staff_contacts (hospital_code, staff_name, phone) values ('HOSP32P999901', 'Test Desk Person', '+91 00000 00000');
insert into public.desk_google_accounts (hospital_code, email) values ('HOSP32P999901', 'desk.one@example.test');
insert into public.rules (rule_id, rule_type, title) values ('R-Z99', 'CHECK', 'Test rule');
insert into public.rule_versions (id, rule_id, version, condition_text, severity)
  values ('00000000-0000-0000-0000-00000000b001', 'R-Z99', 1, 'test condition', 'W');

-- Helper to act as a fake person. Sets both forms of the login claim: the hosted
-- auth.uid() reads request.jwt.claims, older images read request.jwt.claim.sub.
create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

-------------------------------------------------------------------------------
-- USER
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select is((select count(*)::int from public.staff_contacts), 0, 'USER cannot see staff phone numbers');
select is((select count(*)::int from public.desk_google_accounts), 0, 'USER cannot see desk Google accounts');
select is((select count(*)::int from public.audit_log), 0, 'USER cannot see the audit log');
select is((select count(*)::int from public.users_roles), 1, 'USER sees only their own role row');
select is((select count(*)::int from public.hospitals where hospital_code = 'HOSP32P999901'), 1, 'USER can see hospital names');
select is((select count(*)::int from public.rule_versions where rule_id = 'R-Z99'), 1, 'USER can view the rule library');
select lives_ok(
  $$insert into public.rule_versions (rule_id, version, condition_text) values ('R-Z99', 2, 'user proposal')$$,
  'USER can propose a rule (PROPOSED)');
select throws_ok(
  $$insert into public.rule_versions (rule_id, version, condition_text, status) values ('R-Z99', 3, 'sneaky', 'ACTIVE')$$,
  '42501', null, 'USER cannot insert an ACTIVE rule');
select throws_ok($$select public.approve_rule_version('00000000-0000-0000-0000-00000000b001')$$,
  '42501', null, 'USER cannot approve a rule');
reset role;

-------------------------------------------------------------------------------
-- HELPER
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select throws_ok($$select public.approve_rule_version('00000000-0000-0000-0000-00000000b001')$$,
  '42501', 'Only ADMIN or APPROVER can approve a rule (G9)', 'HELPER cannot approve a rule');
select throws_ok(
  $$update public.rule_versions set status = 'ACTIVE' where id = '00000000-0000-0000-0000-00000000b001'$$,
  '42501', null, 'HELPER cannot activate a rule by editing the table');
select throws_ok($$select public.set_user_role('x@example.test', 'USER')$$,
  '42501', null, 'HELPER cannot manage users');
select is((select count(*)::int from public.staff_contacts), 1, 'HELPER can see staff contacts (for messages)');
select is((select count(*)::int from public.desk_google_accounts), 1, 'HELPER can see desk Google accounts (to share Question Sheets)');
select lives_ok(
  $$insert into public.desk_google_accounts (hospital_code, email) values ('HOSP32P999901', 'desk.two@example.test')$$,
  'HELPER can add a desk Google account');
select throws_ok($$delete from public.desk_google_accounts$$, '42501', null,
  'HELPER cannot delete a desk Google account (retire with removed_at instead)');
reset role;

-------------------------------------------------------------------------------
-- APPROVER
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$select public.set_user_role('x@example.test', 'USER')$$,
  '42501', 'Only an ADMIN can manage users', 'APPROVER cannot manage users');
select throws_ok($$select public.retire_user('t-helper@example.test')$$,
  '42501', 'Only an ADMIN can manage users', 'APPROVER cannot retire users');
select lives_ok($$select public.approve_rule_version('00000000-0000-0000-0000-00000000b001', true, 'test approval')$$,
  'APPROVER can approve and activate a rule');
reset role;

select is((select approved_by::text from public.rule_versions where id = '00000000-0000-0000-0000-00000000b001'),
  '00000000-0000-0000-0000-0000000000a2', 'the approval stores the approver''s user ID');
select is((select decided_by::text from public.rule_approvals where rule_version_id = '00000000-0000-0000-0000-00000000b001'),
  '00000000-0000-0000-0000-0000000000a2', 'rule_approvals records who approved');
select ok(exists (
    select 1 from public.audit_log
    where table_name = 'rule_versions' and action = 'UPDATE'
      and actor_user_id = '00000000-0000-0000-0000-0000000000a2' and reason = 'test approval'),
  'the approval is written to audit_log with actor and reason');

-------------------------------------------------------------------------------
-- ADMIN
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$select public.set_user_role('t-new@example.test', 'HELPER', 'New Helper')$$,
  'ADMIN can add a user');
select throws_ok($$select public.set_user_role('t-admin@example.test', 'USER')$$,
  '42501', 'You cannot change your own role', 'ADMIN cannot demote themself');
select lives_ok($$select public.retire_user('t-helper@example.test', 'left Oksy')$$, 'ADMIN can retire a user');
select is((select count(*)::int from public.users_roles where email like 't-%@example.test'), 5,
  'ADMIN sees all users; retiring keeps the row');
reset role;

-- A retired user loses access immediately.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select is((select count(*)::int from public.staff_contacts), 0, 'a retired HELPER sees nothing any more');
reset role;

-------------------------------------------------------------------------------
-- Never delete, even for the database owner (hard rule 5)
-------------------------------------------------------------------------------
select throws_ok($$delete from public.audit_log$$, 'P0001', null, 'audit_log rows cannot be deleted');
select throws_ok($$update public.audit_log set reason = 'changed'$$, 'P0001', null, 'audit_log rows cannot be changed');
select throws_ok($$delete from public.rule_versions$$, 'P0001', null, 'rules are never deleted');

-- The worker's service key cannot approve a rule either.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$update public.rule_versions set status = 'APPROVED' where rule_id = 'R-Z99' and version = 2$$,
  '42501', null, 'the service key cannot approve a rule');
reset role;

select * from finish();
rollback;
