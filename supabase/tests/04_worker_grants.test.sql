-- Worker (service_role) table rights: exactly the ones in migrations 0004, 0005, 0007, 0008 and the
-- Stage 1c reconcile (which also removed TRUNCATE / REFERENCES / TRIGGER everywhere), no others.
-- The test database grants nothing by default (scripts/db-test-local.sh), as live.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- 1. The whole list of service_role rights on public tables, compared as a set.
select is(
  (select string_agg(c.relname || '.' || p.priv, ', ' order by c.relname collate "C", p.priv collate "C")
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and has_table_privilege('service_role', c.oid, p.priv)),
  'answers.INSERT, answers.SELECT, change_log.INSERT, change_log.SELECT, '
  || 'claims_staging.INSERT, claims_staging.SELECT, claims_staging.UPDATE, column_mappings.INSERT, column_mappings.SELECT, '
  || 'google_events.INSERT, google_events.SELECT, header_decisions.SELECT, hospital_sheets.SELECT, '
  || 'issues.INSERT, issues.SELECT, issues.UPDATE, jobs.SELECT, payments.INSERT, payments.SELECT, payments.UPDATE, '
  || 'questions.INSERT, questions.SELECT, questions.UPDATE, reconciliations.INSERT, reconciliations.SELECT, '
  || 'record_keys.INSERT, record_keys.SELECT, rule_versions.SELECT, rules.SELECT, sheet_tabs.INSERT, sheet_tabs.SELECT, sheet_tabs.UPDATE, '
  || 'snapshots.INSERT, snapshots.SELECT',
  'service_role has exactly the rights of migrations 0004, 0005, 0007, 0008, 1b-i and the 1c reconcile, no others');

-- 2. Named checks, so a failure says which right is wrong.
select ok(has_table_privilege('service_role', 'public.sheet_tabs', 'SELECT'), 'worker can read sheet_tabs');
select ok(has_table_privilege('service_role', 'public.sheet_tabs', 'INSERT'), 'worker can add tabs');
select ok(has_table_privilege('service_role', 'public.sheet_tabs', 'UPDATE'), 'worker can update tabs (last seen, missing)');
select ok(not has_table_privilege('service_role', 'public.sheet_tabs', 'DELETE'), 'worker cannot delete tabs');
select ok(has_table_privilege('service_role', 'public.google_events', 'INSERT'), 'worker can write the Google log');
select ok(not has_table_privilege('service_role', 'public.google_events', 'UPDATE'), 'worker cannot change the Google log');
select ok(not has_table_privilege('service_role', 'public.google_events', 'DELETE'), 'worker cannot delete from the Google log');
select ok(not has_table_privilege('service_role', 'public.audit_log', 'INSERT')
          and not has_table_privilege('service_role', 'public.audit_log', 'SELECT'), 'worker has no direct audit_log right');
select ok(not has_table_privilege('service_role', 'public.users_roles', 'SELECT')
          and not has_table_privilege('service_role', 'public.hospitals', 'SELECT'), 'worker cannot read users_roles or hospitals');

-- 3. anon gets nothing; logged-in users only read (through RLS).
select ok(not exists (
    select 1 from unnest(array['public.sheet_tabs','public.google_events']) t(name),
                  unnest(array['SELECT','INSERT','UPDATE','DELETE']) p(priv)
     where has_table_privilege('anon', t.name, p.priv)), 'anon has no right on sheet_tabs or google_events');
select ok(has_table_privilege('authenticated', 'public.sheet_tabs', 'SELECT')
          and not has_table_privilege('authenticated', 'public.sheet_tabs', 'INSERT')
          and not has_table_privilege('authenticated', 'public.google_events', 'INSERT'),
  'logged-in users may only read (RLS decides who)');

-- 4. The worker's real writes work with only these rights (audit row written by the trigger).
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into public.sheet_tabs (spreadsheet_id, tab_name) values ('FAKEsheet000000000000000000000002', 'PAID')
  on conflict (spreadsheet_id, tab_name) do nothing;
insert into public.sheet_tabs (spreadsheet_id, tab_name) values ('FAKEsheet000000000000000000000002', 'PAID')
  on conflict (spreadsheet_id, tab_name) do nothing;
insert into public.google_events (kind, file_id, tab_count) values ('LIST_TABS', 'FAKEsheet000000000000000000000002', 1);
reset role;
select ok((select count(*) = 1 from public.sheet_tabs where spreadsheet_id = 'FAKEsheet000000000000000000000002')
          and exists (select 1 from public.audit_log where table_name = 'sheet_tabs' and action = 'INSERT'),
  'worker upsert of a tab and a log row work with these rights; the audit row is written');

select * from finish();
rollback;
