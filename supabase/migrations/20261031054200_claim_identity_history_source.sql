-- Stage 1d: claim history lanes, record source, Scheme -> Insurer -> TPA list.
-- Applied to live 31-Oct-2026 after Anoop's OK. Rollback snapshot taken first:
-- supabase/.temp/backup_before_1d_20261031.sql.
--
-- What changes:
-- 1. change_log (claim history, never updated or deleted): actor is the lane tag of decision
--    section 9 - AUTO (deterministic cleaning), SHEET (the hospital changed the value),
--    AI_ACCEPTED (an AI suggestion a person accepted), HUMAN (a person decided). The two
--    person lanes must say why and who (reason, decided_by). The old tag ENGINE becomes AUTO.
-- 2. claims_staging.record_source: GOOGLE_SHEET (today) or TMS_IMPORT (later), decision
--    section 4 (30-Oct).
-- 3. scheme_insurers: which insurers and TPAs serve a scheme, with valid-from / valid-to
--    (decision section 9). Read by every approved user, changed by Owner or Admin. Seeded only
--    with what the decisions say: MEDISEP -> Oriental Insurance -> Vidal and FHPL (dates not
--    known: left empty, never guessed).
-- Claim identity itself (claim number + admission date + discharge date) is in the code
-- (recordKeyFor); claims_staging holds no rows yet, so no key is moved here.

-- 1. -------------------------------------------------------------------------------------
-- change_log has a no-update trigger: old tags are moved with it switched off for this one
-- statement (on live the table is empty on 31-Oct; a fresh database too).
ALTER TABLE public.change_log DISABLE TRIGGER change_log_no_update;
UPDATE public.change_log SET actor = 'AUTO' WHERE actor = 'ENGINE';
ALTER TABLE public.change_log ENABLE TRIGGER change_log_no_update;

ALTER TABLE public.change_log
  ALTER COLUMN actor SET DEFAULT 'AUTO',
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS decided_by uuid;
ALTER TABLE public.change_log DROP CONSTRAINT IF EXISTS change_log_actor_check;
ALTER TABLE public.change_log
  ADD CONSTRAINT change_log_actor_check CHECK (actor IN ('AUTO', 'SHEET', 'AI_ACCEPTED', 'HUMAN'));
ALTER TABLE public.change_log DROP CONSTRAINT IF EXISTS change_log_person_reason;
ALTER TABLE public.change_log
  ADD CONSTRAINT change_log_person_reason
  CHECK (actor NOT IN ('AI_ACCEPTED', 'HUMAN') OR (nullif(trim(reason), '') IS NOT NULL AND decided_by IS NOT NULL));

-- 2. -------------------------------------------------------------------------------------
ALTER TABLE public.claims_staging
  ADD COLUMN IF NOT EXISTS record_source text NOT NULL DEFAULT 'GOOGLE_SHEET';
ALTER TABLE public.claims_staging DROP CONSTRAINT IF EXISTS claims_staging_record_source_check;
ALTER TABLE public.claims_staging
  ADD CONSTRAINT claims_staging_record_source_check CHECK (record_source IN ('GOOGLE_SHEET', 'TMS_IMPORT'));

-- 3. -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scheme_insurers (
  id         uuid primary key default gen_random_uuid(),
  scheme     text not null check (length(trim(scheme)) between 1 and 40),
  insurer    text not null check (length(trim(insurer)) between 1 and 120),
  tpa        text check (tpa IS NULL OR length(trim(tpa)) between 1 and 120),  -- NULL: the insurer settles itself
  valid_from date,                                                           -- NULL: since before the portal
  valid_to   date,                                                           -- NULL: still valid
  note       text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS scheme_insurers_one
  ON public.scheme_insurers (scheme, insurer, coalesce(tpa, ''), coalesce(valid_from, '0001-01-01'));
ALTER TABLE public.scheme_insurers ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit' AND tgrelid = 'public.scheme_insurers'::regclass) THEN
    PERFORM private.protect_table('public.scheme_insurers', 'id');
  END IF;
END
$$;

DROP POLICY IF EXISTS scheme_insurers_read ON public.scheme_insurers;
DROP POLICY IF EXISTS scheme_insurers_write ON public.scheme_insurers;
DROP POLICY IF EXISTS scheme_insurers_change ON public.scheme_insurers;
CREATE POLICY scheme_insurers_read ON public.scheme_insurers FOR SELECT TO authenticated
  USING ((SELECT private.current_app_role()) IS NOT NULL);
CREATE POLICY scheme_insurers_write ON public.scheme_insurers FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role('ADMIN')));
CREATE POLICY scheme_insurers_change ON public.scheme_insurers FOR UPDATE TO authenticated
  USING ((SELECT private.has_role('ADMIN'))) WITH CHECK ((SELECT private.has_role('ADMIN')));
REVOKE ALL ON public.scheme_insurers FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.scheme_insurers TO authenticated;
GRANT SELECT ON public.scheme_insurers TO service_role;

SELECT set_config('oksy.audit_reason', 'Stage 1d: Scheme -> Insurer -> TPA list seeded from decisions section 9', true);
INSERT INTO public.scheme_insurers (scheme, insurer, tpa, note)
VALUES ('MEDISEP', 'Oriental Insurance', 'Vidal', 'decisions.md section 9: both TPAs at the same time'),
       ('MEDISEP', 'Oriental Insurance', 'FHPL', 'decisions.md section 9: both TPAs at the same time')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
