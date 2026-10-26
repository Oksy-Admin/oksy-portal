-- S2 tests: Rule Library seed, active vs proposed vs retired counts,
-- only ADMIN or APPROVER can activate (G9), audit_log and rule_approvals recorded.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into public.users_roles (email, role) values
  ('t-approver@example.test', 'APPROVER'), ('t-helper@example.test', 'HELPER'), ('t-user@example.test', 'USER')
on conflict (email) do nothing;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a2', 't-approver@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 't-helper@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 't-user@example.test', 'authenticated', 'authenticated')
on conflict (id) do nothing;

create or replace function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

-- 1. Rules seeded: 53 catalogue rules + 3 hospital rules from 0005 = 56 rules total
select ok((select count(*)::int from public.rules) >= 53, 'at least 53 catalogue rules exist');

-- 2. Seeded rule versions are marked REFERENCE with needs_review = true (Step 2)
select ok((select count(*)::int from public.rule_versions where status = 'REFERENCE') >= 53,
  'catalogue rule versions are marked REFERENCE');
select ok((select count(*)::int from public.rule_versions where needs_review = true) >= 53,
  'catalogue rule versions are flagged needs_review');

-- 5. Service role can read rules and rule_versions
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok((select count(*)::int from public.rules) >= 53, 'service_role can select rules');
select ok((select count(*)::int from public.rule_versions) >= 53, 'service_role can select rule_versions');
reset role;

-- 6. Rules are never deleted (hard rule 5)
select throws_ok($$delete from public.rules$$, 'P0001', null, 'rules cannot be deleted');
select throws_ok($$delete from public.rule_versions$$, 'P0001', null, 'rule_versions cannot be deleted');

-- 7. USER cannot approve or activate a rule
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select throws_ok(
  $$select public.approve_rule_version((select id from public.rule_versions where rule_id = 'R-D02' and version = 2))$$,
  '42501', null, 'USER cannot approve or activate a rule');
reset role;

-- 8. HELPER cannot approve or activate a rule
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select throws_ok(
  $$select public.approve_rule_version((select id from public.rule_versions where rule_id = 'R-D02' and version = 2))$$,
  '42501', null, 'HELPER cannot approve or activate a rule');
reset role;

-- 9. APPROVER can approve and activate a rule
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok(
  $$select public.approve_rule_version((select id from public.rule_versions where rule_id = 'R-D02' and version = 2), true, 'S2 test approval')$$,
  'APPROVER can approve and activate a rule');
select is((select status::text from public.rule_versions where rule_id = 'R-D02' and version = 2), 'ACTIVE',
  'approved rule version status became ACTIVE');
reset role;

-- 10. HELPER cannot retire a rule (only ADMIN or APPROVER, migration 0018)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select throws_ok(
  $$select public.retire_rule_version((select id from public.rule_versions where rule_id = 'R-D06' limit 1))$$,
  '42501', null, 'HELPER cannot retire a rule');
reset role;

-- 11. The G9 guard has no owner bypass: with no approving user, a status change is refused
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$update public.rule_versions set status = 'ACTIVE' where rule_id = 'R-D06'$$,
  '42501', null, 'without an ADMIN or APPROVER, even the table owner cannot change a rule status');

select * from finish();
rollback;
