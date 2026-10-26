-- M3 tests: tab allow-list (default deny) and the Google read and write log. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into public.users_roles (email, role) values
  ('t-admin@example.test', 'ADMIN'),
  ('t-approver@example.test', 'APPROVER'),
  ('t-helper@example.test', 'HELPER'),
  ('t-user@example.test', 'USER');
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 't-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 't-approver@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 't-helper@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 't-user@example.test', 'authenticated', 'authenticated');

create function pg_temp.act_as(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
$$;

-- Fake sheet ID used below (not a real Google file): FAKEsheet000000000000000000000001

-------------------------------------------------------------------------------
-- Worker (service key): adds tabs as it finds them
-------------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('request.jwt.claim.sub', '', true);
select lives_ok($$insert into public.sheet_tabs (spreadsheet_id, tab_name) values
    ('FAKEsheet000000000000000000000001', 'OCTOBER 2026'), ('FAKEsheet000000000000000000000001', 'TPA LIST'), ('FAKEsheet000000000000000000000001', 'NEW TAB')$$,
  'the worker can add new tabs');
select lives_ok($$insert into public.sheet_tabs (spreadsheet_id, tab_name, policy) values ('FAKEsheet000000000000000000000001', 'PORTAL LIST', 'REVIEW')$$,
  'the worker can add PORTAL LIST');
select is((select policy::text from public.sheet_tabs where tab_name = 'PORTAL LIST'), 'DENY',
  'PORTAL LIST is stored as DENY even when inserted as REVIEW');
select is((select policy::text from public.sheet_tabs where tab_name = 'NEW TAB'), 'REVIEW',
  'a new tab starts as REVIEW (default deny)');
select throws_ok($$insert into public.sheet_tabs (spreadsheet_id, tab_name, policy, kind) values ('FAKEsheet000000000000000000000001', 'MAY 2026', 'ALLOW', 'DATA')$$,
  '23514', null, 'the worker cannot add a tab as ALLOW without a person deciding');
reset role;

-------------------------------------------------------------------------------
-- USER
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
set local role authenticated;
select is((select count(*)::int from public.sheet_tabs), 0, 'USER cannot see tab policies');
select is((select count(*)::int from public.google_events), 0, 'USER cannot see the Google log');
select throws_ok($$select public.set_tab_policy('FAKEsheet000000000000000000000001', 'OCTOBER 2026', 'ALLOW', 'DATA')$$,
  '42501', 'Only HELPER, APPROVER or ADMIN can set a tab policy', 'USER cannot set a tab policy');
reset role;

-------------------------------------------------------------------------------
-- HELPER decides tab policies
-------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select is((select count(*)::int from public.sheet_tabs), 4, 'HELPER can see tab policies');
select lives_ok($$select public.set_tab_policy('FAKEsheet000000000000000000000001', 'OCTOBER 2026', 'ALLOW', 'DATA', 'test: month tab')$$,
  'HELPER can mark a tab ALLOW');
select throws_ok($$select public.set_tab_policy('FAKEsheet000000000000000000000001', 'PORTAL LIST', 'ALLOW', 'DATA')$$,
  '42501', null, 'nobody can mark PORTAL LIST ALLOW');
select throws_ok($$select public.set_tab_policy('FAKEsheet000000000000000000000001', 'TPA LIST', 'ALLOW')$$,
  '22023', null, 'ALLOW needs a kind');
select throws_ok($$select public.set_tab_policy('FAKEsheet000000000000000000000001', 'NO SUCH TAB', 'DENY')$$,
  'P0002', null, 'an unknown tab is refused');
select throws_ok($$update public.sheet_tabs set policy = 'ALLOW', kind = 'DATA' where tab_name = 'NEW TAB'$$,
  '42501', null, 'HELPER cannot change a policy by editing the table');
select throws_ok($$insert into public.sheet_tabs (spreadsheet_id, tab_name) values ('FAKEsheet000000000000000000000001', 'X')$$,
  '42501', null, 'HELPER cannot add tabs directly');
select throws_ok($$delete from public.sheet_tabs$$, '42501', null, 'HELPER cannot delete tabs');
select is((select count(*)::int from public.google_events), 0, 'HELPER cannot see the Google log');
reset role;

select is((select decided_by::text from public.sheet_tabs where tab_name = 'OCTOBER 2026'),
  '00000000-0000-0000-0000-0000000000a3', 'the decision stores who decided');
select ok((select decided_at is not null and kind = 'DATA' from public.sheet_tabs where tab_name = 'OCTOBER 2026'),
  'the decision stores when and the kind');
select ok(exists (select 1 from public.audit_log where table_name = 'sheet_tabs' and action = 'UPDATE'
    and actor_user_id = '00000000-0000-0000-0000-0000000000a3' and reason = 'test: month tab'),
  'the decision is written to audit_log with actor and reason');

-- Even the database owner cannot make a credential-like tab ALLOW or delete a tab.
update public.sheet_tabs set policy = 'ALLOW', kind = 'DATA', decided_by = gen_random_uuid(), decided_at = now()
  where tab_name = 'PORTAL LIST';
select is((select policy::text from public.sheet_tabs where tab_name = 'PORTAL LIST'), 'DENY',
  'PORTAL LIST stays DENY even when the database owner edits the table');
select throws_ok($$delete from public.sheet_tabs$$, 'P0001', null, 'tabs are never deleted (mark missing instead)');

-------------------------------------------------------------------------------
-- Google log: written by the worker, append-only, no content columns
-------------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('request.jwt.claim.sub', '', true);
select lives_ok($$insert into public.google_events (kind, file_id, tab_count) values ('LIST_TABS', 'FAKEsheet000000000000000000000001', 4);
    insert into public.google_events (kind, file_id, tab_name, skipped_policy) values ('SKIP_TAB', 'FAKEsheet000000000000000000000001', 'PORTAL LIST', 'DENY');
    insert into public.google_events (kind, file_id, tab_name, row_count) values ('READ_TAB', 'FAKEsheet000000000000000000000001', 'OCTOBER 2026', 120);
    insert into public.google_events (kind, file_id, reason) values ('WRITE_BLOCKED', 'FAKEsheet000000000000000000000001', 'file is not in the Oksy Question Sheets folder')$$,
  'the worker can log reads, skips and blocked writes');
select throws_ok($$insert into public.google_events (kind, file_id, tab_name, row_count) values ('READ_TAB', 'FAKEsheet000000000000000000000001', 'PORTAL LIST', 3)$$,
  '23514', null, 'a read of PORTAL LIST cannot even be logged');
select throws_ok($$insert into public.google_events (kind, file_id) values ('READ_TAB', 'FAKEsheet000000000000000000000001')$$,
  '23514', null, 'a READ_TAB event must name the tab and row count');
reset role;

select is((select path from public.google_events where kind = 'READ_TAB'), 'READ', 'read events are on the READ path');
select is((select path from public.google_events where kind = 'WRITE_BLOCKED'), 'WRITE', 'write events are on the WRITE path');
select throws_ok($$update public.google_events set row_count = 0$$, 'P0001', null, 'the Google log cannot be changed');
select throws_ok($$delete from public.google_events$$, 'P0001', null, 'the Google log cannot be deleted');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from public.google_events), 4, 'APPROVER can read the Google log');
select throws_ok($$insert into public.google_events (kind, file_id, tab_count) values ('LIST_TABS', 'FAKEsheet000000000000000000000001', 1)$$,
  '42501', null, 'logged-in users cannot write to the Google log');
reset role;

select * from finish();
rollback;
