-- M3: tab allow-list and the Google read and write log.
-- Brief file 12 A4.2 (allow-list), A4.3 (read log), A8 (M3 exit test); file 05 section 2;
-- CLAUDE.md hard rules 3, 5, 9, 10. Mirrors packages/google (policy.ts, log.ts).
-- Approved by Anoop 24-Oct. Applied to Supabase by Muhammed Ali, never by hand in the dashboard.

-------------------------------------------------------------------------------
-- 1. Tab policies (default deny). One row per tab of a hospital sheet. The worker
--    adds new tabs as REVIEW (or DENY for credential-like names); only a person
--    (HELPER, APPROVER or ADMIN) can set ALLOW, through set_tab_policy below.
--    A tab that disappears from the sheet is marked missing, never deleted.
-------------------------------------------------------------------------------
create type public.tab_policy as enum ('ALLOW', 'DENY', 'REVIEW');
create type public.tab_kind as enum ('DATA', 'LOOKUP', 'LEGEND', 'EXCLUDED');

-- Same names as AUTO_DENY in packages/google/src/policy.ts.
create function private.is_auto_deny_tab(p_tab_name text)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_tab_name ~* '(portal\s*list|password|passwd|login|credential)'
$$;

create table public.sheet_tabs (
  id             uuid primary key default gen_random_uuid(),
  spreadsheet_id text not null check (spreadsheet_id ~ '^[A-Za-z0-9_-]{20,}$'),
  hospital_code  text references public.hospitals (hospital_code),
  tab_name       text not null check (length(tab_name) between 1 and 200),
  policy         public.tab_policy not null default 'REVIEW',
  kind           public.tab_kind,
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  missing_since  timestamptz,
  unique (spreadsheet_id, tab_name),
  -- A credential-like tab can never be ALLOW, whoever tries (hard rule 3).
  constraint sheet_tabs_auto_deny_never_allow
    check (not (policy = 'ALLOW' and private.is_auto_deny_tab(tab_name))),
  -- ALLOW needs a kind and a person who decided it.
  constraint sheet_tabs_allow_is_decided
    check (policy <> 'ALLOW' or (kind is not null and decided_by is not null and decided_at is not null))
);
alter table public.sheet_tabs enable row level security;
select private.protect_table('public.sheet_tabs', 'id');

-- A credential-like tab is always stored as DENY, also when the worker inserts it.
create function private.sheet_tabs_force_auto_deny()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if private.is_auto_deny_tab(new.tab_name) and new.policy <> 'DENY' then
    new.policy := 'DENY';
  end if;
  return new;
end;
$$;
create trigger sheet_tabs_force_auto_deny before insert or update on public.sheet_tabs
  for each row execute function private.sheet_tabs_force_auto_deny();

create policy sheet_tabs_read on public.sheet_tabs for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
grant select on public.sheet_tabs to authenticated;
-- No insert or update grant for logged-in users: the worker (service key) adds tabs,
-- people decide through set_tab_policy.

create function public.set_tab_policy(
  p_spreadsheet_id text, p_tab_name text, p_policy public.tab_policy,
  p_kind public.tab_kind default null, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not private.has_role('ADMIN', 'APPROVER', 'HELPER') then
    raise exception 'Only HELPER, APPROVER or ADMIN can set a tab policy' using errcode = '42501';
  end if;
  if p_policy = 'ALLOW' and private.is_auto_deny_tab(p_tab_name) then
    raise exception 'Tab "%" looks like a login or password list and is always DENY', p_tab_name
      using errcode = '42501';
  end if;
  if p_policy = 'ALLOW' and p_kind is null then
    raise exception 'An ALLOW tab needs a kind (DATA, LOOKUP, LEGEND)' using errcode = '22023';
  end if;
  perform set_config('oksy.audit_reason', coalesce(p_note, 'tab policy set to ' || p_policy), true);
  update public.sheet_tabs
     set policy = p_policy, kind = coalesce(p_kind, kind),
         decided_by = v_uid, decided_at = now(), decision_note = p_note
   where spreadsheet_id = p_spreadsheet_id and tab_name = p_tab_name;
  if not found then
    raise exception 'Tab not found: list the sheet''s tabs first' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.set_tab_policy(text, text, public.tab_policy, public.tab_kind, text) from public, anon;
grant execute on function public.set_tab_policy(text, text, public.tab_policy, public.tab_kind, text) to authenticated;

-------------------------------------------------------------------------------
-- 2. Google events: every read and write of packages/google (brief A4.3). WHAT was
--    touched, never cell content: there is no free-text or JSON column for it.
--    Append-only (no update, delete or truncate). The rows are themselves the log,
--    so they are not copied again into audit_log.
-------------------------------------------------------------------------------
create type public.google_event_kind as enum (
  'LIST_TABS', 'READ_TAB', 'SKIP_TAB',
  'CREATE_SHEET', 'WRITE_VALUES', 'PROTECT_RANGE', 'TRASH_SHEET', 'WRITE_BLOCKED');

create table public.google_events (
  id                 bigint generated always as identity primary key,
  at                 timestamptz not null default now(),
  run_id             uuid,                                  -- the background job (from M6)
  kind               public.google_event_kind not null,
  path               text not null generated always as (
                       case when kind in ('LIST_TABS', 'READ_TAB', 'SKIP_TAB') then 'READ' else 'WRITE' end) stored,
  file_id            text not null check (file_id ~ '^[A-Za-z0-9_-]{10,}$'),
  tab_name           text,
  skipped_policy     public.tab_policy,
  tab_count          integer check (tab_count >= 0),
  row_count          integer check (row_count >= 0),
  range_a1           text check (length(range_a1) <= 200),
  folder_id          text,
  file_name          text check (length(file_name) <= 300),
  grid_sheet_id      integer,
  start_column_index integer check (start_column_index >= 0),
  end_column_index   integer check (end_column_index > start_column_index),
  reason             text check (length(reason) <= 300),
  constraint google_events_shape check (
    case kind
      when 'LIST_TABS'     then tab_count is not null
      when 'READ_TAB'      then tab_name is not null and row_count is not null
      when 'SKIP_TAB'      then tab_name is not null and skipped_policy in ('DENY', 'REVIEW')
      when 'CREATE_SHEET'  then folder_id is not null and file_name is not null
      when 'WRITE_VALUES'  then range_a1 is not null and row_count is not null
      when 'PROTECT_RANGE' then grid_sheet_id is not null and start_column_index is not null and end_column_index is not null
      when 'TRASH_SHEET'   then true
      when 'WRITE_BLOCKED' then reason is not null
    end),
  -- A credential-like tab is never read (hard rule 3): such a log row cannot even exist.
  constraint google_events_no_auto_deny_read
    check (not (kind = 'READ_TAB' and private.is_auto_deny_tab(tab_name)))
);
alter table public.google_events enable row level security;
create index google_events_file_at on public.google_events (file_id, at);

create function private.forbid_log_change()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op using errcode = 'P0001';
end;
$$;
create trigger google_events_no_update before update on public.google_events
  for each row execute function private.forbid_log_change();
create trigger google_events_no_delete before delete on public.google_events
  for each row execute function private.forbid_log_change();
create trigger google_events_no_truncate before truncate on public.google_events
  for each statement execute function private.forbid_log_change();

-- Read by ADMIN and APPROVER only. Written only by the worker (service key, which
-- bypasses RLS); logged-in users get no insert grant.
create policy google_events_read on public.google_events for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER')));
grant select on public.google_events to authenticated;

-------------------------------------------------------------------------------
-- 3. Function permissions (as in migration 0002 section 7): nothing new in private
--    may be run by logged-in users. The worker needs the name check, because the
--    table checks and the insert trigger run it with the worker's rights.
-------------------------------------------------------------------------------
revoke execute on function private.is_auto_deny_tab(text) from public, anon, authenticated;
revoke execute on function private.sheet_tabs_force_auto_deny() from public, anon, authenticated;
revoke execute on function private.forbid_log_change() from public, anon, authenticated;
grant execute on function private.is_auto_deny_tab(text) to service_role;
