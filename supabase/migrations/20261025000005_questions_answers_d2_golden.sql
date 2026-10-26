-- Phase 0b (HMS staff answers): questions, answers, Discount 2 decisions, Golden Tests,
-- and the first PROPOSED hospital rules. File 06 (never ask twice, every question kept,
-- D-045), file 04 sections 3 and 11, D-061 (Discount 2 ELIGIBLE / NOT_ELIGIBLE, CO-PAY
-- formula). CLAUDE.md hard rules 5, 6, 8, 9, 10.
-- DRAFT for Anoop's OK. Applied by Anoop with `supabase db push --linked`.
-- Patient data (names, claim no) may sit in these tables: read by role only, never in git.

-------------------------------------------------------------------------------
-- 0. The pilot hospital (register v4, SHEET_REGISTRY REG NO 88). M4 imports the rest
--    and keeps this row. Needed because hospital rules reference hospitals.
-------------------------------------------------------------------------------
insert into public.hospitals (hospital_code, hospital_name, status)
values ('HOSP32P000107', 'Hearts Malabar Clinical Solutions Hospital, Kottakkal', 'ACTIVE')
on conflict (hospital_code) do nothing;

-------------------------------------------------------------------------------
-- 1. Questions: one row per question ever asked, kept forever (D-045).
-------------------------------------------------------------------------------
create type public.question_type as enum ('C', 'N', 'R', 'M', 'S', 'U', 'A', 'D', 'P', 'E');
-- E = Discount 2 eligibility (D-061). The others: file 06 section 2.
create type public.question_status as enum (
  'QUEUED', 'SHOWN', 'ANSWERED', 'CLOSED', 'CANNOT_FIND', 'CONFLICT', 'RETURN_TO_HOSPITAL');

create table public.questions (
  id                 uuid primary key default gen_random_uuid(),
  q_code             text not null unique,               -- for example U-0042, or P0-T5-012 for the pilot
  hospital_code      text not null references public.hospitals (hospital_code),
  question_type      public.question_type not null,
  status             public.question_status not null default 'QUEUED',
  origin             text not null check (origin in ('PILOT_2026_10', 'DAILY')),
  -- Where the question points in the hospital claim sheet (row reference, file 06).
  spreadsheet_id     text check (spreadsheet_id ~ '^[A-Za-z0-9_-]{20,}$'),
  tab_name           text,
  row_number         integer check (row_number >= 1),
  record_key         text,
  field_name         text,
  scope              text not null default 'ROW' check (scope in ('ROW', 'TAB', 'HOSPITAL')),
  question_text      text not null,
  -- Where it was asked (pilot workbook or Question Sheet): never asked again (file 06 item 12).
  source_file_id     text,
  source_tab         text,
  source_question_no text,
  created_at         timestamptz not null default now(),
  closed_at          timestamptz,
  closed_reason      text,
  unique (source_file_id, source_tab, source_question_no)
);
alter table public.questions enable row level security;
select private.protect_table('public.questions', 'id');

-------------------------------------------------------------------------------
-- 2. Answers: every answer as received, append-only (never changed, never deleted).
-------------------------------------------------------------------------------
create type public.answer_outcome as enum (
  'CONFIRMED', 'FIXED_AT_SOURCE', 'VALUE_GIVEN', 'CANNOT_FIND', 'CONFLICT', 'UNCLEAR');

create table public.answers (
  id               uuid primary key default gen_random_uuid(),
  question_id      uuid not null references public.questions (id),
  channel          text not null check (channel in ('PILOT_WORKBOOK', 'QUESTION_SHEET', 'MESSAGE')),
  answer_value     text,                                 -- the dropdown choice as typed by staff
  typed_value      text,                                 -- only for NOT_RECORDED_IN_SOURCE fields
  note             text,
  answered_by_name text,
  answered_on      date,
  outcome          public.answer_outcome not null,
  -- Source of this answer (file, tab, question no, row) so it is never re-asked.
  source_file_id   text not null,
  source_tab       text not null,
  source_row       integer not null check (source_row >= 1),
  read_at          timestamptz not null default now(),
  recorded_by      uuid default auth.uid()
);
alter table public.answers enable row level security;
create index answers_question on public.answers (question_id);
create trigger answers_no_update before update on public.answers
  for each row execute function private.forbid_log_change();
create trigger answers_no_delete before delete on public.answers
  for each row execute function private.forbid_log_change();
create trigger answers_no_truncate before truncate on public.answers
  for each statement execute function private.forbid_log_change();
create trigger audit after insert on public.answers
  for each row execute function private.audit_row('id');

-------------------------------------------------------------------------------
-- 3. Discount 2 decisions (G12, D-061). Staff answer -> PROPOSED; an approver confirms.
-------------------------------------------------------------------------------
create type public.d2_decision as enum ('ELIGIBLE', 'NOT_ELIGIBLE');
create type public.d2_status as enum ('PROPOSED', 'CONFIRMED', 'REJECTED', 'REOPENED');

create table public.discount2_decisions (
  id                uuid primary key default gen_random_uuid(),
  hospital_code     text not null references public.hospitals (hospital_code),
  spreadsheet_id    text not null,
  tab_name          text not null,
  row_number        integer not null check (row_number >= 1),
  record_key        text,
  discount_2_amount numeric(14, 2) check (discount_2_amount > 0),
  decision          public.d2_decision not null,
  status            public.d2_status not null default 'PROPOSED',
  reason            text not null,
  answer_id         uuid references public.answers (id),
  proposed_by       uuid default auth.uid(),
  proposed_at       timestamptz not null default now(),
  confirmed_by      uuid,
  confirmed_at      timestamptz,
  constraint d2_confirmed_has_approver
    check (status not in ('CONFIRMED', 'REJECTED') or (confirmed_by is not null and confirmed_at is not null))
);
alter table public.discount2_decisions enable row level security;
select private.protect_table('public.discount2_decisions', 'id');
create unique index d2_one_open_per_row on public.discount2_decisions (spreadsheet_id, tab_name, row_number)
  where status in ('PROPOSED', 'CONFIRMED');

-- Defence in depth (hard rule 8): only ADMIN or APPROVER may confirm or reject, also
-- through the worker key; new rows always start PROPOSED.
create function private.guard_d2_status()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'PROPOSED' or new.confirmed_by is not null then
      raise exception 'A Discount 2 decision must start as PROPOSED' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status or new.confirmed_by is distinct from old.confirmed_by then
    if not private.has_role('ADMIN', 'APPROVER') then
      raise exception 'Only ADMIN or APPROVER can confirm a Discount 2 decision (G12)' using errcode = '42501';
    end if;
    if new.status in ('CONFIRMED', 'REJECTED') and new.confirmed_by is distinct from auth.uid() then
      raise exception 'confirmed_by must be the approving user' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_d2_status before insert or update on public.discount2_decisions
  for each row execute function private.guard_d2_status();

create function public.confirm_discount2_decision(p_id uuid, p_confirm boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not private.has_role('ADMIN', 'APPROVER') then
    raise exception 'Only ADMIN or APPROVER can confirm a Discount 2 decision (G12)' using errcode = '42501';
  end if;
  perform set_config('oksy.audit_reason', coalesce(p_note, case when p_confirm then 'G12 confirmed' else 'G12 rejected' end), true);
  update public.discount2_decisions
     set status = (case when p_confirm then 'CONFIRMED' else 'REJECTED' end)::public.d2_status,
         confirmed_by = v_uid, confirmed_at = now()
   where id = p_id and status = 'PROPOSED';
  if not found then
    raise exception 'No PROPOSED Discount 2 decision with that id' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.confirm_discount2_decision(uuid, boolean, text) from public, anon;
grant execute on function public.confirm_discount2_decision(uuid, boolean, text) to authenticated;

-------------------------------------------------------------------------------
-- 4. Golden Test Set (file 04 section 11): expected outputs confirmed by staff or an
--    approver, never invented. Raw input may hold patient data: ADMIN and APPROVER only.
-------------------------------------------------------------------------------
create table public.golden_tests (
  id                 uuid primary key default gen_random_uuid(),
  golden_set         text not null,                      -- 'v1'
  case_code          text not null,                      -- for example GT1-CP-003 (no names)
  hospital_code      text not null references public.hospitals (hospital_code),
  spreadsheet_id     text not null,
  tab_name           text not null,
  row_number         integer not null check (row_number >= 1),
  raw_input          jsonb not null,
  expected           jsonb not null,
  expected_rule_hits text[] not null default '{}',
  confirmed_from     text not null check (confirmed_from in ('STAFF_ANSWER', 'APPROVER')),
  answer_id          uuid references public.answers (id),
  status             text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  created_at         timestamptz not null default now(),
  unique (golden_set, case_code)
);
alter table public.golden_tests enable row level security;
select private.protect_table('public.golden_tests', 'id');

-------------------------------------------------------------------------------
-- 5. Policies and rights. Question work is HELPER work (file 06); Golden Tests and the
--    G12 confirmation are ADMIN and APPROVER. The worker writes questions and answers.
-------------------------------------------------------------------------------
create policy questions_read on public.questions for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy answers_read on public.answers for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy d2_read on public.discount2_decisions for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')));
create policy d2_propose on public.discount2_decisions for insert to authenticated
  with check ((select private.has_role('ADMIN', 'APPROVER', 'HELPER')) and status = 'PROPOSED');
create policy golden_read on public.golden_tests for select to authenticated
  using ((select private.has_role('ADMIN', 'APPROVER')));
grant select on public.questions, public.answers, public.golden_tests to authenticated;
grant select, insert on public.discount2_decisions to authenticated;

-- Worker (least privilege, as 0004): questions select/insert/update (status, closed_at),
-- answers select/insert only, Discount 2 proposals select/insert, Golden Tests insert/select.
grant select, insert, update on public.questions to service_role;
grant select, insert on public.answers to service_role;
grant select, insert on public.discount2_decisions to service_role;
grant select, insert on public.golden_tests to service_role;

revoke execute on function private.guard_d2_status() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 6. PROPOSED rules from the HMS pilot answers (none ACTIVE; shadow mode only, D-043).
--    No patient names: rows are referred to by tab and row only.
-------------------------------------------------------------------------------
insert into public.rules (rule_id, rule_type, title) values
  ('R-H01', 'PARAMETER', 'HMS CO-PAY formula cell holds copay and Discount 1 combined (D-061)'),
  ('R-H02', 'PARAMETER', 'Star Health 2% settlement discount at HMS'),
  ('R-H03', 'PARAMETER', 'ICICI Lombard 2% settlement discount at HMS');

insert into public.rule_versions
  (rule_id, version, hospital_filter, scheme_filter, insurer_filter, valid_from, valid_to,
   condition_text, code_ref, parameter_name, parameter_value, severity, auto_fix_allowed, tier,
   action, status, first_seen_hospital, first_seen_date)
values
  ('R-H01', 1, 'HOSP32P000107', 'PRIVATE', null, null, null,
   'CO-PAY cell is a formula Bill - Approved: store the value as copay_amount with flag COPAY_INCLUDES_DISCOUNT1; Discount 1 shown as included in copay. Split only when REMARK gives an explicit discount amount (Discount 1 = that amount, copay = cell - amount).',
   'packages/rules: copayFormulaHms (M5)', 'copay_includes_discount1', 1, 'I', true, 'B',
   'Set flag; split only from an explicit REMARK amount', 'PROPOSED', 'HOSP32P000107', '2026-10-23'),
  ('R-H02', 1, 'HOSP32P000107', 'PRIVATE', 'Star Health and Allied Insurance Co. Ltd.', '2026-07-07', null,
   'Expected Discount 2 = 2% of approved (paid = approved x 0.98 x 0.90). Pilot window 07-Jul to 28-Sep-2026; end left open (extend) until the OCTOBER 2026 rows are checked, then an approver sets valid_to.',
   'R-A10 expected discount percent', 'expected_discount_2_pct', 2, 'W', false, 'B',
   'Warn when Discount 2 differs from 2% by more than INR 2 (R-A10)', 'PROPOSED', 'HOSP32P000107', '2026-10-23'),
  ('R-H03', 1, 'HOSP32P000107', 'PRIVATE', 'ICICI Lombard General Insurance Co. Ltd.', null, null,
   'Expected Discount 2 = 2% of approved, from a staff answer in the pilot (one PAID row). Date window to be set from that row''s settlement date before approval.',
   'R-A10 expected discount percent', 'expected_discount_2_pct', 2, 'W', false, 'B',
   'Warn when Discount 2 differs from 2% by more than INR 2 (R-A10)', 'PROPOSED', 'HOSP32P000107', '2026-10-25');
