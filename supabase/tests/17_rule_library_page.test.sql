-- Stage 2d: the Rule Library page. save_rule_version (tick-gated, always PROPOSED, conflict
-- reason required when a conflict is shown), rule_test_runs RLS, undo_rule_upload_batch
-- (Owner/Admin only, undo as a group).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into public.users_roles (email, role) values
  ('t-rl-admin@example.test', 'ADMIN'),
  ('t-rl-editor@example.test', 'USER'),
  ('t-rl-viewer@example.test', 'USER');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 't-rl-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 't-rl-editor@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e3', 't-rl-viewer@example.test', 'authenticated', 'authenticated');
insert into public.user_access_ticks (email, rule_library_view, rule_library_add_edit) values
  ('t-rl-editor@example.test', true, true),
  ('t-rl-viewer@example.test', true, false);

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

-- 1. A viewer (view tick only) cannot save a rule.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e3');
set local role authenticated;
select throws_ok(
  $$select public.save_rule_version('R-Z90', 'CHECK', 'Test rule', '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"los_days","operator":"GREATER_THAN","compareValue":40}],"issueField":"los_days"}'::jsonb, 'W', 'ASK_STAFF', 'Stay over 40 days.')$$,
  '42501', null, 'a user with only the view tick cannot save a rule');
reset role;

-- 2. A user with the add/edit tick can save a rule; it is always PROPOSED, never ACTIVE.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
set local role authenticated;
select is((select public.save_rule_version('R-Z90', 'CHECK', 'Test rule', '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"los_days","operator":"GREATER_THAN","compareValue":40}],"issueField":"los_days"}'::jsonb, 'W', 'ASK_STAFF', 'Stay over 40 days.'))::int, 1,
  'first save of a new rule id is version 1');
select is((select status::text from public.rule_versions where rule_id = 'R-Z90' and version = 1), 'PROPOSED',
  'a saved version is always PROPOSED, never ACTIVE (activation stays the separate G9 step)');

-- 3. Editing makes a new version; history (version 1) is kept, not overwritten.
select is((select public.save_rule_version('R-Z90', 'CHECK', 'Test rule v2', '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"los_days","operator":"GREATER_THAN","compareValue":45}],"issueField":"los_days"}'::jsonb, 'W', 'ASK_STAFF', 'Stay over 45 days.'))::int, 2,
  'editing the same rule id makes version 2');
select ok((select count(*)::int from public.rule_versions where rule_id = 'R-Z90') = 2, 'both versions are kept (Delete = Inactive, never overwritten)');

-- 4. A conflict shown but no reason given is refused; with a reason it is saved and recorded.
select throws_ok(
  $$select public.save_rule_version('R-Z91', 'CHECK', 'Conflicting rule', '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"los_days","operator":"LESS_THAN","compareValue":40}],"issueField":"los_days"}'::jsonb, 'W', 'ASK_STAFF', 'x', null, null, null, null, null, null, null, null, array['R-Z90'])$$,
  'P0001', null, 'a shown conflict with no reason is refused');
select lives_ok(
  $$select public.save_rule_version('R-Z91', 'CHECK', 'Conflicting rule', '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"los_days","operator":"LESS_THAN","compareValue":40}],"issueField":"los_days"}'::jsonb, 'W', 'ASK_STAFF', 'x', null, null, null, null, null, null, null, null, array['R-Z90'], 'Anoop: fine together, different insurers')$$,
  'a conflict with a reason is saved');
select ok((select approver_note from public.rule_versions where rule_id = 'R-Z91' and version = 1) like '%R-Z90%',
  'the conflict and its reason are recorded on the saved version');
reset role;

-- 5. rule_test_runs: visible to a view-tick user, insertable only by an add/edit-tick user.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
set local role authenticated;
insert into public.rule_test_runs (draft) values ('{"ruleId":"R-Z90"}'::jsonb);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e3');
set local role authenticated;
select ok((select count(*)::int from public.rule_test_runs) >= 1, 'a view-tick user can read a queued test run');
select throws_ok($$insert into public.rule_test_runs (draft) values ('{}'::jsonb)$$, '42501', null,
  'a view-only user cannot queue a test run');
reset role;

-- 6. undo_rule_upload_batch: Owner/Admin only, retires every PROPOSED version from the batch.
insert into public.rule_upload_batches (id, file_name, total_rows, accepted_rows, rejected_rows) values
  ('00000000-0000-0000-0000-0000000000f1', 'rules.csv', 1, 1, 0);
update public.rule_versions set upload_batch_id = '00000000-0000-0000-0000-0000000000f1'
  where rule_id = 'R-Z90' and version = 2;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
set local role authenticated;
select throws_ok(
  $$select public.undo_rule_upload_batch('00000000-0000-0000-0000-0000000000f1'::uuid)$$,
  '42501', null, 'a USER (even with the add/edit tick) cannot undo an upload, only Owner or Admin');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
set local role authenticated;
select is((select public.undo_rule_upload_batch('00000000-0000-0000-0000-0000000000f1'::uuid, 'test undo'))::int, 1,
  'Admin undoes the batch; one version retired');
select is((select status::text from public.rule_versions where rule_id = 'R-Z90' and version = 2), 'RETIRED',
  'the uploaded version is retired by the undo');
reset role;

select * from finish();
rollback;
