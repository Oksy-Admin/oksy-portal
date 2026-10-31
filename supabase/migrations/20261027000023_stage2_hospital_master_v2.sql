-- Stage 2: Hospital Master enhancements for v2 requirements
-- 1. RLS policies on hospital_id_history, report_downloads, rule_upload_batches
--    Decision confirmed by Anoop: Authenticated can read; Owner and Admin can insert/manage.
-- 2. Relax hospital_code format constraint to allow v2 IDs (e.g. HOSPPVTP0001).
-- 3. Add other_names (text[]) and question_sheet_url (text) to hospitals.
-- 4. Guard against missing retired_ids table in private.guard_retired_id().
-- 5. Foreign keys cascade ON UPDATE on hospital_code.
-- 6. Helper function update_hospital_profile() to update ID, names, status, and track history.

-------------------------------------------------------------------------------
-- 1. RLS policies and grants for Stage 2 tables
-------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospital_id_history,
                                      public.report_downloads,
                                      public.rule_upload_batches TO authenticated;

-- Policies for hospital_id_history, report_downloads, rule_upload_batches are NOT
-- defined here. They are tick-based and live from migration 20261027000024.
-- Role-only policies were removed on 27-Oct-2026 (Anoop's decision: tick-based access).
-- (31-Oct: two left-over lines of a removed policy deleted here; they broke a fresh replay.)

-------------------------------------------------------------------------------
-- 2. Columns on public.hospitals
-------------------------------------------------------------------------------
ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS other_names text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS question_sheet_url text;

-------------------------------------------------------------------------------
-- 3. Relax hospital_code format check constraint (v2 format HOSPPVTP####)
-------------------------------------------------------------------------------
ALTER TABLE public.hospitals DROP CONSTRAINT IF EXISTS hospitals_hospital_code_check;
ALTER TABLE public.hospitals ADD CONSTRAINT hospitals_hospital_code_check
  CHECK (length(hospital_code) >= 3 AND length(hospital_code) <= 32);

-------------------------------------------------------------------------------
-- 4. Guard against missing retired_ids table in private.guard_retired_id()
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.guard_retired_id() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
begin
  if tg_table_name = 'hospitals' then
    if to_regclass('public.retired_ids') is not null then
      if exists (select 1 from public.retired_ids r where r.retired_id = new.hospital_code) then
        raise exception '% is a retired ID: use the kept ID instead', new.hospital_code using errcode = '23514';
      end if;
    end if;
  else
    if exists (select 1 from public.hospitals h where h.hospital_code = new.retired_id) then
      raise exception '% is still a hospital row: it cannot also be retired', new.retired_id using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-------------------------------------------------------------------------------
-- 5. Foreign keys cascade ON UPDATE on hospital_code
-------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hospital_sheets_hospital_code_fkey') THEN
    ALTER TABLE public.hospital_sheets DROP CONSTRAINT hospital_sheets_hospital_code_fkey;
    ALTER TABLE public.hospital_sheets
      ADD CONSTRAINT hospital_sheets_hospital_code_fkey
      FOREIGN KEY (hospital_code) REFERENCES public.hospitals(hospital_code) ON UPDATE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'claims_staging_hospital_code_fkey') THEN
    ALTER TABLE public.claims_staging DROP CONSTRAINT claims_staging_hospital_code_fkey;
    ALTER TABLE public.claims_staging
      ADD CONSTRAINT claims_staging_hospital_code_fkey
      FOREIGN KEY (hospital_code) REFERENCES public.hospitals(hospital_code) ON UPDATE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'column_mappings_hospital_code_fkey') THEN
    ALTER TABLE public.column_mappings DROP CONSTRAINT column_mappings_hospital_code_fkey;
    ALTER TABLE public.column_mappings
      ADD CONSTRAINT column_mappings_hospital_code_fkey
      FOREIGN KEY (hospital_code) REFERENCES public.hospitals(hospital_code) ON UPDATE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_hospital_code_fkey') THEN
    ALTER TABLE public.issues DROP CONSTRAINT issues_hospital_code_fkey;
    ALTER TABLE public.issues
      ADD CONSTRAINT issues_hospital_code_fkey
      FOREIGN KEY (hospital_code) REFERENCES public.hospitals(hospital_code) ON UPDATE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_hospital_code_fkey') THEN
    ALTER TABLE public.payments DROP CONSTRAINT payments_hospital_code_fkey;
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_hospital_code_fkey
      FOREIGN KEY (hospital_code) REFERENCES public.hospitals(hospital_code) ON UPDATE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_hospital_code_fkey') THEN
    ALTER TABLE public.questions DROP CONSTRAINT questions_hospital_code_fkey;
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_hospital_code_fkey
      FOREIGN KEY (hospital_code) REFERENCES public.hospitals(hospital_code) ON UPDATE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sheet_tabs_hospital_code_fkey') THEN
    ALTER TABLE public.sheet_tabs DROP CONSTRAINT sheet_tabs_hospital_code_fkey;
    ALTER TABLE public.sheet_tabs
      ADD CONSTRAINT sheet_tabs_hospital_code_fkey
      FOREIGN KEY (hospital_code) REFERENCES public.hospitals(hospital_code) ON UPDATE CASCADE;
  END IF;
END $$;

-------------------------------------------------------------------------------
-- 6. Hospital profile update RPC with ID history tracking
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_hospital_profile(
  p_hospital_key       uuid,
  p_new_hospital_code  text,
  p_hospital_name      text,
  p_other_names        text[],
  p_status             text,
  p_question_sheet_url text,
  p_change_reason      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
declare
  v_old_code text;
  v_key      uuid := p_hospital_key;
begin
  if not private.has_role('ADMIN') then
    raise exception 'Only ADMIN or OWNER can edit hospital profiles' using errcode = '42501';
  end if;

  select hospital_code into v_old_code
    from public.hospitals
   where hospital_key = v_key;

  if v_old_code is null then
    raise exception 'Hospital key % not found', p_hospital_key using errcode = 'P0002';
  end if;

  -- If ID changed, log history
  if v_old_code <> p_new_hospital_code then
    insert into public.hospital_id_history (
      hospital_key, old_hospital_id, new_hospital_id, changed_by, changed_on, reason
    ) values (
      v_key, v_old_code, p_new_hospital_code, (select auth.uid()), now(), p_change_reason
    );
  end if;

  -- Update hospitals
  update public.hospitals
     set hospital_code        = p_new_hospital_code,
         hospital_name        = p_hospital_name,
         other_names          = coalesce(p_other_names, '{}'::text[]),
         status               = p_status,
         question_sheet_url   = p_question_sheet_url,
         updated_at           = now()
   where hospital_key = v_key;

  -- If ID changed, also update hospital_sheets.sheet_key to stay consistent
  if v_old_code <> p_new_hospital_code then
    update public.hospital_sheets
       set sheet_key = hospital_code || '|' || scheme,
           updated_at = now()
     where hospital_code = p_new_hospital_code;
  end if;
end;
$$;

GRANT EXECUTE ON FUNCTION public.save_hospital_profile(uuid, text, text, text[], text, text, text) TO authenticated;
