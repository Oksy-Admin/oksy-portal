-- M4: Hospital Master from register v4 (brief A7, file 02 section 3, file 07 sections 6
-- and 12, file 10). Approved by Anoop 25-Oct ("Yes, as in file 07").
-- Applied by Anoop with `supabase db push --linked`.
-- Every table: RLS on, default deny, no delete (rows are marked, never removed), audit.
-- The register is saved only through public.import_register (G11: HELPER, APPROVER,
-- ADMIN), which re-counts the payload and refuses it unless the counts match the
-- register's own RECONCILIATION sheet.

-------------------------------------------------------------------------------
-- 1. Hospitals: the register columns (scheme matrix and DBDO/RBDO are derived, not stored)
-------------------------------------------------------------------------------
alter table public.hospitals
  add column district                    text,
  add column rohini_id                   text,
  add column kasp_portal_name            text,
  add column medisep_portal_name         text,
  add column check_flag                  text,
  add column remarks                     text,
  add column missing_from_register_since timestamptz,   -- set when a later register no longer lists it
  add column last_import_run_id          uuid,
  add column updated_at                  timestamptz not null default now();

-------------------------------------------------------------------------------
-- 2. District heads (DBDO and RBDO per district; looked up, never typed on a hospital)
-------------------------------------------------------------------------------
create table public.district_heads (
  district   text primary key check (length(district) between 1 and 100),
  dbdo       text,
  rbdo       text,
  note       text,
  updated_at timestamptz not null default now()
);
alter table public.district_heads enable row level security;
select private.protect_table('public.district_heads', 'district');

-------------------------------------------------------------------------------
-- 3. Retired (merged) IDs. A retired ID is never a hospital again (CLAUDE.md: never reuse).
-------------------------------------------------------------------------------
create table public.retired_ids (
  retired_id           text primary key check (retired_id ~ '^HOSP32P[0-9]{6}$'),
  kept_id              text not null references public.hospitals (hospital_code),
  name_at_retirement   text,
  status_at_retirement text,
  retired_on           date,
  reason               text,
  created_at           timestamptz not null default now(),
  check (retired_id <> kept_id)
);
alter table public.retired_ids enable row level security;
select private.protect_table('public.retired_ids', 'retired_id');

create function private.guard_retired_id()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- Nested on purpose: PL/pgSQL resolves every field in a condition, so new.retired_id
  -- may only be named when the trigger runs on retired_ids.
  if tg_table_name = 'hospitals' then
    if exists (select 1 from public.retired_ids r where r.retired_id = new.hospital_code) then
      raise exception '% is a retired ID: use the kept ID instead', new.hospital_code using errcode = '23514';
    end if;
  else
    if exists (select 1 from public.hospitals h where h.hospital_code = new.retired_id) then
      raise exception '% is still a hospital row: it cannot also be retired', new.retired_id using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_retired_id before insert or update on public.hospitals
  for each row execute function private.guard_retired_id();
create trigger guard_retired_id before insert or update on public.retired_ids
  for each row execute function private.guard_retired_id();

-------------------------------------------------------------------------------
-- 4. Aliases (other spellings, merged names). Names only, no personal data.
-------------------------------------------------------------------------------
create table public.hospital_aliases (
  id            uuid primary key default gen_random_uuid(),
  hospital_code text not null references public.hospitals (hospital_code),
  alias         text not null check (length(alias) between 1 and 300),
  source        text,
  created_at    timestamptz not null default now(),
  unique (hospital_code, alias)
);
alter table public.hospital_aliases enable row level security;
select private.protect_table('public.hospital_aliases', 'id');

-------------------------------------------------------------------------------
-- 5. Hospital sheets: one row = one hospital + scheme (SHEET KEY). The only place for a
--    Google Sheet ID. SYNC decides whether the sheet may ever be read (hard rule 4).
-------------------------------------------------------------------------------
create table public.hospital_sheets (
  sheet_key                   text primary key check (sheet_key = hospital_code || '|' || scheme),
  hospital_code               text not null references public.hospitals (hospital_code),
  scheme                      text not null check (length(scheme) between 1 and 50),
  reg_no                      integer,
  sheet_status                text not null check (sheet_status in ('LINKED', 'UNDERPROCESS', 'SAME_AS_KASP', 'TO_CONFIRM')),
  spreadsheet_id              text check (spreadsheet_id ~ '^[A-Za-z0-9_-]{20,}$'),
  sheet_url                   text check (sheet_url like 'https://docs.google.com/spreadsheets/d/%'),
  check_flag                  text,
  sync                        text not null check (sync in ('YES', 'HOLD', 'NA')),
  -- Set when this row must never be read although SYNC = YES, for example a sheet shared
  -- by two hospitals that is read under the other hospital only (D-046).
  read_skip_reason            text check (length(read_skip_reason) <= 300),
  period_label                text,
  sheet_owner                 text,
  -- Access check (brief A7.5). System columns: written by the worker only.
  access_status               text not null default 'NOT_CHECKED'
                                check (access_status in ('NOT_CHECKED', 'OK', 'ACCESS_PENDING', 'READ_FAILED')),
  access_error                text check (length(access_error) <= 300),
  last_checked_at             timestamptz,
  last_ok_at                  timestamptz,
  missing_from_register_since timestamptz,
  last_import_run_id          uuid,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint hospital_sheets_linked_has_id
    check ((sheet_status = 'LINKED') = (spreadsheet_id is not null)),
  constraint hospital_sheets_yes_needs_id
    check (sync <> 'YES' or spreadsheet_id is not null),
  constraint hospital_sheets_url_matches_id
    check (sheet_url is null or position(spreadsheet_id in sheet_url) > 0)
);
alter table public.hospital_sheets enable row level security;
select private.protect_table('public.hospital_sheets', 'sheet_key');
create index hospital_sheets_spreadsheet on public.hospital_sheets (spreadsheet_id);

-- One Google Sheet may be readable under one hospital only. A second hospital on the same
-- ID is flagged (read_skip_reason) instead of read twice; nothing is fixed silently.
create function private.guard_shared_sheet()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.sync = 'YES' and new.read_skip_reason is null and exists (
    select 1 from public.hospital_sheets s
     where s.spreadsheet_id = new.spreadsheet_id
       and s.hospital_code <> new.hospital_code
       and s.sync = 'YES' and s.read_skip_reason is null
       and s.sheet_key <> new.sheet_key) then
    raise exception 'Sheet % is already readable under another hospital: decide which one reads it (ID_COLLISION)',
      new.spreadsheet_id using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger guard_shared_sheet before insert or update on public.hospital_sheets
  for each row execute function private.guard_shared_sheet();

-------------------------------------------------------------------------------
-- 6. Open checks from the register (decisions waiting or taken; kept as history)
-------------------------------------------------------------------------------
create table public.open_checks (
  check_no       integer primary key,
  status         text not null,
  hospital_code  text,                 -- may be blank or a retired ID: no foreign key on purpose
  hospital_name  text,
  flag           text,
  what_to_decide text,
  decision       text,
  decided_by     text,
  decided_on     text,                 -- as written in the register
  updated_at     timestamptz not null default now()
);
alter table public.open_checks enable row level security;
select private.protect_table('public.open_checks', 'check_no');

-------------------------------------------------------------------------------
-- 7. Staff contacts (existing table): one active row per hospital and name, for re-import
-------------------------------------------------------------------------------
create unique index staff_contacts_one_active
  on public.staff_contacts (hospital_code, staff_name) where retired_at is null;

-------------------------------------------------------------------------------
-- 8. Import runs: one row per saved register import. Append-only.
-------------------------------------------------------------------------------
create table public.import_runs (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('REGISTER')),
  file_name         text not null check (length(file_name) <= 300),
  file_sha256       text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  register_version  text,
  counts            jsonb not null,      -- counted by the database from the payload
  expected          jsonb not null,      -- the register's RECONCILIATION numbers
  preview_summary   jsonb,               -- new / changed / unchanged shown at G11
  affected          jsonb,               -- rows written per table
  confirmed_by      uuid not null,
  confirmed_at      timestamptz not null default now()
);
alter table public.import_runs enable row level security;
create trigger import_runs_no_update before update on public.import_runs
  for each row execute function private.forbid_log_change();
create trigger import_runs_no_delete before delete on public.import_runs
  for each row execute function private.forbid_log_change();
create trigger import_runs_no_truncate before truncate on public.import_runs
  for each statement execute function private.forbid_log_change();
create trigger audit after insert on public.import_runs
  for each row execute function private.audit_row('id');

-------------------------------------------------------------------------------
-- 9. Google log: CHECK_ACCESS (migration 0006) is a read-path event
-------------------------------------------------------------------------------
alter table public.google_events drop constraint google_events_shape;
alter table public.google_events drop column path;
alter table public.google_events add column path text not null generated always as (
  case when kind in ('LIST_TABS', 'READ_TAB', 'SKIP_TAB', 'CHECK_ACCESS') then 'READ' else 'WRITE' end) stored;
alter table public.google_events add constraint google_events_shape check (
  case kind
    when 'LIST_TABS'     then tab_count is not null
    when 'READ_TAB'      then tab_name is not null and row_count is not null
    when 'SKIP_TAB'      then tab_name is not null and skipped_policy in ('DENY', 'REVIEW')
    when 'CREATE_SHEET'  then folder_id is not null and file_name is not null
    when 'WRITE_VALUES'  then range_a1 is not null and row_count is not null
    when 'PROTECT_RANGE' then grid_sheet_id is not null and start_column_index is not null and end_column_index is not null
    when 'TRASH_SHEET'   then true
    when 'WRITE_BLOCKED' then reason is not null
    when 'CHECK_ACCESS'  then tab_name is null and row_count is null   -- reason = error code when it failed
  end);

-------------------------------------------------------------------------------
-- 10. Saving the register (G11). One transaction: all or nothing.
-------------------------------------------------------------------------------
create function public.import_register(p jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_run      uuid := gen_random_uuid();
  v_counts   jsonb;
  v_expected jsonb := p -> 'expected';
  v_key      text;
  v_aff      jsonb := '{}'::jsonb;
  v_n        integer;
begin
  if not private.has_role('ADMIN', 'APPROVER', 'HELPER') then
    raise exception 'Only HELPER, APPROVER or ADMIN can save the register (G11)' using errcode = '42501';
  end if;

  -- Count the payload here, independently of the portal code.
  v_counts := jsonb_build_object(
    'hospitals',      jsonb_array_length(p -> 'hospitals'),
    'active',         (select count(*) from jsonb_array_elements(p -> 'hospitals') h where h ->> 'status' = 'ACTIVE'),
    'stopped',        (select count(*) from jsonb_array_elements(p -> 'hospitals') h where h ->> 'status' = 'STOPPED'),
    'retired_ids',    jsonb_array_length(p -> 'retired_ids'),
    'linked',         (select count(*) from jsonb_array_elements(p -> 'sheets') s where s ->> 'sheet_status' = 'LINKED'),
    'coded_no_url',   (select count(*) from jsonb_array_elements(p -> 'sheets') s where s ->> 'sheet_status' <> 'LINKED'),
    'sync_yes',       (select count(*) from jsonb_array_elements(p -> 'sheets') s where s ->> 'sync' = 'YES'),
    'sync_hold',      (select count(*) from jsonb_array_elements(p -> 'sheets') s where s ->> 'sync' = 'HOLD'),
    'staff',          jsonb_array_length(p -> 'staff'));
  for v_key in select jsonb_object_keys(v_counts) loop
    if v_expected -> v_key is null or (v_expected ->> v_key)::integer <> (v_counts ->> v_key)::integer then
      raise exception 'Register count % is % but RECONCILIATION expects %: nothing saved',
        v_key, v_counts ->> v_key, coalesce(v_expected ->> v_key, '(missing)') using errcode = '23514';
    end if;
  end loop;

  perform set_config('oksy.audit_reason', 'register import ' || v_run::text, true);

  insert into public.district_heads as d (district, dbdo, rbdo, note)
  select x.district, x.dbdo, x.rbdo, x.note
    from jsonb_to_recordset(p -> 'district_heads') as x(district text, dbdo text, rbdo text, note text)
  on conflict (district) do update
    set dbdo = excluded.dbdo, rbdo = excluded.rbdo, note = excluded.note, updated_at = now()
    where (d.dbdo, d.rbdo, d.note) is distinct from (excluded.dbdo, excluded.rbdo, excluded.note);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('district_heads', v_n);

  insert into public.hospitals as h (hospital_code, hospital_name, district, status, rohini_id,
                                     kasp_portal_name, medisep_portal_name, check_flag, remarks, last_import_run_id)
  select x.hospital_code, x.hospital_name, x.district, x.status, x.rohini_id,
         x.kasp_portal_name, x.medisep_portal_name, x.check_flag, x.remarks, v_run
    from jsonb_to_recordset(p -> 'hospitals') as x(hospital_code text, hospital_name text, district text, status text,
         rohini_id text, kasp_portal_name text, medisep_portal_name text, check_flag text, remarks text)
  on conflict (hospital_code) do update
    set hospital_name = excluded.hospital_name, district = excluded.district, status = excluded.status,
        rohini_id = excluded.rohini_id, kasp_portal_name = excluded.kasp_portal_name,
        medisep_portal_name = excluded.medisep_portal_name, check_flag = excluded.check_flag,
        remarks = excluded.remarks, missing_from_register_since = null,
        last_import_run_id = v_run, updated_at = now()
    where (h.hospital_name, h.district, h.status, h.rohini_id, h.kasp_portal_name, h.medisep_portal_name,
           h.check_flag, h.remarks, h.missing_from_register_since is null)
          is distinct from
          (excluded.hospital_name, excluded.district, excluded.status, excluded.rohini_id, excluded.kasp_portal_name,
           excluded.medisep_portal_name, excluded.check_flag, excluded.remarks, true);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('hospitals', v_n);

  update public.hospitals h set missing_from_register_since = now(), updated_at = now()
   where h.missing_from_register_since is null
     and not exists (select 1 from jsonb_array_elements(p -> 'hospitals') x where x ->> 'hospital_code' = h.hospital_code);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('hospitals_marked_missing', v_n);

  insert into public.retired_ids as r (retired_id, kept_id, name_at_retirement, status_at_retirement, retired_on, reason)
  select x.retired_id, x.kept_id, x.name_at_retirement, x.status_at_retirement, x.retired_on, x.reason
    from jsonb_to_recordset(p -> 'retired_ids') as x(retired_id text, kept_id text, name_at_retirement text,
         status_at_retirement text, retired_on date, reason text)
  on conflict (retired_id) do update
    set kept_id = excluded.kept_id, name_at_retirement = excluded.name_at_retirement,
        status_at_retirement = excluded.status_at_retirement, retired_on = excluded.retired_on, reason = excluded.reason
    where (r.kept_id, r.name_at_retirement, r.status_at_retirement, r.retired_on, r.reason)
          is distinct from (excluded.kept_id, excluded.name_at_retirement, excluded.status_at_retirement,
                            excluded.retired_on, excluded.reason);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('retired_ids', v_n);

  insert into public.hospital_aliases (hospital_code, alias, source)
  select x.hospital_code, x.alias, x.source
    from jsonb_to_recordset(p -> 'aliases') as x(hospital_code text, alias text, source text)
  on conflict (hospital_code, alias) do nothing;
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('hospital_aliases', v_n);

  -- Rows without a skip reason first, so the shared-sheet guard sees the reading row last.
  insert into public.hospital_sheets as s (sheet_key, hospital_code, scheme, reg_no, sheet_status, spreadsheet_id,
                                           sheet_url, check_flag, sync, read_skip_reason, last_import_run_id)
  select x.hospital_code || '|' || x.scheme, x.hospital_code, x.scheme, x.reg_no, x.sheet_status, x.spreadsheet_id,
         x.sheet_url, x.check_flag, x.sync, x.read_skip_reason, v_run
    from jsonb_to_recordset(p -> 'sheets') as x(hospital_code text, scheme text, reg_no integer, sheet_status text,
         spreadsheet_id text, sheet_url text, check_flag text, sync text, read_skip_reason text)
   order by (x.read_skip_reason is null), x.reg_no
  on conflict (sheet_key) do update
    set reg_no = excluded.reg_no, sheet_status = excluded.sheet_status, spreadsheet_id = excluded.spreadsheet_id,
        sheet_url = excluded.sheet_url, check_flag = excluded.check_flag, sync = excluded.sync,
        read_skip_reason = excluded.read_skip_reason, missing_from_register_since = null,
        -- A new sheet ID has not been checked yet.
        access_status = case when s.spreadsheet_id is distinct from excluded.spreadsheet_id
                             then 'NOT_CHECKED' else s.access_status end,
        last_import_run_id = v_run, updated_at = now()
    where (s.reg_no, s.sheet_status, s.spreadsheet_id, s.sheet_url, s.check_flag, s.sync, s.read_skip_reason,
           s.missing_from_register_since is null)
          is distinct from
          (excluded.reg_no, excluded.sheet_status, excluded.spreadsheet_id, excluded.sheet_url, excluded.check_flag,
           excluded.sync, excluded.read_skip_reason, true);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('hospital_sheets', v_n);

  update public.hospital_sheets s set missing_from_register_since = now(), updated_at = now()
   where s.missing_from_register_since is null
     and not exists (select 1 from jsonb_array_elements(p -> 'sheets') x
                      where x ->> 'hospital_code' || '|' || (x ->> 'scheme') = s.sheet_key);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('hospital_sheets_marked_missing', v_n);

  insert into public.staff_contacts as c (hospital_code, staff_name, designation, phone, source)
  select x.hospital_code, x.staff_name, x.designation, x.phone, 'REGISTER'
    from jsonb_to_recordset(p -> 'staff') as x(hospital_code text, staff_name text, designation text, phone text)
  on conflict (hospital_code, staff_name) where retired_at is null do update
    set designation = excluded.designation, phone = excluded.phone
    where (c.designation, c.phone) is distinct from (excluded.designation, excluded.phone);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('staff_contacts', v_n);

  insert into public.open_checks as o (check_no, status, hospital_code, hospital_name, flag, what_to_decide,
                                       decision, decided_by, decided_on)
  select x.check_no, x.status, x.hospital_code, x.hospital_name, x.flag, x.what_to_decide,
         x.decision, x.decided_by, x.decided_on
    from jsonb_to_recordset(p -> 'open_checks') as x(check_no integer, status text, hospital_code text,
         hospital_name text, flag text, what_to_decide text, decision text, decided_by text, decided_on text)
  on conflict (check_no) do update
    set status = excluded.status, hospital_code = excluded.hospital_code, hospital_name = excluded.hospital_name,
        flag = excluded.flag, what_to_decide = excluded.what_to_decide, decision = excluded.decision,
        decided_by = excluded.decided_by, decided_on = excluded.decided_on, updated_at = now()
    where (o.status, o.hospital_code, o.hospital_name, o.flag, o.what_to_decide, o.decision, o.decided_by, o.decided_on)
          is distinct from
          (excluded.status, excluded.hospital_code, excluded.hospital_name, excluded.flag, excluded.what_to_decide,
           excluded.decision, excluded.decided_by, excluded.decided_on);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('open_checks', v_n);

  insert into public.import_runs (id, kind, file_name, file_sha256, register_version, counts, expected,
                                  preview_summary, affected, confirmed_by)
  values (v_run, 'REGISTER', p ->> 'file_name', p ->> 'file_sha256', p ->> 'register_version', v_counts, v_expected,
          p -> 'preview_summary', v_aff, v_uid);
  return v_run;
end;
$$;

-------------------------------------------------------------------------------
-- 11. Policies and grants
-------------------------------------------------------------------------------
-- Names that every portal role may see.
create policy district_heads_read on public.district_heads for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER', 'USER')));
create policy retired_ids_read on public.retired_ids for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER', 'USER')));
create policy hospital_aliases_read on public.hospital_aliases for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER', 'USER')));
-- Sheet links, open checks and import runs: helper work, not USER.
create policy hospital_sheets_read on public.hospital_sheets for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy open_checks_read on public.open_checks for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy import_runs_read on public.import_runs for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
-- Read only for logged-in users: every change goes through import_register (or, for the
-- access columns, the worker).
grant select on public.district_heads, public.retired_ids, public.hospital_aliases,
                public.hospital_sheets, public.open_checks, public.import_runs to authenticated;

-- Worker (least privilege, as 0004): read the sheet list and write the access result
-- columns only; nothing else on these tables.
grant select on public.hospital_sheets to service_role;
grant update (access_status, access_error, last_checked_at, last_ok_at) on public.hospital_sheets to service_role;

revoke execute on function public.import_register(jsonb) from public, anon;
grant execute on function public.import_register(jsonb) to authenticated;
revoke execute on function private.guard_retired_id() from public, anon, authenticated;
revoke execute on function private.guard_shared_sheet() from public, anon, authenticated;
