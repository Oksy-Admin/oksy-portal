-- Stage 1b-ii: bulk confirm of header decisions, undoable as a group (decisions.md section 5).
-- Applied to live 31-Oct-2026 after Anoop's OK. Rollback snapshot taken first:
-- supabase/.temp/backup_before_1b_ii_20261031.sql.
--
-- What changes:
-- 1. header_decisions gets batch_id (the bulk confirm that made it) and withdrawn_at (undone:
--    the header is undecided again). Rows are never deleted. Method 'BULK' is allowed.
--    Readers use only rows with withdrawn_at IS NULL.
-- 2. header_decision_batches: one row per bulk confirm, with the list it confirmed. This row
--    is the one audit entry of the action (and its update the one entry of the undo); the
--    header_decisions rows of a batch are not audited one by one.
-- 3. bulk_confirm_headers(): Owner or Admin; 1 to 50 undecided headers of one hospital +
--    scheme, each with the exact decision another hospital of the same scheme already has.
-- 4. undo_header_batch(): Owner or Admin; withdraws the batch's decisions that nobody has
--    changed since.
-- 5. decide_header(): a person's decision clears batch_id and withdrawn_at; a withdrawn row
--    does not count as an earlier decision.

-- 1. -------------------------------------------------------------------------------------
CREATE TABLE public.header_decision_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_code text NOT NULL REFERENCES public.hospitals (hospital_code) ON UPDATE CASCADE,
  scheme        text NOT NULL,
  -- [{header_key, source_header, canonical_field, from}]: what was confirmed, and from which hospitals.
  items         jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  item_count    integer NOT NULL CHECK (item_count BETWEEN 1 AND 50),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  undone_at     timestamptz,
  undone_by     uuid,
  undone_count  integer
);
ALTER TABLE public.header_decision_batches ENABLE ROW LEVEL SECURITY;
SELECT private.protect_table('public.header_decision_batches', 'id');
CREATE POLICY header_decision_batches_read ON public.header_decision_batches
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_add_edit')));
GRANT SELECT ON public.header_decision_batches TO authenticated;

ALTER TABLE public.header_decisions
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.header_decision_batches (id),
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;
ALTER TABLE public.header_decisions DROP CONSTRAINT IF EXISTS header_decisions_method_check;
ALTER TABLE public.header_decisions
  ADD CONSTRAINT header_decisions_method_check CHECK (method IN ('MANUAL', 'MIGRATED', 'BULK'));
CREATE INDEX IF NOT EXISTS header_decisions_batch ON public.header_decisions (batch_id) WHERE batch_id IS NOT NULL;

-- 2. -------------------------------------------------------------------------------------
-- One audit entry per bulk action: the batch row carries the list. A person's own decision
-- (decide_header) clears batch_id, so it is audited as before.
DROP TRIGGER IF EXISTS audit ON public.header_decisions;
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.header_decisions
  FOR EACH ROW WHEN (NEW.batch_id IS NULL) EXECUTE FUNCTION private.audit_row('id');

-- 3. -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_confirm_headers(p_hospital_code text, p_scheme text, p_items jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_n integer;
  v_item jsonb;
  v_key text;
  v_field text;
  v_header text;
  v_from text[];
  v_list jsonb := '[]'::jsonb;
  v_batch uuid;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can confirm headers in bulk' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Items must be a list' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_items);
  IF v_n < 1 OR v_n > 50 THEN
    RAISE EXCEPTION 'Bulk confirm takes 1 to 50 headers at a time (got %)', v_n USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x->>'header_key') FROM jsonb_array_elements(p_items) x) <> v_n THEN
    RAISE EXCEPTION 'A header appears twice in the list' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_key := v_item->>'header_key';
    v_field := v_item->>'canonical_field';  -- NULL = keep in extra columns
    SELECT min(source_header) INTO v_header
      FROM public.column_mappings
     WHERE hospital_code = p_hospital_code AND scheme = p_scheme AND header_key = v_key AND status <> 'RETIRED';
    IF v_header IS NULL THEN
      RAISE EXCEPTION 'No column with header "%" in this hospital and scheme', v_key USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.header_decisions
                WHERE hospital_code = p_hospital_code AND scheme = p_scheme AND header_key = v_key AND withdrawn_at IS NULL) THEN
      RAISE EXCEPTION 'Header "%" is already decided; change it on its own row', v_header USING ERRCODE = '23505';
    END IF;
    IF v_field IS NOT NULL AND v_field <> 'IGNORE'
       AND NOT EXISTS (SELECT 1 FROM public.mapping_fields WHERE key = v_field AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'Unknown or hidden field: %', v_field USING ERRCODE = '22023';
    END IF;
    -- Exact matches only: the same header, decided the same way, in another hospital of the scheme.
    SELECT array_agg(DISTINCT hospital_code ORDER BY hospital_code) INTO v_from
      FROM public.header_decisions
     WHERE scheme = p_scheme AND header_key = v_key AND hospital_code <> p_hospital_code
       AND withdrawn_at IS NULL AND canonical_field IS NOT DISTINCT FROM v_field;
    IF v_from IS NULL THEN
      RAISE EXCEPTION 'Header "%" has no matching decision in another hospital of scheme %', v_header, p_scheme USING ERRCODE = '22023';
    END IF;
    v_list := v_list || jsonb_build_object('header_key', v_key, 'source_header', v_header, 'canonical_field', v_field, 'from', to_jsonb(v_from));
  END LOOP;

  PERFORM set_config('oksy.audit_reason', format('Column mapping: bulk confirm of %s headers', v_n), true);
  INSERT INTO public.header_decision_batches (hospital_code, scheme, items, item_count, created_by)
  VALUES (p_hospital_code, p_scheme, v_list, v_n, auth.uid())
  RETURNING id INTO v_batch;

  INSERT INTO public.header_decisions (hospital_code, scheme, header_key, source_header, canonical_field, method, note, decided_by, decided_at, batch_id)
  SELECT p_hospital_code, p_scheme, x->>'header_key', x->>'source_header', x->>'canonical_field', 'BULK',
         'Confirmed in bulk, same as ' || (SELECT string_agg(f, ', ') FROM jsonb_array_elements_text(x->'from') f),
         auth.uid(), now(), v_batch
    FROM jsonb_array_elements(v_list) x
  ON CONFLICT (hospital_code, scheme, header_key) DO UPDATE  -- only a withdrawn row (checked above)
     SET canonical_field = EXCLUDED.canonical_field,
         accept_any_shape = false,
         method = 'BULK',
         note = EXCLUDED.note,
         decided_by = EXCLUDED.decided_by,
         decided_at = EXCLUDED.decided_at,
         batch_id = EXCLUDED.batch_id,
         withdrawn_at = NULL;

  UPDATE public.column_mappings
     SET review_reason = NULL
   WHERE hospital_code = p_hospital_code AND scheme = p_scheme AND review_reason IS NOT NULL
     AND header_key IN (SELECT x->>'header_key' FROM jsonb_array_elements(v_list) x);
  RETURN v_batch;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bulk_confirm_headers(text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bulk_confirm_headers(text, text, jsonb) TO authenticated;

-- 4. -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_header_batch(p_batch_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_batch public.header_decision_batches;
  v_count integer;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can undo a bulk confirm' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_batch FROM public.header_decision_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No bulk confirm with this id' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'This bulk confirm was already undone' USING ERRCODE = '22023';
  END IF;

  -- A header someone decided on its own row since then has batch_id NULL: it stays.
  UPDATE public.header_decisions
     SET withdrawn_at = now()
   WHERE batch_id = p_batch_id AND withdrawn_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('oksy.audit_reason', format('Column mapping: bulk confirm undone (%s headers)', v_count), true);
  UPDATE public.header_decision_batches
     SET undone_at = now(), undone_by = auth.uid(), undone_count = v_count
   WHERE id = p_batch_id;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.undo_header_batch(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.undo_header_batch(uuid) TO authenticated;

-- 5. -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_header(
  p_hospital_code text,
  p_scheme text,
  p_header_key text,
  p_canonical_field text DEFAULT NULL,
  p_accept_shape boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_header text;
  v_count integer;
BEGIN
  IF NOT private.has_tick('hospitals_add_edit') THEN
    RAISE EXCEPTION 'Only Owner, Admin or users with the Hospitals edit tick can decide column mappings' USING ERRCODE = '42501';
  END IF;
  IF p_canonical_field = '' THEN
    RAISE EXCEPTION 'Empty field: pass NULL to keep the column in extra_fields' USING ERRCODE = '22023';
  END IF;
  IF p_canonical_field IS NOT NULL AND p_canonical_field <> 'IGNORE'
     AND NOT EXISTS (SELECT 1 FROM public.mapping_fields WHERE key = p_canonical_field AND status = 'ACTIVE')
     AND NOT EXISTS (SELECT 1 FROM public.header_decisions
                      WHERE hospital_code = p_hospital_code AND scheme = p_scheme AND withdrawn_at IS NULL
                        AND header_key = p_header_key AND canonical_field = p_canonical_field) THEN
    RAISE EXCEPTION 'Unknown or hidden field: %', p_canonical_field USING ERRCODE = '22023';
  END IF;

  SELECT min(source_header) INTO v_header
    FROM public.column_mappings
   WHERE hospital_code = p_hospital_code AND scheme = p_scheme AND header_key = p_header_key;
  IF v_header IS NULL THEN
    RAISE EXCEPTION 'No column with this header in this hospital and scheme' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('oksy.audit_reason', 'Column mapping: header decided for hospital + scheme', true);
  INSERT INTO public.header_decisions (hospital_code, scheme, header_key, source_header, canonical_field, accept_any_shape, method, decided_by, decided_at)
  VALUES (p_hospital_code, p_scheme, p_header_key, v_header, p_canonical_field, coalesce(p_accept_shape, false), 'MANUAL', auth.uid(), now())
  ON CONFLICT (hospital_code, scheme, header_key) DO UPDATE
     SET canonical_field = EXCLUDED.canonical_field,
         accept_any_shape = EXCLUDED.accept_any_shape,
         method = 'MANUAL',
         note = NULL,
         decided_by = EXCLUDED.decided_by,
         decided_at = EXCLUDED.decided_at,
         batch_id = NULL,
         withdrawn_at = NULL;

  -- The worker checks the columns again on the next run and sets a new reason if needed.
  UPDATE public.column_mappings
     SET review_reason = NULL
   WHERE hospital_code = p_hospital_code AND scheme = p_scheme AND header_key = p_header_key
     AND review_reason IS NOT NULL;

  SELECT count(*) INTO v_count
    FROM public.column_mappings
   WHERE hospital_code = p_hospital_code AND scheme = p_scheme AND header_key = p_header_key
     AND status <> 'RETIRED';
  RETURN v_count;
END;
$$;
-- Same signature, so the grants of 20261030194846 stay.

NOTIFY pgrst, 'reload schema';
