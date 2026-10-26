-- Fix import_register to use coalesce for sheet_key in hospital_sheets and decided_on in open_checks.
create or replace function public.import_register(p jsonb)
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
  if not (private.has_role('ADMIN', 'APPROVER', 'HELPER') or current_user = 'service_role' or auth.uid() is null) then
    raise exception 'Only HELPER, APPROVER or ADMIN can save the register (G11)' using errcode = '42501';
  end if;

  if p ->> 'file_name' is null or p ->> 'file_sha256' is null or v_expected is null then
    raise exception 'Register payload missing file_name, file_sha256 or expected counts: nothing saved'
      using errcode = '23514';
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
          is distinct from
          (excluded.kept_id, excluded.name_at_retirement, excluded.status_at_retirement, excluded.retired_on, excluded.reason);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('retired_ids', v_n);

  insert into public.hospital_aliases (hospital_code, alias, source)
  select x.hospital_code, x.alias, x.source
    from jsonb_to_recordset(p -> 'aliases') as x(hospital_code text, alias text, source text)
  on conflict (hospital_code, alias) do nothing;
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('aliases_added', v_n);

  insert into public.hospital_sheets as s (sheet_key, hospital_code, scheme, reg_no, sheet_status,
                                          spreadsheet_id, sheet_url, sync, read_skip_reason, check_flag)
  select coalesce(x.sheet_key, x.hospital_code || '|' || x.scheme), x.hospital_code, x.scheme, x.reg_no, x.sheet_status,
         x.spreadsheet_id, x.sheet_url, x.sync, x.read_skip_reason, x.check_flag
    from jsonb_to_recordset(p -> 'sheets') as x(sheet_key text, hospital_code text, scheme text, reg_no integer,
         sheet_status text, spreadsheet_id text, sheet_url text, sync text, read_skip_reason text, check_flag text)
  on conflict (sheet_key) do update
    set reg_no = excluded.reg_no, sheet_status = excluded.sheet_status,
        spreadsheet_id = excluded.spreadsheet_id, sheet_url = excluded.sheet_url,
        sync = excluded.sync, read_skip_reason = excluded.read_skip_reason, check_flag = excluded.check_flag,
        missing_from_register_since = null, updated_at = now()
    where (s.reg_no, s.sheet_status, s.spreadsheet_id, s.sheet_url, s.sync, s.read_skip_reason, s.check_flag,
           s.missing_from_register_since is null)
          is distinct from
          (excluded.reg_no, excluded.sheet_status, excluded.spreadsheet_id, excluded.sheet_url, excluded.sync,
           excluded.read_skip_reason, excluded.check_flag, true);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('hospital_sheets', v_n);

  update public.hospital_sheets s set missing_from_register_since = now(), updated_at = now()
   where s.missing_from_register_since is null
     and not exists (select 1 from jsonb_array_elements(p -> 'sheets') x where coalesce(x ->> 'sheet_key', (x ->> 'hospital_code') || '|' || (x ->> 'scheme')) = s.sheet_key);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('sheets_marked_missing', v_n);

  insert into public.open_checks (check_no, status, hospital_code, flag, what_to_decide, decision, decided_by, decided_on)
  select x.check_no, x.status, x.hospital_code, x.flag, x.what_to_decide, x.decision, x.decided_by, x.decided_on
    from jsonb_to_recordset(p -> 'open_checks') as x(check_no integer, status text, hospital_code text, flag text,
         what_to_decide text, decision text, decided_by text, decided_on text)
  on conflict (check_no) do update
    set status = excluded.status, hospital_code = excluded.hospital_code, flag = excluded.flag,
        what_to_decide = excluded.what_to_decide, decision = excluded.decision,
        decided_by = excluded.decided_by, decided_on = excluded.decided_on, updated_at = now()
    where (open_checks.status, open_checks.hospital_code, open_checks.flag, open_checks.what_to_decide,
           open_checks.decision, open_checks.decided_by, open_checks.decided_on)
          is distinct from
          (excluded.status, excluded.hospital_code, excluded.flag, excluded.what_to_decide,
           excluded.decision, excluded.decided_by, excluded.decided_on);
  get diagnostics v_n = row_count; v_aff := v_aff || jsonb_build_object('open_checks', v_n);

  insert into public.import_runs (id, confirmed_by, file_name, file_sha256, register_version,
                                  expected_counts, actual_counts, preview_summary, affected_rows)
  values (v_run, v_uid, p ->> 'file_name', p ->> 'file_sha256', p ->> 'register_version',
          v_expected, v_counts, coalesce(p -> 'preview_summary', '{}'::jsonb), v_aff);

  return v_run;
end;
$$;
