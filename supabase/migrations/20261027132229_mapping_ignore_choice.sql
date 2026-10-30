-- Stage 3 follow-up (decisions 27-Oct-2026). Anoop approved; APPLIED to live 27-Oct-2026
-- (recorded as version 20261027132229, name mapping_ignore_choice).
-- Backup: supabase/.temp/backup_before_0027_20261027.sql (functions) and .rows.sql (PROPOSED rows).
--
-- Checked on live 27-Oct-2026: column_mappings.canonical_field is plain text with no CHECK,
-- enum or foreign key, and status allows PROPOSED / APPROVED / RETIRED. So the new fields
-- (phone_number, policy_holder_name, room_category, followup_date, preauth_approved_amount)
-- and the "Ignore (not needed)" choice (stored as canonical_field = 'IGNORE', status
-- APPROVED) need NO table change. The field list lives in one place,
-- packages/rules/src/fields.ts, and the web action refuses anything not in it.
--
-- What this migration changes (functions only, same signatures, same grants):
-- 1. approve_column_mapping stores the person's choice exactly. Before, a NULL choice kept
--    the old field (coalesce), so choosing "extra_fields" on a column the alias list had
--    mapped silently kept the alias field. Now NULL = extra_fields (not decided yet),
--    'IGNORE' = ignored, anything else = that field.
-- 2. Both approve functions: only Owner and Admin (decision 5). has_role('ADMIN') passes for
--    OWNER too (migration 20261027000020). APPROVER and HELPER no longer exist as live roles,
--    so nobody loses access today.

CREATE OR REPLACE FUNCTION public.approve_column_mapping(
  p_id uuid,
  p_canonical_field text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can approve column mappings (G1)' USING ERRCODE = '42501';
  END IF;
  IF p_canonical_field = '' THEN
    RAISE EXCEPTION 'Empty field: pass NULL for extra_fields' USING ERRCODE = '22023';
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
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can approve column mappings (G1)' USING ERRCODE = '42501';
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

NOTIFY pgrst, 'reload schema';
