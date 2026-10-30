-- Migration 0018: Portal REFERENCE status, DRAFT rule status, hospital and rule lifecycle
-- (the enum values DRAFT and REFERENCE are added by migration 0017, committed first).
-- 1. Extend hospitals status constraint to include INACTIVE and REFERENCE.
-- 2. Add needs_review flag to hospitals and rule_versions.
-- 3. Rule status guard: allow DRAFT and REFERENCE on insert; every status change still needs ADMIN or APPROVER (G9).
-- 4. Mark existing seeded hospitals and rules as REFERENCE with needs_review = true.
-- 5. Add RPCs for rule retire and hospital/sheet management with audit logging.

-------------------------------------------------------------------------------
-- 1. Hospitals status constraint and review flag
-------------------------------------------------------------------------------
alter table public.hospitals drop constraint if exists hospitals_status_check;
alter table public.hospitals add constraint hospitals_status_check check (status in ('ACTIVE', 'STOPPED', 'INACTIVE', 'REFERENCE'));
alter table public.hospitals add column if not exists needs_review boolean not null default false;

-- Add needs_review to hospital_sheets as well for easy per-sheet filtering
alter table public.hospital_sheets add column if not exists needs_review boolean not null default false;

-------------------------------------------------------------------------------
-- 2. Rule review flag
-------------------------------------------------------------------------------
alter table public.rule_versions add column if not exists needs_review boolean not null default false;

-------------------------------------------------------------------------------
-- 3. Guard rule status trigger (updated before data update)
-------------------------------------------------------------------------------
create or replace function private.guard_rule_status()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('DRAFT', 'PROPOSED', 'REFERENCE') and current_user in ('anon', 'authenticated', 'service_role') then
      raise exception 'A new rule version must start as DRAFT, PROPOSED or REFERENCE' using errcode = '42501';
    end if;
    return new;
  end if;
  -- Same as migration 0002: no owner bypass, so security definer functions are checked too.
  if new.status is distinct from old.status
     or new.approved_by is distinct from old.approved_by
     or new.approved_on is distinct from old.approved_on then
    if not private.has_role('ADMIN', 'APPROVER') then
      raise exception 'Only ADMIN or APPROVER can change a rule status (G9)' using errcode = '42501';
    end if;
    if new.status in ('APPROVED', 'ACTIVE') and new.approved_by is distinct from auth.uid() then
      raise exception 'approved_by must be the approving user' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-------------------------------------------------------------------------------
-- 4. Mark existing seeded items as REFERENCE (preserve pilot hospital & rules)
-------------------------------------------------------------------------------
update public.hospitals set status = 'REFERENCE', needs_review = true where hospital_code <> 'HOSP32P000107';
update public.hospital_sheets set needs_review = true where hospital_code <> 'HOSP32P000107';
-- One-time data change by this migration (no logged-in user): the G9 guard is off for this statement only.
alter table public.rule_versions disable trigger guard_rule_status;
update public.rule_versions set status = 'REFERENCE', needs_review = true where rule_id not in ('R-H01', 'R-H02', 'R-H03');
alter table public.rule_versions enable trigger guard_rule_status;

-------------------------------------------------------------------------------
-- 5. Updated approve_rule_version (supports REFERENCE items) & retire_rule_version
-------------------------------------------------------------------------------
create or replace function public.approve_rule_version(
  p_rule_version_id uuid,
  p_activate boolean default true,
  p_note text default null
)
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
  if v_status not in ('PROPOSED', 'PREVIEWED', 'APPROVED', 'REFERENCE') then
    raise exception 'Rule version is %, it cannot be approved', v_status using errcode = 'P0001';
  end if;
  perform set_config('oksy.audit_reason', coalesce(p_note, 'G9 approval'), true);
  update public.rule_versions
     set status = (case when p_activate then 'ACTIVE' else 'APPROVED' end)::public.rule_status,
         approved_by = v_uid,
         approved_on = now(),
         needs_review = false
   where id = p_rule_version_id;
  insert into public.rule_approvals (rule_version_id, decision, decided_by, note)
  values (p_rule_version_id, case when p_activate then 'ACTIVATED' else 'APPROVED' end, v_uid, p_note);
end;
$$;

create or replace function public.retire_rule_version(
  p_rule_version_id uuid,
  p_note text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not private.has_role('ADMIN', 'APPROVER') then
    raise exception 'Only ADMIN or APPROVER can retire a rule' using errcode = '42501';
  end if;
  perform set_config('oksy.audit_reason', coalesce(p_note, 'Retiring rule'), true);
  update public.rule_versions
     set status = 'RETIRED'::public.rule_status,
         needs_review = false
   where id = p_rule_version_id;
  insert into public.rule_approvals (rule_version_id, decision, decided_by, note)
  values (p_rule_version_id, 'RETIRED', v_uid, p_note);
end;
$$;

grant execute on function public.retire_rule_version(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- 6. Hospital Scheme management RPCs (Add, Edit, Inactive with audit)
-------------------------------------------------------------------------------
create or replace function public.save_hospital_scheme(
  p_hospital_code text,
  p_hospital_name text,
  p_district text,
  p_scheme text,
  p_sheet_url text,
  p_spreadsheet_id text,
  p_status text default 'ACTIVE',
  p_sync text default 'YES'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet_key text := p_hospital_code || '|' || p_scheme;
begin
  if not private.has_role('ADMIN', 'APPROVER', 'HELPER') then
    raise exception 'Only HELPER, APPROVER or ADMIN can edit hospitals' using errcode = '42501';
  end if;

  perform set_config('oksy.audit_reason', 'save_hospital_scheme: ' || v_sheet_key, true);

  insert into public.hospitals (hospital_code, hospital_name, district, status, updated_at)
  values (p_hospital_code, p_hospital_name, p_district, p_status, now())
  on conflict (hospital_code) do update
    set hospital_name = excluded.hospital_name,
        district = coalesce(excluded.district, hospitals.district),
        status = excluded.status,
        updated_at = now();

  insert into public.hospital_sheets (
    sheet_key, hospital_code, scheme, reg_no, sheet_status,
    spreadsheet_id, sheet_url, sync, access_status, updated_at
  )
  values (
    v_sheet_key, p_hospital_code, p_scheme, 999, 'LINKED',
    p_spreadsheet_id, p_sheet_url, p_sync, 'NOT_CHECKED', now()
  )
  on conflict (sheet_key) do update
    set sheet_url = excluded.sheet_url,
        spreadsheet_id = excluded.spreadsheet_id,
        sync = excluded.sync,
        updated_at = now();
end;
$$;
grant execute on function public.save_hospital_scheme(text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.set_hospital_status(
  p_hospital_code text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role('ADMIN', 'APPROVER', 'HELPER') then
    raise exception 'Only HELPER, APPROVER or ADMIN can change hospital status' using errcode = '42501';
  end if;

  perform set_config('oksy.audit_reason', 'set_hospital_status: ' || p_hospital_code || ' -> ' || p_status, true);

  update public.hospitals
     set status = p_status,
         updated_at = now()
   where hospital_code = p_hospital_code;
end;
$$;
grant execute on function public.set_hospital_status(text, text) to authenticated;

-------------------------------------------------------------------------------
-- 7. Rule creation and versioning RPC
-------------------------------------------------------------------------------
create or replace function public.create_or_update_rule(
  p_rule_id text,
  p_rule_type text,
  p_title text,
  p_condition_text text,
  p_severity text default 'W',
  p_tier text default 'C',
  p_action text default null,
  p_status text default 'PROPOSED',
  p_hospital_filter text default null,
  p_scheme_filter text default null,
  p_insurer_filter text default null,
  p_parameter_name text default null,
  p_parameter_value numeric default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_next_version integer;
  v_status public.rule_status := p_status::public.rule_status;
begin
  if not private.has_role('ADMIN', 'APPROVER', 'HELPER', 'USER') then
    raise exception 'Must be logged in to create or edit rules' using errcode = '42501';
  end if;

  if v_status in ('ACTIVE', 'APPROVED') and not private.has_role('ADMIN', 'APPROVER') then
    raise exception 'Only ADMIN or APPROVER can activate a rule (G9)' using errcode = '42501';
  end if;

  perform set_config('oksy.audit_reason', 'create_or_update_rule: ' || p_rule_id, true);

  insert into public.rules (rule_id, rule_type, title, created_by)
  values (p_rule_id, p_rule_type::public.rule_type, p_title, v_uid)
  on conflict (rule_id) do update
    set title = excluded.title;

  select coalesce(max(version), 0) + 1 into v_next_version
    from public.rule_versions
   where rule_id = p_rule_id;

  insert into public.rule_versions (
    rule_id, version, condition_text, severity, tier, action,
    status, hospital_filter, scheme_filter, insurer_filter,
    parameter_name, parameter_value, author,
    approved_by, approved_on
  )
  values (
    p_rule_id, v_next_version, p_condition_text, p_severity::public.rule_severity, p_tier, p_action,
    v_status, p_hospital_filter, p_scheme_filter, p_insurer_filter,
    p_parameter_name, p_parameter_value, v_uid,
    case when v_status in ('ACTIVE', 'APPROVED') then v_uid else null end,
    case when v_status in ('ACTIVE', 'APPROVED') then now() else null end
  );

  return v_next_version;
end;
$$;
grant execute on function public.create_or_update_rule to authenticated;

notify pgrst, 'reload schema';
