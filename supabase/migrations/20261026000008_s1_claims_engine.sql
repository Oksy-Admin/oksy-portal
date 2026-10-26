-- S1 walking skeleton (file 04 section 4, wave 1): jobs, snapshots, column mappings,
-- claims_staging, payments, record_keys, change_log, issues, reconciliations, export_runs.
-- File 01 sections 4 to 7 (fields, stages, payments, money), file 02 sections 3 to 5,
-- file 03 sections 3 to 5, D-047, D-049, D-050, D-061, D-065. CLAUDE.md hard rules 5 to 10, 13.
-- DRAFT for Anoop's OK. Applied by Anoop with `supabase db push --linked`.
-- Patient data sits in claims_staging, payments, snapshots and change_log: ADMIN and
-- APPROVER only (hard rule 10). Money is numeric (exact decimal); source amounts are
-- stored without a scale so they are never rounded (hard rule 7).

-------------------------------------------------------------------------------
-- 0. The pilot sheet row (register v4, SHEET_REGISTRY REG NO 88, SYNC = YES, checked
--    24-Oct). The register import (G11) keeps and updates this row; it is here so the
--    S1 job can check SYNC before any read (hard rule 4) before the full import runs.
-------------------------------------------------------------------------------
insert into public.hospital_sheets (sheet_key, hospital_code, scheme, reg_no, sheet_status, spreadsheet_id, sheet_url, sync)
values ('HOSP32P000107|PRIVATE', 'HOSP32P000107', 'PRIVATE', 88, 'LINKED',
        '1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ',
        'https://docs.google.com/spreadsheets/d/1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ/edit', 'YES')
on conflict (sheet_key) do nothing;

-------------------------------------------------------------------------------
-- 1. Jobs (D-049, D-065): one background job per sheet. A web request only inserts a
--    QUEUED job through request_sheet_run(); the free runner (packages/worker) runs it.
-------------------------------------------------------------------------------
create type public.job_status as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'STOPPED');

create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'SHEET_RUN' check (kind in ('SHEET_RUN')),
  sheet_key     text not null references public.hospital_sheets (sheet_key),
  mode          text not null default 'WRITE' check (mode in ('WRITE', 'DRY_RUN')),
  status        public.job_status not null default 'QUEUED',
  requested_by  uuid default auth.uid(),
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  attempts      integer not null default 0 check (attempts between 0 and 5),
  -- Counts, timings and rule IDs only: never patient data (hard rule 10).
  summary       jsonb,
  error         text check (length(error) <= 500)
);
alter table public.jobs enable row level security;
select private.protect_table('public.jobs', 'id');
create unique index jobs_one_active_per_sheet on public.jobs (sheet_key) where status in ('QUEUED', 'RUNNING');
create index jobs_status on public.jobs (status, requested_at);

-- "Run now": only checks and queues; never reads Google inside the web request.
create function public.request_sheet_run(p_sheet_key text, p_mode text default 'WRITE')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_sheet public.hospital_sheets;
  v_id    uuid;
begin
  if not private.has_role('ADMIN', 'APPROVER') then
    raise exception 'Only ADMIN or APPROVER can start a sheet run' using errcode = '42501';
  end if;
  select * into v_sheet from public.hospital_sheets where sheet_key = p_sheet_key;
  if not found then
    raise exception 'Unknown sheet' using errcode = 'P0002';
  end if;
  if v_sheet.sync <> 'YES' or v_sheet.read_skip_reason is not null or v_sheet.missing_from_register_since is not null then
    raise exception 'This sheet is never read (SYNC %, or read under another hospital)', v_sheet.sync using errcode = '42501';
  end if;
  if exists (select 1 from public.jobs where sheet_key = p_sheet_key and status in ('QUEUED', 'RUNNING')) then
    raise exception 'A run for this sheet is already queued or running' using errcode = '23505';
  end if;
  perform set_config('oksy.audit_reason', 'Run now', true);
  insert into public.jobs (sheet_key, mode) values (p_sheet_key, p_mode) returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.request_sheet_run(text, text) from public, anon;
grant execute on function public.request_sheet_run(text, text) to authenticated;

-------------------------------------------------------------------------------
-- 2. Snapshots: the raw read of a sheet (values and background colour, ALLOW tabs only),
--    timestamped and never edited (file 03 section 4.1). Kept in the table for S1; moves
--    to Storage when snapshots grow (file 04 section 6, database).
-------------------------------------------------------------------------------
create table public.snapshots (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id),
  hospital_code  text not null references public.hospitals (hospital_code),
  sheet_key      text not null references public.hospital_sheets (sheet_key),
  spreadsheet_id text not null,
  taken_at       timestamptz not null default now(),
  tabs           jsonb not null,             -- per tab: name, rows, header fingerprint (no cell values)
  raw            jsonb not null,             -- cell values and colours: patient data
  raw_sha256     text not null check (raw_sha256 ~ '^[0-9a-f]{64}$')
);
alter table public.snapshots enable row level security;
create index snapshots_sheet on public.snapshots (sheet_key, taken_at desc);
create trigger snapshots_no_update before update on public.snapshots
  for each row execute function private.forbid_log_change();
create trigger snapshots_no_delete before delete on public.snapshots
  for each row execute function private.forbid_log_change();
create trigger snapshots_no_truncate before truncate on public.snapshots
  for each statement execute function private.forbid_log_change();

-------------------------------------------------------------------------------
-- 3. Column mappings (file 03 section 3): per hospital sheet and tab, source header ->
--    canonical field. canonical_field NULL = goes to extra_fields (never dropped).
-------------------------------------------------------------------------------
create table public.column_mappings (
  id              uuid primary key default gen_random_uuid(),
  hospital_code   text not null references public.hospitals (hospital_code),
  spreadsheet_id  text not null,
  tab_name        text not null,
  version_group   text not null default 'VG-1',
  header_fp       text not null,             -- fingerprint of the ordered normalised headers
  source_header   text not null,
  source_column   integer not null check (source_column >= 0),
  canonical_field text,
  confidence      numeric not null check (confidence between 0 and 1),
  method          text not null check (method in ('ALIAS', 'PILOT', 'MANUAL', 'DUPLICATE_HEADER', 'UNMATCHED')),
  status          text not null default 'PROPOSED' check (status in ('PROPOSED', 'APPROVED', 'RETIRED')),
  approved_by     uuid,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (spreadsheet_id, tab_name, header_fp, source_column)
);
alter table public.column_mappings enable row level security;
select private.protect_table('public.column_mappings', 'id');

-------------------------------------------------------------------------------
-- 4. Claims (file 01 section 4). One row = one claim. Unknown = NULL with a reason in
--    null_reasons; missing is never zero (hard rule 6).
-------------------------------------------------------------------------------
create type public.claim_stage as enum (
  'UNDER_TREATMENT', 'UNDER_PROCESSING', 'APPROVED', 'SETTLED', 'REJECTED', 'CANCELLED', 'UNKNOWN');
create type public.row_class as enum ('CLEAN', 'AUTO_FIXED', 'NEEDS_STAFF_INPUT', 'REJECTED', 'NON_DATA_ROW');

create table public.claims_staging (
  record_uid            uuid primary key default gen_random_uuid(),
  record_key            text not null unique,
  alias_keys            text[] not null default '{}',
  hospital_code         text not null references public.hospitals (hospital_code),
  hospital_name         text not null default '',   -- filled from hospitals by trigger
  scheme                text not null,
  insurer_name          text,
  tpa_name              text,
  -- Patient and case
  patient_name          text,
  patient_ip_no         text,
  policy_or_card_no     text,
  preauth_or_claim_no   text,
  admission_date        date,
  discharge_date        date,
  treatment_or_surgery  text,
  department            text,
  doctor_name           text,
  room_no               text,
  -- Amounts as entered (never altered)
  bill_amount           numeric,
  claimed_amount        numeric,
  approved_amount       numeric,
  copay_amount          numeric,
  deduction_amount      numeric,
  -- Status and settlement (settled_amount, settlement_date, utr_no come from payments)
  casesheet_sent_date   date,
  followup_log          text,
  claim_status          public.claim_stage not null default 'UNKNOWN',
  status_source         text not null default 'unknown'
                          check (status_source in ('column', 'colour', 'remarks', 'scheme_portal', 'tab', 'answer', 'unknown')),
  rejection_reason      text,
  cancellation_reason   text,
  settled_amount        numeric,
  settlement_date       date,
  utr_no                text[] not null default '{}',
  remarks               text,
  extra_fields          jsonb not null default '{}',
  -- Computed by code only
  los_days              integer,
  date_swap_applied     boolean not null default false,
  tds_rate_used         numeric,
  tds_rate_source       text check (tds_rate_source in ('DEFAULT', 'RULE', 'CONFIRMED')),
  tds_rule_id           text,
  gross_amount          numeric,
  tds_amount            numeric,
  discount_1_amount     numeric,
  discount_1_pct        numeric,
  discount_2_amount     numeric,
  discount_2_pct        numeric,
  discount_2_confirmed  boolean,
  tds_path              text check (tds_path in ('TDS_ON_PAID', 'TDS_ON_APPROVED', 'NEITHER')),
  discount_2_resolution text check (discount_2_resolution in ('OPEN', 'ELIGIBLE', 'NOT_ELIGIBLE', 'NOT_APPLICABLE')),
  overdue_flag          boolean,
  pending_days          integer,
  aging_bucket          text check (aging_bucket in ('61-90', '91-180', '180+')),
  null_reasons          jsonb not null default '{}',   -- field -> reason code (INPUT_MISSING, NOT_RECORDED_IN_SOURCE, ...)
  flags                 text[] not null default '{}',  -- COPAY_INCLUDES_DISCOUNT1, AMOUNT_SPLIT_UNKNOWN, copied_from_approved, ...
  -- Trace and quality
  source_file           text not null,
  source_tab            text not null,
  source_row            integer not null check (source_row >= 1),
  version_group         text,
  row_class             public.row_class not null,
  issue_codes           text[] not null default '{}',
  not_recorded_fields   text[] not null default '{}',
  -- Sync
  content_hash          text not null,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  last_changed_at       timestamptz not null default now(),
  missing_since         timestamptz,
  sync_status           text not null default 'NEW' check (sync_status in ('NEW', 'CHANGED', 'UNCHANGED', 'MISSING')),
  last_job_id           uuid references public.jobs (id),
  portal_record_id      text
);
alter table public.claims_staging enable row level security;
create trigger claims_no_delete before delete on public.claims_staging
  for each row execute function private.forbid_delete();
create trigger claims_no_truncate before truncate on public.claims_staging
  for each statement execute function private.forbid_delete();
-- Indexes from day one (file 04 section 4).
create index claims_hospital_scheme on public.claims_staging (hospital_code, scheme);
create index claims_row_class on public.claims_staging (row_class);
create index claims_status on public.claims_staging (claim_status);
create index claims_last_changed on public.claims_staging (last_changed_at);
create index claims_admission on public.claims_staging (hospital_code, admission_date desc);

-- The hospital name comes from the Hospital Master, not from the worker (the worker has no
-- right to read hospitals, migration 0004 test).
create function private.claims_fill_hospital_name()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  select h.hospital_name into new.hospital_name from public.hospitals h where h.hospital_code = new.hospital_code;
  return new;
end;
$$;
revoke execute on function private.claims_fill_hospital_name() from public, anon, authenticated;
create trigger claims_fill_hospital_name before insert or update of hospital_code on public.claims_staging
  for each row execute function private.claims_fill_hospital_name();

-- Record keys (file 03 section 5): primary key (claim no) and fallback key (name + DOA).
create table public.record_keys (
  record_key    text primary key,
  record_uid    uuid not null references public.claims_staging (record_uid),
  key_type      text not null check (key_type in ('CLAIM_NO', 'FALLBACK')),
  hospital_code text not null references public.hospitals (hospital_code),
  scheme        text not null,
  created_at    timestamptz not null default now()
);
alter table public.record_keys enable row level security;
create index record_keys_uid on public.record_keys (record_uid);
create trigger record_keys_no_delete before delete on public.record_keys
  for each row execute function private.forbid_delete();

-------------------------------------------------------------------------------
-- 5. Payments (file 01 section 6, D-047). A bank reference and UTR pair is ONE payment.
--    Interim: one source row with one settled amount and several UTRs = ONE payment with
--    flag AMOUNT_SPLIT_UNKNOWN; amounts are never split by guessing (hard rule 6).
-------------------------------------------------------------------------------
create table public.payments (
  payment_id        uuid primary key default gen_random_uuid(),
  record_uid        uuid not null references public.claims_staging (record_uid),
  record_key        text not null,
  payment_no        integer not null check (payment_no >= 1),
  hospital_code     text not null references public.hospitals (hospital_code),
  payment_date      date,
  utr_no            text[] not null default '{}',
  bank_reference    text,
  amount_received   numeric,
  tds_amount_stated numeric,
  flags             text[] not null default '{}',
  source_file       text not null,
  source_tab        text not null,
  source_row        integer not null check (source_row >= 1),
  content_hash      text not null,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  missing_since     timestamptz,
  unique (record_uid, payment_no)
);
alter table public.payments enable row level security;
create trigger payments_no_delete before delete on public.payments
  for each row execute function private.forbid_delete();
create trigger payments_no_truncate before truncate on public.payments
  for each statement execute function private.forbid_delete();
create index payments_record_key on public.payments (record_key);

-------------------------------------------------------------------------------
-- 6. Change log (field level, file 01 "change_log"), issues and reconciliations.
-------------------------------------------------------------------------------
create table public.change_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  record_uid   uuid not null references public.claims_staging (record_uid),
  field        text not null,
  old_value    text,
  new_value    text,
  rule_id      text,
  rule_version integer,
  tier         text check (tier in ('A', 'B', 'C', 'D')),
  actor        text not null default 'ENGINE',
  job_id       uuid references public.jobs (id)
);
alter table public.change_log enable row level security;
create index change_log_record on public.change_log (record_uid, at);
create trigger change_log_no_update before update on public.change_log
  for each row execute function private.forbid_log_change();
create trigger change_log_no_delete before delete on public.change_log
  for each row execute function private.forbid_log_change();

create table public.issues (
  id            uuid primary key default gen_random_uuid(),
  record_uid    uuid not null references public.claims_staging (record_uid),
  hospital_code text not null references public.hospitals (hospital_code),
  rule_id       text not null,
  rule_version  integer,
  severity      text not null check (severity in ('E', 'W', 'I')),
  tier          text check (tier in ('A', 'B', 'C', 'D')),
  shadow        boolean not null default false,   -- PROPOSED rule: recorded only (D-043, D-066)
  field         text not null default '',
  detail        text check (length(detail) <= 300), -- rule wording only, never patient data
  status        text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  first_job_id  uuid references public.jobs (id),
  last_job_id   uuid references public.jobs (id),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (record_uid, rule_id, field)
);
alter table public.issues enable row level security;
create trigger issues_no_delete before delete on public.issues
  for each row execute function private.forbid_delete();
create index issues_hospital_rule on public.issues (hospital_code, rule_id);

create table public.reconciliations (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id),
  snapshot_id    uuid references public.snapshots (id),
  hospital_code  text not null references public.hospitals (hospital_code),
  sheet_key      text not null,
  created_at     timestamptz not null default now(),
  counts         jsonb not null,   -- rows per class, per tab
  sums           jsonb not null,   -- bill, claimed, approved, copay, settled: source vs cleaned
  differences    jsonb not null,   -- each difference with its explanation (no patient data)
  result         text not null check (result in ('PASS', 'FAIL'))
);
alter table public.reconciliations enable row level security;
select private.protect_table('public.reconciliations', 'id');

-------------------------------------------------------------------------------
-- 7. Export log (hard rule 10: every export is logged). Written by the portal under the
--    user's login before the file is streamed.
-------------------------------------------------------------------------------
create table public.export_runs (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  exported_by  uuid not null default auth.uid(),
  format       text not null check (format in ('CSV', 'XLSX')),
  filters      jsonb not null default '{}',
  row_count    integer not null check (row_count >= 0),
  totals       jsonb not null default '{}'
);
alter table public.export_runs enable row level security;
select private.protect_table('public.export_runs', 'id');

-------------------------------------------------------------------------------
-- 8. Policies and grants. Cleaned data, payments, snapshots, change log, issues,
--    reconciliations and exports: ADMIN and APPROVER only (hard rule 10). Jobs and
--    mappings: also HELPER (helper work). Nobody writes these from the portal except
--    through request_sheet_run and the export log.
-------------------------------------------------------------------------------
create policy claims_read on public.claims_staging for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER')));
create policy payments_read on public.payments for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER')));
create policy record_keys_read on public.record_keys for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER')));
create policy snapshots_read on public.snapshots for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER')));
create policy change_log_read on public.change_log for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER')));
create policy issues_read on public.issues for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER')));
create policy reconciliations_read on public.reconciliations for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER')));
create policy export_runs_read on public.export_runs for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER')));
create policy export_runs_insert on public.export_runs for insert to authenticated
  with check ((select private.has_role('ADMIN', 'APPROVER')) and exported_by = (select auth.uid()));
create policy jobs_read on public.jobs for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy column_mappings_read on public.column_mappings for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));

grant select on public.claims_staging, public.payments, public.record_keys, public.snapshots,
                public.change_log, public.issues, public.reconciliations, public.export_runs,
                public.jobs, public.column_mappings to authenticated;
grant insert (format, filters, row_count, totals) on public.export_runs to authenticated;

-- Worker (least privilege, as 0004). No delete anywhere (hard rule 5).
grant select, update (status, started_at, finished_at, attempts, summary, error) on public.jobs to service_role;
grant select, insert on public.snapshots to service_role;
grant select, insert on public.column_mappings to service_role;
grant select, insert, update on public.claims_staging to service_role;
grant select, insert on public.record_keys to service_role;
grant select, insert, update on public.payments to service_role;
grant select, insert on public.change_log to service_role;
grant select, insert, update on public.issues to service_role;
grant select, insert on public.reconciliations to service_role;

-- Reload the API's table list so the new tables are usable at once (no manual SQL editor step).
notify pgrst, 'reload schema';
