-- REPO COPY OF A MIGRATION ALREADY LIVE. Do not apply again.
-- Applied to live 27-Oct-2026, recorded as version 20261027072732, name
-- stage1_tick_gaps_hospitals_rules. It had no file in supabase/migrations/; this file is the
-- SQL stored in supabase_migrations.schema_migrations for that version, copied as it is
-- (checked 27-Oct-2026: the live policies and both functions still use these ticks). The file
-- name uses the live version so the local and remote migration history agree.

-- Stage 1 follow-up: hospital write paths and rule proposals use access ticks
-- (hospitals_add_edit / rule_library_add_edit) instead of old role names.
-- OWNER and ADMIN still pass through private.has_tick().

drop policy if exists hospitals_insert on public.hospitals;
create policy hospitals_insert on public.hospitals
  for insert to authenticated
  with check (private.has_tick('hospitals_add_edit'));

drop policy if exists hospitals_update on public.hospitals;
create policy hospitals_update on public.hospitals
  for update to authenticated
  using (private.has_tick('hospitals_add_edit'))
  with check (private.has_tick('hospitals_add_edit'));

drop policy if exists rules_propose on public.rules;
create policy rules_propose on public.rules
  for insert to authenticated
  with check (private.has_tick('rule_library_add_edit'));

drop policy if exists rule_versions_propose on public.rule_versions;
create policy rule_versions_propose on public.rule_versions
  for insert to authenticated
  with check (
    private.has_tick('rule_library_add_edit')
    and status = 'PROPOSED'::public.rule_status
    and approved_by is null
    and approved_on is null
    and author = (select auth.uid())
  );

create or replace function public.save_hospital_scheme(
  p_hospital_code text, p_hospital_name text, p_district text, p_scheme text,
  p_sheet_url text, p_spreadsheet_id text, p_status text default 'ACTIVE', p_sync text default 'YES')
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_sheet_key text := p_hospital_code || '|' || p_scheme;
begin
  if not private.has_tick('hospitals_add_edit') then
    raise exception 'You do not have permission to add or edit hospitals' using errcode = '42501';
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
$function$;

create or replace function public.set_hospital_status(p_hospital_code text, p_status text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not private.has_tick('hospitals_add_edit') then
    raise exception 'You do not have permission to change hospital status' using errcode = '42501';
  end if;

  perform set_config('oksy.audit_reason', 'set_hospital_status: ' || p_hospital_code || ' -> ' || p_status, true);

  update public.hospitals
     set status = p_status,
         updated_at = now()
   where hospital_code = p_hospital_code;
end;
$function$;
