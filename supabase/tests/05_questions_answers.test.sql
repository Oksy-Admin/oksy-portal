-- Phase 0b tests: questions, answers, Discount 2 decisions (G12), Golden Tests,
-- PROPOSED rules. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into public.users_roles (email, role) values
  ('t-approver@example.test', 'APPROVER'), ('t-helper@example.test', 'HELPER'), ('t-user@example.test', 'USER');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a2', 't-approver@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 't-helper@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 't-user@example.test', 'authenticated', 'authenticated');

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

-- The worker stores a fake pilot question and its answer. (Discount 2 decisions and Golden
-- Tests were retired on 31-Oct with their tables.)
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into public.questions (id, q_code, hospital_code, question_type, origin, spreadsheet_id, tab_name, row_number,
                              question_text, source_file_id, source_tab, source_question_no)
values ('00000000-0000-0000-0000-00000000c001', 'P0-T5-001', 'HOSP32P000107', 'E', 'PILOT_2026_10',
        'FAKEsheet000000000000000000000003', 'PAID', 12, 'Fake question', 'FAKEanswers0000000000000001', 'TAB 5', '1');
insert into public.answers (id, question_id, channel, answer_value, outcome, source_file_id, source_tab, source_row)
values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'PILOT_WORKBOOK',
        'Final - hospital discount', 'CONFIRMED', 'FAKEanswers0000000000000001', 'TAB 5', 3);
select throws_ok($$insert into public.questions (q_code, hospital_code, question_type, origin, question_text,
    source_file_id, source_tab, source_question_no)
  values ('P0-T5-002', 'HOSP32P000107', 'E', 'PILOT_2026_10', 'again', 'FAKEanswers0000000000000001', 'TAB 5', '1')$$,
  '23505', null, 'the same source question cannot be stored twice (never re-asked)');
reset role;

select throws_ok($$update public.answers set answer_value = 'changed'$$, 'P0001', null, 'answers cannot be changed');
select throws_ok($$delete from public.answers$$, 'P0001', null, 'answers cannot be deleted');
select throws_ok($$delete from public.questions$$, 'P0001', null, 'questions are never deleted');
select ok(exists (select 1 from public.audit_log where table_name = 'answers' and action = 'INSERT'),
  'each answer is written to audit_log');

-- USER sees no patient-related tables.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select is((select count(*)::int from public.questions) + (select count(*)::int from public.answers), 0,
  'USER sees no questions or answers');
reset role;

-- HELPER does question work.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select is((select count(*)::int from public.answers), 1, 'HELPER can see answers');
reset role;


-- The pilot rules exist and none is ACTIVE.
select is((select count(*)::int from public.rule_versions where rule_id in ('R-H01', 'R-H02', 'R-H03')), 3,
  'three pilot rules are stored');
select is((select count(*)::int from public.rule_versions where rule_id in ('R-H01', 'R-H02', 'R-H03') and status <> 'PROPOSED'), 0,
  'all pilot rules are PROPOSED, none ACTIVE');
select is((select status from public.hospitals where hospital_code = 'HOSP32P000107'), 'ACTIVE',
  'the pilot hospital is in the hospital list');

select * from finish();
rollback;
