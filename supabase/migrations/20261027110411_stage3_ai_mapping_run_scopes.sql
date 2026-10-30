-- Stage 3 (reading sheets). NOT APPLIED. Anoop reviews this SQL first (CLAUDE.md hard rule).
-- Take a backup before applying.
--
-- 1. column_mappings.method accepts 'AI': a column the alias list could not map and the AI
--    suggested. Still PROPOSED until a person confirms (approve_version_group_mappings).
-- 2. request_runs(): Run now for all hospitals or one hospital (requirements v2 section 4).
--    Each sheet is queued through the existing public.request_sheet_run, which is NOT changed
--    (migration 20261027000025): same approved-user gate, same SYNC / read-skip checks, and
--    the same one-run-per-sheet check (plus the unique index jobs_one_active_per_sheet).
--    Needed because a User without the Hospitals tick cannot list hospital_sheets, yet every
--    approved user may press Run now (addendum 27-Oct-2026).
-- 3. active_sheet_runs(): which sheets are queued or running now, so the Run now buttons can
--    show "Running" to every approved user. Sheet keys and status only, no claim data.

-- 1. -----------------------------------------------------------------------------------
ALTER TABLE public.column_mappings DROP CONSTRAINT IF EXISTS column_mappings_method_check;
ALTER TABLE public.column_mappings
  ADD CONSTRAINT column_mappings_method_check
  CHECK (method IN ('ALIAS', 'PILOT', 'MANUAL', 'DUPLICATE_HEADER', 'UNMATCHED', 'AI'));

-- 2. -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_runs(
  p_scope text,                       -- 'ALL' or 'HOSPITAL'
  p_hospital_code text DEFAULT NULL,
  p_mode text DEFAULT 'DRY_RUN'
)
RETURNS TABLE (sheet_key text, result text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  IF private.current_app_role() IS NULL THEN
    RAISE EXCEPTION 'Only approved users can start a sheet run' USING ERRCODE = '42501';
  END IF;
  IF p_scope NOT IN ('ALL', 'HOSPITAL') OR (p_scope = 'HOSPITAL' AND p_hospital_code IS NULL) THEN
    RAISE EXCEPTION 'Scope must be ALL, or HOSPITAL with a hospital code' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('WRITE', 'DRY_RUN') THEN
    RAISE EXCEPTION 'Mode must be WRITE or DRY_RUN' USING ERRCODE = '22023';
  END IF;

  FOR v_key IN
    SELECT s.sheet_key
      FROM public.hospital_sheets s
      JOIN public.hospitals h ON h.hospital_code = s.hospital_code
     WHERE s.sync = 'YES'
       AND s.read_skip_reason IS NULL
       AND s.missing_from_register_since IS NULL
       AND s.spreadsheet_id IS NOT NULL
       AND h.status = 'ACTIVE'
       AND (p_scope = 'ALL' OR s.hospital_code = p_hospital_code)
     ORDER BY s.sheet_key
  LOOP
    BEGIN
      PERFORM public.request_sheet_run(v_key, p_mode);
      sheet_key := v_key; result := 'QUEUED';
    EXCEPTION
      WHEN unique_violation THEN sheet_key := v_key; result := 'ALREADY_RUNNING';
      WHEN insufficient_privilege THEN sheet_key := v_key; result := 'NOT_READ';
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.request_runs(text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_runs(text, text, text) TO authenticated;

-- 3. -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.active_sheet_runs()
RETURNS TABLE (sheet_key text, status text, requested_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF private.current_app_role() IS NULL THEN
    RAISE EXCEPTION 'Only approved users can see runs' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT j.sheet_key, j.status::text, j.requested_at
      FROM public.jobs j
     WHERE j.status IN ('QUEUED', 'RUNNING');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.active_sheet_runs() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.active_sheet_runs() TO authenticated;

NOTIFY pgrst, 'reload schema';
