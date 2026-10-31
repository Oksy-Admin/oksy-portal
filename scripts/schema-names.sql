-- Schema names of the public and private schemas, one line each, sorted: tables and
-- columns (with type), policies, functions, triggers and the logged-in / worker grants.
-- Names only, never data. Run on a fresh replay (scripts/schema-drift.sh) and on live
-- (read-only, e.g. the Supabase MCP), then compare the two lists.
select line from (
  select 'table ' || n.nspname || '.' || c.relname as line
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind = 'r'
  union all
  select 'column ' || table_schema || '.' || table_name || '.' || column_name || ' ' || data_type
    from information_schema.columns where table_schema in ('public', 'private')
  union all
  select 'policy ' || schemaname || '.' || tablename || '.' || policyname || ' ' || cmd
    from pg_policies where schemaname in ('public', 'private')
  union all
  select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and p.proname <> 'rls_auto_enable'  -- Supabase's own event trigger on live, not ours
  union all
  select 'trigger ' || c.relname || '.' || t.tgname
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and not t.tgisinternal
  union all
  select 'grant ' || r || ' ' || c.relname || ' ' || p
    from pg_class c join pg_namespace n on n.oid = c.relnamespace,
         unnest(array['anon', 'authenticated', 'service_role']) r,
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)
) x order by line;
