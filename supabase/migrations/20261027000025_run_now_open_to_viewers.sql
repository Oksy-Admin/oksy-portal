-- Stage 2 decision (Anoop, 27-Oct-2026): Run now is open to everyone who can see the page.
-- Source: claude/requirements_v2.md section 4 ("Run now is open to everyone who can see the page").
-- Change: request_sheet_run no longer requires ADMIN or APPROVER. It requires
-- every approved user (private.current_app_role() is not NULL), whatever ticks they have.
-- Addendum 27-Oct-2026: "Run now button: every approved user can press it, whatever ticks they have."
-- Everything else in the function is unchanged. The sync, read-skip, and duplicate-run checks stay.

CREATE OR REPLACE FUNCTION public.request_sheet_run(p_sheet_key text, p_mode text DEFAULT 'WRITE')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_sheet public.hospital_sheets;
  v_id    uuid;
BEGIN
  IF private.current_app_role() IS NULL THEN
    RAISE EXCEPTION 'Only approved users can start a sheet run' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sheet FROM public.hospital_sheets WHERE sheet_key = p_sheet_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown sheet' USING ERRCODE = 'P0002';
  END IF;
  IF v_sheet.sync <> 'YES' OR v_sheet.read_skip_reason IS NOT NULL OR v_sheet.missing_from_register_since IS NOT NULL THEN
    RAISE EXCEPTION 'This sheet is never read (SYNC %, or read under another hospital)', v_sheet.sync USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.jobs WHERE sheet_key = p_sheet_key AND status IN ('QUEUED', 'RUNNING')) THEN
    RAISE EXCEPTION 'A run for this sheet is already queued or running' USING ERRCODE = '23505';
  END IF;
  PERFORM set_config('oksy.audit_reason', 'Run now', true);
  INSERT INTO public.jobs (sheet_key, mode) VALUES (p_sheet_key, p_mode) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_sheet_run(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_sheet_run(text, text) TO authenticated;
