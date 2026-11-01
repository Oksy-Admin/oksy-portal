-- Stage 2d: the Rule Library page (stage-plan.md "2d - Rule Library page"). Backup first;
-- apply to live only after Anoop's OK (CLAUDE.md "Schema changes").
--
-- 1. rule_versions: the two scope fields the form needs that are not there yet (date_basis;
--    which day a valid_from/valid_to window is tested on, selection.ts's RuleVersion.dateBasis)
--    and a link back to the upload batch that created a version, for "undo as a group".
-- 2. rule_upload_batches: undo tracking (same shape as dictionary_entry_batches, Stage 2b),
--    plus protect_table (it had none -- baseline migration 20261027000022 comment).
-- 3. rule_test_runs: the "test before save" job (stage-plan 2d: a draft rule runs once, in
--    the worker, against the stored claims of its scope, never inside the page request).
-- 4. save_rule_version(...): one call that creates the next version of a rule (always
--    PROPOSED; activation is still the separate, already-built approve_rule_version/G9
--    step), carrying the save-time conflict result (packages/rules/src/conflict.ts runs the
--    check; this function only requires a reason when conflict_rule_ids is not empty) and
--    the upload batch it belongs to, if any. protect_table's own audit trigger on
--    rule_versions already writes the change log entry -- no separate logging needed here.
-- 5. undo_rule_upload_batch(...): retires every rule_versions row tagged with one upload
--    batch (same Owner/Admin-only, "undo as a group" pattern as undo_dictionary_batch).

-------------------------------------------------------------------------------
-- 1. rule_versions
-------------------------------------------------------------------------------
alter table public.rule_versions
  add column if not exists date_basis text check (date_basis in ('ADMISSION', 'DISCHARGE', 'SETTLEMENT')),
  add column if not exists upload_batch_id uuid references public.rule_upload_batches (id);
comment on column public.rule_versions.date_basis is 'Which claim date a valid_from/valid_to window is tested on (selection.ts); null = DISCHARGE (its own default).';
comment on column public.rule_versions.upload_batch_id is 'Set when this version came from a Rule Library upload (Stage 2d); undo_rule_upload_batch retires every version with the same batch id.';

-------------------------------------------------------------------------------
-- 2. rule_upload_batches: undo tracking + protect_table (it had neither).
-------------------------------------------------------------------------------
alter table public.rule_upload_batches
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by uuid,
  add column if not exists undo_note text;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'no_delete' and tgrelid = 'public.rule_upload_batches'::regclass) then
    perform private.protect_table('public.rule_upload_batches', 'id');
  end if;
end $$;

-------------------------------------------------------------------------------
-- 3. rule_test_runs: "test before save" (never inside the page request -- it would time out
--    at 130 hospitals, same reasoning as the worker's own sheet-run jobs).
-------------------------------------------------------------------------------
create table public.rule_test_runs (
  id           uuid primary key default gen_random_uuid(),
  -- The whole draft (scope + check/parameter definition), not yet a rule_versions row: a
  -- draft can be tested any number of times before it is ever saved.
  draft        jsonb not null,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  status       public.job_status not null default 'QUEUED',
  -- Per hospital: claims hit, and up to 5 {tab, row} references -- never a patient name
  -- or a cell value (hard rules 1, 10; same as rule_trials will be in Stage 2e).
  result       jsonb,
  error        text check (length(error) <= 500)
);
alter table public.rule_test_runs enable row level security;
select private.protect_table('public.rule_test_runs', 'id');
create index rule_test_runs_status on public.rule_test_runs (status, requested_at);

create policy rule_test_runs_read on public.rule_test_runs
  for select to authenticated using ((select private.has_tick('rule_library_view')));
create policy rule_test_runs_insert on public.rule_test_runs
  for insert to authenticated with check ((select private.has_tick('rule_library_add_edit')) and requested_by = (select auth.uid()));
grant select, insert on public.rule_test_runs to authenticated;
-- The worker claims and finishes a run (status/result/timestamps) with the service key, same
-- grant shape as jobs (04_worker_grants.test.sql).
grant select, update on public.rule_test_runs to service_role;

-------------------------------------------------------------------------------
-- 4. save_rule_version: version + conflict result (computed in packages/rules, passed in
--    here) + audit (the existing rule_versions "audit" trigger, protect_table). Always
--    inserts PROPOSED -- "save" is never "activate" (G9 stays a separate, explicit step).
-------------------------------------------------------------------------------
create or replace function public.save_rule_version(
  p_rule_id text,
  p_rule_type text,
  p_title text,
  p_check_definition jsonb default null,
  p_severity text default null,
  p_action text default null,
  p_staff_message text default null,
  p_hospital_filter text default null,
  p_scheme_filter text default null,
  p_insurer_filter text default null,
  p_valid_from date default null,
  p_valid_to date default null,
  p_date_basis text default null,
  p_parameter_name text default null,
  p_parameter_value numeric default null,
  p_conflict_rule_ids text[] default '{}',
  p_conflict_reason text default null,
  p_upload_batch_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_next_version integer;
  v_note text;
begin
  if not private.has_tick('rule_library_add_edit') then
    raise exception 'Only a user with the Rule Library action tick can save a rule' using errcode = '42501';
  end if;
  if p_rule_type not in ('CHECK', 'PARAMETER') then
    raise exception 'rule_type must be CHECK or PARAMETER';
  end if;
  if coalesce(array_length(p_conflict_rule_ids, 1), 0) > 0 and coalesce(trim(p_conflict_reason), '') = '' then
    raise exception 'A reason is required to save over the conflict shown with %', array_to_string(p_conflict_rule_ids, ', ') using errcode = 'P0001';
  end if;

  perform set_config('oksy.audit_reason', 'save_rule_version: ' || p_rule_id, true);

  insert into public.rules (rule_id, rule_type, title, created_by)
  values (p_rule_id, p_rule_type::public.rule_type, p_title, v_uid)
  on conflict (rule_id) do update set title = excluded.title, rule_type = excluded.rule_type;

  select coalesce(max(version), 0) + 1 into v_next_version
    from public.rule_versions where rule_id = p_rule_id;

  v_note := case when coalesce(array_length(p_conflict_rule_ids, 1), 0) > 0
    then format('Conflicts with %s -- %s', array_to_string(p_conflict_rule_ids, ', '), p_conflict_reason)
    else null end;

  insert into public.rule_versions (
    rule_id, version, status, severity, condition_text, check_definition, action, staff_message,
    hospital_filter, scheme_filter, insurer_filter, valid_from, valid_to, date_basis,
    parameter_name, parameter_value, author, approver_note, upload_batch_id
  ) values (
    p_rule_id, v_next_version, 'PROPOSED', p_severity::public.rule_severity, null, p_check_definition, p_action, p_staff_message,
    p_hospital_filter, p_scheme_filter, p_insurer_filter, p_valid_from, p_valid_to, p_date_basis,
    p_parameter_name, p_parameter_value, v_uid, v_note, p_upload_batch_id
  );

  return v_next_version;
end;
$$;
revoke execute on function public.save_rule_version(text, text, text, jsonb, text, text, text, text, text, text, date, date, text, text, numeric, text[], text, uuid) from public, anon;
grant execute on function public.save_rule_version(text, text, text, jsonb, text, text, text, text, text, text, date, date, text, text, numeric, text[], text, uuid) to authenticated;

-------------------------------------------------------------------------------
-- 5. undo_rule_upload_batch: retires every PROPOSED version from one upload (Owner/Admin
--    only, same as undo_dictionary_batch -- a status change on rule_versions is G9 territory
--    regardless, so this mirrors that trigger's own requirement).
-------------------------------------------------------------------------------
create or replace function public.undo_rule_upload_batch(p_batch_id uuid, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.rule_upload_batches;
  v_count integer;
begin
  if not private.has_role('ADMIN') then
    raise exception 'Only Owner or Admin can undo a rule upload' using errcode = '42501';
  end if;
  select * into v_batch from public.rule_upload_batches where id = p_batch_id for update;
  if not found then
    raise exception 'No rule upload with this id' using errcode = 'P0002';
  end if;
  if v_batch.undone_at is not null then
    raise exception 'This upload was already undone' using errcode = '22023';
  end if;

  -- has_role('ADMIN') above already satisfies guard_rule_status's own ('ADMIN','APPROVER')
  -- requirement for a status change, so the trigger needs no disabling here.
  perform set_config('oksy.audit_reason', coalesce(p_note, format('Rule upload %s undone', p_batch_id)), true);
  update public.rule_versions
     set status = 'RETIRED'
   where upload_batch_id = p_batch_id and status in ('PROPOSED', 'DRAFT');
  get diagnostics v_count = row_count;

  update public.rule_upload_batches
     set undone_at = now(), undone_by = auth.uid(), undo_note = p_note
   where id = p_batch_id;
  return v_count;
end;
$$;
revoke execute on function public.undo_rule_upload_batch(uuid, text) from public, anon;
grant execute on function public.undo_rule_upload_batch(uuid, text) to authenticated;
