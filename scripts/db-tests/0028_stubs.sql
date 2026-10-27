-- Local test of migration 20261027000028 on a throwaway Postgres (never the live project).
-- Run: see scripts/db-tests/run-local.sh. Stubs stand in for live objects the migration uses.
-- Minimal stand-ins for the live objects migration 0028 uses. Local test only.
create schema if not exists private;
create type public.app_role as enum ('OWNER','ADMIN','APPROVER','HELPER','USER');
create function private.current_app_role() returns public.app_role language sql stable as
  $$ select nullif(current_setting('test.role', true), '')::public.app_role $$;
create function private.has_role(variadic roles public.app_role[]) returns boolean language sql stable security definer set search_path = '' as
  $$ select coalesce(private.current_app_role() = any(roles) or private.current_app_role() = 'OWNER', false) $$;
create table public.users_roles (user_id uuid, email text);
create table public.audit_log (id bigserial, at timestamptz default now(), actor_user_id uuid, actor_email text, action text, table_name text, record_id text, before jsonb, after jsonb, reason text);
create function private.audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  insert into public.audit_log (actor_user_id, actor_email, action, table_name, record_id, before, after, reason)
  values (v_uid, (select ur.email from public.users_roles ur where ur.user_id = v_uid), tg_op, tg_table_name,
    coalesce(to_jsonb(new), to_jsonb(old)) ->> tg_argv[0],
    case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end,
    nullif(current_setting('oksy.audit_reason', true), ''));
  return coalesce(new, old);
end; $$;
create function private.forbid_delete() returns trigger language plpgsql as $$ begin raise exception 'no delete'; end; $$;
create table public.column_mappings (id uuid primary key default gen_random_uuid(), canonical_field text, confidence numeric, method text, status text default 'PROPOSED', approved_by uuid, approved_at timestamptz);
create table public.claims_staging (record_uid uuid primary key default gen_random_uuid(), extra_fields jsonb not null default '{}');
