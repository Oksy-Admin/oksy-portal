-- Item 5 (Anoop, 27-Oct-2026): users with the Hospitals edit tick (hospitals_add_edit) may
-- also confirm column mappings, besides Owner and Admin. Changes the rule of migration
-- 20261027000027 (kept in 0028): has_role('ADMIN') -> has_tick('hospitals_add_edit').
-- private.has_tick() passes Owner and Admin always (migration 20261027000021).
-- NOT APPLIED. Waiting for Anoop's OK on this SQL.
-- Backup / rollback: supabase/.temp/backup_before_0029_0030_20261027.sql (both functions and
-- the column_mappings policies as they are on live now).
--
-- 1. approve_column_mapping: same body as 0028, only the gate changes.
-- 2. approve_version_group_mappings: same body as 0027, only the gate changes.
-- 3. column_mappings read / update policies: the same tick (they were the old roles ADMIN,
--    APPROVER, HELPER; nobody has APPROVER or HELPER on live). Without the read policy a tick
--    user could not load the Column Mappings page.
-- Creating a new field ("+ Create new field") stays Owner / Admin (Fields page, 0028).

CREATE OR REPLACE FUNCTION public.approve_column_mapping(
  p_id uuid,
  p_canonical_field text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_tick('hospitals_add_edit') THEN
    RAISE EXCEPTION 'Only Owner, Admin or users with the Hospitals edit tick can approve column mappings (G1)' USING ERRCODE = '42501';
  END IF;
  IF p_canonical_field = '' THEN
    RAISE EXCEPTION 'Empty field: pass NULL for extra_fields' USING ERRCODE = '22023';
  END IF;
  IF p_canonical_field IS NOT NULL AND p_canonical_field <> 'IGNORE'
     AND NOT EXISTS (SELECT 1 FROM public.mapping_fields WHERE key = p_canonical_field AND status = 'ACTIVE')
     AND NOT EXISTS (SELECT 1 FROM public.column_mappings WHERE id = p_id AND canonical_field = p_canonical_field) THEN
    RAISE EXCEPTION 'Unknown or hidden field: %', p_canonical_field USING ERRCODE = '22023';
  END IF;

  UPDATE public.column_mappings
     SET canonical_field = p_canonical_field,  -- NULL = extra_fields, 'IGNORE' = not read
         confidence = 1.0,
         method = 'MANUAL',
         status = 'APPROVED',
         approved_by = auth.uid(),
         approved_at = now()
   WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_version_group_mappings(
  p_spreadsheet_id text,
  p_header_fp text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT private.has_tick('hospitals_add_edit') THEN
    RAISE EXCEPTION 'Only Owner, Admin or users with the Hospitals edit tick can approve column mappings (G1)' USING ERRCODE = '42501';
  END IF;

  UPDATE public.column_mappings
     SET status = 'APPROVED',
         approved_by = auth.uid(),
         approved_at = now()
   WHERE spreadsheet_id = p_spreadsheet_id
     AND header_fp = p_header_fp
     AND status = 'PROPOSED';

  GET DIAGNOSTICS v_count = row_count;
  RETURN v_count;
END;
$$;

DROP POLICY IF EXISTS column_mappings_read ON public.column_mappings;
CREATE POLICY column_mappings_read ON public.column_mappings
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_add_edit')));

DROP POLICY IF EXISTS column_mappings_update ON public.column_mappings;
CREATE POLICY column_mappings_update ON public.column_mappings
  FOR UPDATE TO authenticated
  USING ((SELECT private.has_tick('hospitals_add_edit')))
  WITH CHECK ((SELECT private.has_tick('hospitals_add_edit')));

-- Signatures unchanged, so the grants of 0027 stay (authenticated may execute, anon may not).
NOTIFY pgrst, 'reload schema';
