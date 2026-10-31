-- Security baseline tests (pgTAP), run in CI with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- 1. Every table in public has Row Level Security on (hard rule 10).
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'every table in public has RLS enabled'
);

-- 2. The safety net works: a new table gets RLS automatically.
create table public._rls_probe (id int);
select ok(
  (select relrowsecurity from pg_class where oid = 'public._rls_probe'::regclass),
  'a newly created table gets RLS automatically'
);

-- 3. With RLS on and no policy, the browser role sees nothing (default deny).
insert into public._rls_probe values (1);
grant select on public._rls_probe to authenticated;
set local role authenticated;
select is((select count(*)::int from public._rls_probe), 0, 'no policy means no rows for logged-in users');
reset role;

-- 4. The private schema: anonymous visitors cannot use it at all; logged-in users may
--    call only the role and tick helpers that RLS policies need, nothing else.
select ok(
  not has_schema_privilege('anon', 'private', 'usage')
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in ('current_app_role', 'has_role', 'has_tick')
  ),
  'private schema: no anon access; authenticated may run only current_app_role, has_role and has_tick'
);

select * from finish();
rollback;
