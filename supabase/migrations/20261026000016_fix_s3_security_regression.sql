-- Migration 0016: Fix S3 security regression
-- (Corrected: tables missing from live are skipped; import_register is deferred.)
-- 1. Revoke extra worker (service_role) write rights on hospitals, sheets and other tables.
-- 2. Revoke service_role insert on jobs (revert migration 0015).
-- 3. Remove "auth.uid() is null" bypass from human-only guards (G1, G11).

-------------------------------------------------------------------------------
-- 1. Worker table rights (least privilege): revoke all extra rights
-------------------------------------------------------------------------------
revoke all on public.hospitals from service_role;
revoke all on public.version_groups from service_role;

-- Restore least privilege on hospital_sheets for service_role:
revoke all on public.hospital_sheets from service_role;
grant select on public.hospital_sheets to service_role;
grant update (access_status, access_error, last_checked_at, last_ok_at) on public.hospital_sheets to service_role;

-- Revoke direct insert on jobs from service_role (revert migration 0015):
revoke insert on public.jobs from service_role;
revoke execute on function public.request_sheet_run(text, text) from service_role;

-------------------------------------------------------------------------------
-- 2. Remove "auth.uid() is null" bypass from human-only guards
-------------------------------------------------------------------------------

-- Gate G11 (import_register) is not redefined here: it writes to tables that are not on the
-- live database (district_heads, retired_ids, hospital_aliases, open_checks, import_runs, staff_contacts).
-- It will be re-added with those tables.

-- Gate G1: guard_mapping_update
create or replace function private.guard_mapping_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if not private.has_role('ADMIN', 'APPROVER', 'HELPER') then
    if old.status <> 'PROPOSED' and (new.canonical_field, new.confidence, new.method)
                                   is distinct from (old.canonical_field, old.confidence, old.method) then
      raise exception 'Only a PROPOSED mapping can be corrected; an approved mapping changes through G1'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Gate G1: approve_column_mapping
create or replace function public.approve_column_mapping(
  p_id uuid,
  p_canonical_field text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role('ADMIN', 'APPROVER', 'HELPER') then
    raise exception 'Only HELPER, APPROVER or ADMIN can approve column mappings (G1)'
      using errcode = '42501';
  end if;

  update public.column_mappings
     set canonical_field = coalesce(p_canonical_field, canonical_field),
         confidence = 1.0,
         method = 'MANUAL',
         status = 'APPROVED',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_id;
end;
$$;

-- Gate G1: approve_version_group_mappings
create or replace function public.approve_version_group_mappings(
  p_spreadsheet_id text,
  p_header_fp text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.has_role('ADMIN', 'APPROVER', 'HELPER') then
    raise exception 'Only HELPER, APPROVER or ADMIN can approve column mappings (G1)'
      using errcode = '42501';
  end if;

  update public.column_mappings
     set status = 'APPROVED',
         approved_by = auth.uid(),
         approved_at = now()
   where spreadsheet_id = p_spreadsheet_id
     and header_fp = p_header_fp
     and status = 'PROPOSED';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

notify pgrst, 'reload schema';
