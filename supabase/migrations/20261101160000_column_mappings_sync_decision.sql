-- Pilot trial fix (1-Nov-2026): decide_header() only ever cleared column_mappings.review_reason,
-- never corrected column_mappings.canonical_field to match the new decision. Two live symptoms
-- traced to this on HOSPPVTP0001 (Badagara):
--   1. DISCOUNT: header_decisions says discount_amount (accept_any_shape still false), but
--      PVT DAILYSIS and ULCC each also kept an older per-tab row with canonical_field = 'IGNORE'
--      from before the header was decided. Harmless to the worker (resolveLayout reads only
--      header_decisions, never column_mappings.canonical_field, for the actual cleaning), but
--      confusing on this page and in any future reading of column_mappings.
--   2. MEMBER NUMBER (PVT DAILYSIS): header_decisions correctly says policy_or_card_no (decided
--      11:43, 1-Nov), but its column_mappings row still shows the original AI/alias proposal,
--      policy_holder_name, because nothing ever went back to fix it.
-- Backup first: pg_dump of column_mappings and header_decisions before applying to live.
--
-- What changes:
-- 1. private.guard_mapping_update(): still blocks a direct edit of an APPROVED mapping's
--    canonical_field (that guard is for G1/UI edits), but lets it through when the session has
--    set oksy.header_decision_sync, which only decide_header() ever sets.
-- 2. decide_header(): after saving the decision, column_mappings.canonical_field for every row
--    of that hospital + scheme + header (any tab, any status except RETIRED) is set to match
--    it, and review_reason is cleared at the same time. The header_decisions row is always the
--    one that wins; an old per-tab proposal (including a stale IGNORE) is corrected to match it.
-- 3. One-time backfill: the same correction run once for every live header_decisions row, so
--    today's stale rows (Badagara DISCOUNT and MEMBER NUMBER included) are fixed immediately.
--    bulk_confirm_headers() is not changed here (decisions.md section 5, 1-Nov scope-lock); its
--    own staleness is a separate, smaller follow-up.

-- 1. -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.guard_mapping_update()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF old.status <> 'PROPOSED'
     AND (new.canonical_field, new.confidence, new.method) IS DISTINCT FROM (old.canonical_field, old.confidence, old.method)
     AND coalesce(current_setting('oksy.header_decision_sync', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Only a PROPOSED mapping can be corrected; an approved mapping changes through G1'
      USING ERRCODE = '42501';
  END IF;
  RETURN new;
END;
$$;

-- 2. -------------------------------------------------------------------------------------
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

  -- The header_decisions row always wins: every stored column (any tab, any status except
  -- RETIRED) is corrected to match it, including an old per-tab proposal or a stale IGNORE.
  -- The worker checks values again on the next run and sets a new review_reason if still needed.
  PERFORM set_config('oksy.header_decision_sync', 'on', true);
  UPDATE public.column_mappings
     SET canonical_field = p_canonical_field,
         review_reason = NULL
   WHERE hospital_code = p_hospital_code AND scheme = p_scheme AND header_key = p_header_key
     AND status <> 'RETIRED'
     AND (canonical_field IS DISTINCT FROM p_canonical_field OR review_reason IS NOT NULL);
  PERFORM set_config('oksy.header_decision_sync', 'off', true);

  SELECT count(*) INTO v_count
    FROM public.column_mappings
   WHERE hospital_code = p_hospital_code AND scheme = p_scheme AND header_key = p_header_key
     AND status <> 'RETIRED';
  RETURN v_count;
END;
$$;
-- Same signature, so the grants of 20261030194846 / 20261030200918 stay.

-- 3. -------------------------------------------------------------------------------------
-- One-time backfill: every live header_decisions row (not withdrawn) corrects its own
-- column_mappings rows the same way decide_header() now does, so today's stale rows (Badagara
-- DISCOUNT and MEMBER NUMBER included) are fixed without waiting for the header to be re-saved.
DO $$
BEGIN
  PERFORM set_config('oksy.audit_reason', 'Stage 2f: column_mappings corrected to match header_decisions (one-time backfill)', true);
  PERFORM set_config('oksy.header_decision_sync', 'on', true);
  UPDATE public.column_mappings cm
     SET canonical_field = hd.canonical_field,
         review_reason = NULL
    FROM public.header_decisions hd
   WHERE hd.withdrawn_at IS NULL
     AND cm.hospital_code = hd.hospital_code AND cm.scheme = hd.scheme AND cm.header_key = hd.header_key
     AND cm.status <> 'RETIRED'
     AND (cm.canonical_field IS DISTINCT FROM hd.canonical_field OR cm.review_reason IS NOT NULL);
  PERFORM set_config('oksy.header_decision_sync', 'off', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
