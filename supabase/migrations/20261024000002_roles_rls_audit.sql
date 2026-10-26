-- M2: login, roles, Row Level Security, audit log.
-- Brief file 12 A4a (roles), A8 (M2 exit test); CLAUDE.md hard rules 5, 8, 9, 10.
-- Every table: RLS on, default deny, no DELETE ever, every change written to audit_log.

-------------------------------------------------------------------------------
-- 0. Private schema: helper functions only. It is NOT exposed through the API
--    (supabase/config.toml api.schemas = public). Logged-in users may call only
--    the two role helpers that RLS policies need.
-------------------------------------------------------------------------------
-- Postgres lets everyone run a new function unless this is revoked globally
-- (a per-schema default cannot remove it). Section 7 also revokes explicitly.
alter default privileges revoke execute on functions from public;
grant usage on schema private to authenticated;

-------------------------------------------------------------------------------
-- 1. Roles and users
-------------------------------------------------------------------------------
create type public.app_role as enum ('ADMIN', 'APPROVER', 'HELPER', 'USER');

-- One row per person allowed into the portal. Keyed by email so an ADMIN can add
-- someone before their first Google sign-in; user_id is filled at first sign-in.
-- Never deleted: a person who leaves is retired (active = false).
create table public.users_roles (
  email        text primary key check (email = lower(email) and email like '%_@_%'),
  user_id      uuid unique references auth.users (id) on delete set null,
  role         public.app_role not null,
  display_name text,
  active       boolean not null default true,
  granted_by   uuid,
  granted_at   timestamptz not null default now(),
  retired_by   uuid,
  retired_at   timestamptz,
  constraint users_roles_retired_consistent
    check ((active and retired_at is null) or (not active and retired_at is not null))
);
alter table public.users_roles enable row level security;

create function private.current_app_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select ur.role from public.users_roles ur
  where ur.user_id = (select auth.uid()) and ur.active
$$;

create function private.has_role(variadic roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_app_role() = any (roles), false)
$$;


-------------------------------------------------------------------------------
-- 2. Never delete (hard rule 5) and audit (hard rule 9)
-------------------------------------------------------------------------------
create function private.forbid_delete()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'Deleting from % is not allowed: mark, link or retire instead (hard rule 5)', tg_table_name
    using errcode = 'P0001';
end;
$$;

create table public.audit_log (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor_user_id uuid,
  actor_email   text,
  action        text not null,
  table_name    text,
  record_id     text,
  before        jsonb,
  after         jsonb,
  reason        text
);
alter table public.audit_log enable row level security;

create function private.forbid_audit_change()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only: % is not allowed', tg_op using errcode = 'P0001';
end;
$$;

create trigger audit_log_no_update before update on public.audit_log
  for each row execute function private.forbid_audit_change();
create trigger audit_log_no_delete before delete on public.audit_log
  for each row execute function private.forbid_audit_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.forbid_audit_change();

-- Row trigger: writes old and new values to audit_log. TG_ARGV[0] = key column name.
-- A function may set a reason first with set_config('oksy.audit_reason', ..., true).
create function private.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  insert into public.audit_log (actor_user_id, actor_email, action, table_name, record_id, before, after, reason)
  values (
    v_uid,
    (select ur.email from public.users_roles ur where ur.user_id = v_uid),
    tg_op,
    tg_table_name,
    coalesce(to_jsonb(new), to_jsonb(old)) ->> tg_argv[0],
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    nullif(current_setting('oksy.audit_reason', true), '')
  );
  return coalesce(new, old);
end;
$$;

-- Attach "no delete" and "audit" to a table in one call.
create function private.protect_table(p_table regclass, p_key text)
returns void
language plpgsql set search_path = ''
as $$
begin
  execute format('create trigger %I before delete on %s for each row execute function private.forbid_delete()',
                 'no_delete', p_table);
  execute format('create trigger %I before truncate on %s for each statement execute function private.forbid_delete()',
                 'no_truncate', p_table);
  execute format('create trigger %I after insert or update on %s for each row execute function private.audit_row(%L)',
                 'audit', p_table, p_key);
end;
$$;
revoke execute on function private.protect_table(regclass, text) from public, anon, authenticated;

select private.protect_table('public.users_roles', 'email');

-- Policies: everyone reads their own row; ADMIN reads all. Changes only through
-- set_user_role / retire_user below (no INSERT or UPDATE grant for logged-in users).
create policy users_roles_read_own on public.users_roles
  for select to authenticated using (user_id = (select auth.uid()));
create policy users_roles_admin_reads_all on public.users_roles
  for select to authenticated using ((select private.has_role('ADMIN')));
grant select on public.users_roles to authenticated;

create policy audit_log_read on public.audit_log
  for select to authenticated using ((select private.has_role('ADMIN', 'APPROVER')));
grant select on public.audit_log to authenticated;

-------------------------------------------------------------------------------
-- 3. Invite-only sign-in: a Google account can create a portal login only if an
--    ADMIN added its email first. Anyone else is refused before a login exists.
-------------------------------------------------------------------------------
create function private.link_new_auth_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(new.email);
begin
  if v_email is null or not exists (
    select 1 from public.users_roles ur where ur.email = v_email and ur.active
  ) then
    raise exception 'This account is not registered for the Oksy portal' using errcode = '42501';
  end if;
  update public.users_roles set user_id = new.id
    where email = v_email and (user_id is null or user_id = new.id);
  if not found then
    raise exception 'This email is already linked to another login' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger oksy_link_new_auth_user after insert on auth.users
  for each row execute function private.link_new_auth_user();

-- User management: ADMIN only (APPROVER cannot manage users, brief A4a).
create function public.set_user_role(
  p_email text, p_role public.app_role, p_display_name text default null, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(trim(p_email));
begin
  if not private.has_role('ADMIN') then
    raise exception 'Only an ADMIN can manage users' using errcode = '42501';
  end if;
  if exists (select 1 from public.users_roles where email = v_email and user_id = v_uid) then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  perform set_config('oksy.audit_reason', coalesce(p_reason, 'role set by ADMIN'), true);
  insert into public.users_roles as ur (email, role, display_name, granted_by)
  values (v_email, p_role, p_display_name, v_uid)
  on conflict (email) do update
    set role = excluded.role,
        display_name = coalesce(excluded.display_name, ur.display_name),
        active = true, retired_at = null, retired_by = null,
        granted_by = v_uid, granted_at = now();
end;
$$;

create function public.retire_user(p_email text, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(trim(p_email));
begin
  if not private.has_role('ADMIN') then
    raise exception 'Only an ADMIN can manage users' using errcode = '42501';
  end if;
  if exists (select 1 from public.users_roles where email = v_email and user_id = v_uid) then
    raise exception 'You cannot retire yourself' using errcode = '42501';
  end if;
  perform set_config('oksy.audit_reason', coalesce(p_reason, 'retired by ADMIN'), true);
  update public.users_roles set active = false, retired_at = now(), retired_by = v_uid
    where email = v_email and active;
  if not found then
    raise exception 'No active user with that email' using errcode = 'P0002';
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- 4. Hospitals (shell; filled from the register at M4) and restricted personal data
-------------------------------------------------------------------------------
create table public.hospitals (
  hospital_code text primary key check (hospital_code ~ '^HOSP32P[0-9]{6}$'),
  hospital_name text not null,
  status        text not null default 'ACTIVE' check (status in ('ACTIVE', 'STOPPED')),
  created_at    timestamptz not null default now()
);
alter table public.hospitals enable row level security;
select private.protect_table('public.hospitals', 'hospital_code');

create policy hospitals_read on public.hospitals for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER', 'USER')));
create policy hospitals_insert on public.hospitals for insert to authenticated
  with check ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy hospitals_update on public.hospitals for update to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')))
  with check ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
grant select, insert, update on public.hospitals to authenticated;

-- Staff phone numbers: personal data, never visible to USER (hard rule 10).
create table public.staff_contacts (
  id            uuid primary key default gen_random_uuid(),
  hospital_code text not null references public.hospitals (hospital_code),
  staff_name    text not null,
  designation   text,
  phone         text,
  source        text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  retired_by    uuid,
  retired_at    timestamptz
);
alter table public.staff_contacts enable row level security;
select private.protect_table('public.staff_contacts', 'id');

-- Desk team Google accounts that a Question Sheet is shared with (D-048). Personal data.
create table public.desk_google_accounts (
  id            uuid primary key default gen_random_uuid(),
  hospital_code text not null references public.hospitals (hospital_code),
  email         text not null check (email = lower(email) and email like '%_@_%'),
  added_by      uuid default auth.uid(),
  added_at      timestamptz not null default now(),
  removed_by    uuid,
  removed_at    timestamptz
);
create unique index desk_google_accounts_one_active
  on public.desk_google_accounts (hospital_code, email) where removed_at is null;
alter table public.desk_google_accounts enable row level security;
select private.protect_table('public.desk_google_accounts', 'id');

create policy staff_contacts_read on public.staff_contacts for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy staff_contacts_insert on public.staff_contacts for insert to authenticated
  with check ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy staff_contacts_update on public.staff_contacts for update to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')))
  with check ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
grant select, insert, update on public.staff_contacts to authenticated;

create policy desk_accounts_read on public.desk_google_accounts for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy desk_accounts_insert on public.desk_google_accounts for insert to authenticated
  with check ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy desk_accounts_update on public.desk_google_accounts for update to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')))
  with check ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
grant select, insert, update on public.desk_google_accounts to authenticated;

-------------------------------------------------------------------------------
-- 5. Rule Library tables (file 04 section 10.1). Seed and engine come in M5.
--    Anyone may PROPOSE; only ADMIN or APPROVER may approve or activate (G9, hard rule 8).
-------------------------------------------------------------------------------
create type public.rule_type as enum ('CHECK', 'PARAMETER');
create type public.rule_status as enum ('PROPOSED', 'PREVIEWED', 'APPROVED', 'ACTIVE', 'RETIRED');
create type public.rule_severity as enum ('E', 'W', 'I');

create table public.rules (
  rule_id    text primary key check (rule_id ~ '^R-[A-Z][0-9]{2}$'),
  rule_type  public.rule_type not null,
  title      text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.rules enable row level security;
select private.protect_table('public.rules', 'rule_id');

create table public.rule_versions (
  id                     uuid primary key default gen_random_uuid(),
  rule_id                text not null references public.rules (rule_id),
  version                integer not null check (version >= 1),
  hospital_filter        text references public.hospitals (hospital_code),
  scheme_filter          text,
  insurer_filter         text,
  specificity            integer generated always as (
                           (hospital_filter is not null)::int
                         + (scheme_filter is not null)::int
                         + (insurer_filter is not null)::int) stored,
  valid_from             date,
  valid_to               date,
  condition_text         text not null,
  code_ref               text,
  parameter_name         text,
  parameter_value        numeric,
  severity               public.rule_severity,
  auto_fix_allowed       boolean not null default false,
  tier                   text check (tier in ('A', 'B', 'C', 'D')),
  action                 text,
  prevention_action      text,
  status                 public.rule_status not null default 'PROPOSED',
  first_seen_hospital    text,
  first_seen_date        date,
  author                 uuid default auth.uid(),
  authored_at            timestamptz not null default now(),
  impact_preview_summary jsonb,
  golden_test_ids        text[],
  approved_by            uuid,
  approved_on            timestamptz,
  exceptions             text[],
  unique (rule_id, version),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
alter table public.rule_versions enable row level security;
select private.protect_table('public.rule_versions', 'id');

create table public.rule_approvals (
  id              uuid primary key default gen_random_uuid(),
  rule_version_id uuid not null references public.rule_versions (id),
  decision        text not null check (decision in ('APPROVED', 'ACTIVATED', 'RETIRED')),
  decided_by      uuid not null,
  decided_at      timestamptz not null default now(),
  note            text
);
alter table public.rule_approvals enable row level security;
select private.protect_table('public.rule_approvals', 'id');

-- Guard (defence in depth): no path, not even the worker's service key, can approve
-- or activate a rule unless the logged-in user is ADMIN or APPROVER, and the
-- approver's user ID is always stored.
create function private.guard_rule_status()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'PROPOSED' and current_user in ('anon', 'authenticated', 'service_role') then
      raise exception 'A new rule version must start as PROPOSED' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     or new.approved_by is distinct from old.approved_by
     or new.approved_on is distinct from old.approved_on then
    if not private.has_role('ADMIN', 'APPROVER') then
      raise exception 'Only ADMIN or APPROVER can approve or activate a rule (G9)' using errcode = '42501';
    end if;
    if new.status in ('APPROVED', 'ACTIVE') and new.approved_by is distinct from auth.uid() then
      raise exception 'approved_by must be the approving user' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_rule_status before insert or update on public.rule_versions
  for each row execute function private.guard_rule_status();

create policy rules_read on public.rules for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER', 'USER')));
create policy rules_propose on public.rules for insert to authenticated
  with check ((select private.has_role('ADMIN', 'APPROVER', 'HELPER', 'USER')));
grant select, insert on public.rules to authenticated;

create policy rule_versions_read on public.rule_versions for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER', 'USER')));
create policy rule_versions_propose on public.rule_versions for insert to authenticated
  with check (
    (select private.has_role('ADMIN', 'APPROVER', 'HELPER', 'USER'))
    and status = 'PROPOSED' and approved_by is null and approved_on is null
    and author = (select auth.uid())
  );
grant select, insert on public.rule_versions to authenticated;

create policy rule_approvals_read on public.rule_approvals for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER', 'USER')));
grant select on public.rule_approvals to authenticated;

-- G9: the only way to approve or activate. Shadow results and Golden Tests are
-- added as preconditions in M5.
create function public.approve_rule_version(p_rule_version_id uuid, p_activate boolean default true, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_status public.rule_status;
begin
  if not private.has_role('ADMIN', 'APPROVER') then
    raise exception 'Only ADMIN or APPROVER can approve a rule (G9)' using errcode = '42501';
  end if;
  select status into v_status from public.rule_versions where id = p_rule_version_id for update;
  if not found then
    raise exception 'Rule version not found' using errcode = 'P0002';
  end if;
  if v_status not in ('PROPOSED', 'PREVIEWED', 'APPROVED') then
    raise exception 'Rule version is %, it cannot be approved', v_status using errcode = 'P0001';
  end if;
  perform set_config('oksy.audit_reason', coalesce(p_note, 'G9 approval'), true);
  update public.rule_versions
     set status = (case when p_activate then 'ACTIVE' else 'APPROVED' end)::public.rule_status,
         approved_by = v_uid, approved_on = now()
   where id = p_rule_version_id;
  insert into public.rule_approvals (rule_version_id, decision, decided_by, note)
  values (p_rule_version_id, case when p_activate then 'ACTIVATED' else 'APPROVED' end, v_uid, p_note);
end;
$$;

revoke execute on function public.set_user_role(text, public.app_role, text, text) from public, anon;
revoke execute on function public.retire_user(text, text) from public, anon;
revoke execute on function public.approve_rule_version(uuid, boolean, text) from public, anon;
grant execute on function public.set_user_role(text, public.app_role, text, text) to authenticated;
grant execute on function public.retire_user(text, text) to authenticated;
grant execute on function public.approve_rule_version(uuid, boolean, text) to authenticated;

-------------------------------------------------------------------------------
-- 7. Function permissions, set last so nothing created above is missed:
--    in private, logged-in users and the worker may run only the role helpers.
-------------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.current_app_role() to authenticated, service_role;
grant execute on function private.has_role(public.app_role[]) to authenticated, service_role;

-------------------------------------------------------------------------------
-- 8. First users (CLAUDE.md accounts table, D-037). They can sign in with Google
--    once the Supabase project and Google sign-in exist.
-------------------------------------------------------------------------------
select set_config('oksy.audit_reason', 'M2 bootstrap: accounts from CLAUDE.md / D-036, D-037', true);
insert into public.users_roles (email, role, display_name) values
  ('anoop@oksy.in', 'ADMIN', 'Anoop Das'),
  ('admin@oksy.in', 'APPROVER', 'Muhammed Ali');
