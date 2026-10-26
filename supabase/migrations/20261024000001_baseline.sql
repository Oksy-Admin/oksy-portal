-- M1 baseline. No business tables yet (they start in M2).
-- Sets the security defaults every later migration relies on (CLAUDE.md hard rule 10).

-- Private schema for helper functions (role checks, approvals). Never exposed through the API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Default deny: new tables, sequences and functions in public get no automatic grants
-- for the browser roles. Each table later grants only what its RLS policies need.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- Safety net: any table created in public has Row Level Security switched on automatically,
-- even if a later migration forgets. The test in supabase/tests checks this as well.
create or replace function private.enable_rls_on_new_table()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obj record;
begin
  for obj in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type = 'table'
      and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', obj.object_identity);
  end loop;
end;
$$;

drop event trigger if exists enable_rls_on_new_table;
create event trigger enable_rls_on_new_table
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function private.enable_rls_on_new_table();
