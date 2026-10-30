-- Stage 1b-i: mapping model core (decisions.md section 5, Policy B + D). NOT APPLIED.
-- Waiting for Anoop's OK on this SQL. Take a backup first (column_mappings, mapping_fields
-- and the functions below), e.g. supabase/.temp/backup_before_1b_i_20261031.sql.
--
-- What changes:
-- 1. mapping_fields: new extra field "UHID" (hospital patient ID, not the IP number); the
--    alias UHID comes off IP Number; "Follow Up Remarks" moves from Follow-up Remarks to
--    Remarks (any remark column goes to one remarks field).
-- 2. column_mappings gets scheme, header_key (the normalised header) and review_reason
--    (why the worker stopped reuse for this column). Backfilled for today's 452 rows.
-- 3. header_decisions: one mapping decision per hospital + scheme + normalised header.
--    Read by the worker and reused on every tab with the same header. Audited, never deleted.
-- 4. decide_header(): Owner, Admin or the Hospitals edit tick decide a header once
--    (a field, Ignore, or keep in extra_fields). Ignore is saved as a decision.
-- 5. Today's per-tab approvals move into header_decisions: the 7 header decisions of 30-Oct
--    first; any other header whose approved rows all agree on one choice; auto-Ignored
--    headers (Length of Stay, Settlement Delay, Balance Amount, TDS %) are not stored, the
--    code ignores them. A plain "TDS" in a hospital + scheme that also has "TDS AMOUNT" is
--    not stored either (value-based auto-Ignore or the decision list). Headers that disagree, or were left as "extra_fields (not decided
--    yet)", stay on the decision list. The old rows stay as they are (history).
-- 6. delete_mapping_field(): a field used by a header decision is "in use".
-- 7. Worker (service_role): read header_decisions, write review_reason.

-- 1. -------------------------------------------------------------------------------------
SELECT set_config('oksy.audit_reason', 'Stage 1b-i: UHID field and remark aliases (decisions 30-Oct)', true);
INSERT INTO public.mapping_fields (key, label, data_type, aliases, status, is_core, sort_order)
SELECT 'uhid', 'UHID', 'text', ARRAY['UHID'], 'ACTIVE', false, coalesce(max(sort_order), 0) + 10
  FROM public.mapping_fields
ON CONFLICT (key) DO NOTHING;
UPDATE public.mapping_fields SET aliases = ARRAY['IP No', 'IP Number', 'MR No', 'MRD No', 'IP', 'MRD/ UHID/ IP NUMBER', 'MRD / UHID / IP No'], updated_at = now() WHERE key = 'patient_ip_no';
UPDATE public.mapping_fields SET aliases = ARRAY['Follow Up', 'Followup', 'Follow-up'], updated_at = now() WHERE key = 'followup_log';
UPDATE public.mapping_fields SET aliases = ARRAY['Remark', 'Remarks', 'Claim Remark', 'Follow Up Remarks'], updated_at = now() WHERE key = 'remarks';

-- 2. -------------------------------------------------------------------------------------
ALTER TABLE public.column_mappings
  ADD COLUMN IF NOT EXISTS scheme text,
  ADD COLUMN IF NOT EXISTS header_key text,
  ADD COLUMN IF NOT EXISTS review_reason text;

SELECT set_config('oksy.audit_reason', 'Stage 1b-i: scheme and header key on column mappings', true);
-- Today every pilot file is one sheet row (one scheme). A file entered for several schemes
-- takes the first; tab-level scheme detection comes in Stage 1d.
UPDATE public.column_mappings m
   SET scheme = (SELECT min(s.scheme) FROM public.hospital_sheets s
                  WHERE s.spreadsheet_id = m.spreadsheet_id AND s.hospital_code = m.hospital_code),
       -- Same rule as headerKey() in packages/rules/src/decisions.ts. A blank header was stored
       -- as "Column N": its key is empty (nothing to decide on a name).
       header_key = CASE WHEN m.source_header ~ '^Column [0-9]+$' THEN ''
                         ELSE regexp_replace(lower(m.source_header), '[^a-z0-9]', '', 'g') END
 WHERE m.scheme IS NULL OR m.header_key IS NULL;

CREATE INDEX IF NOT EXISTS column_mappings_hospital_scheme_header
  ON public.column_mappings (hospital_code, scheme, header_key);

-- 3. -------------------------------------------------------------------------------------
CREATE TABLE public.header_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_code    text NOT NULL REFERENCES public.hospitals (hospital_code) ON UPDATE CASCADE,
  scheme           text NOT NULL,
  header_key       text NOT NULL CHECK (header_key ~ '^[a-z0-9]+$'),
  source_header    text NOT NULL,
  -- NULL = keep in extra_fields, 'IGNORE' = never read, anything else = a mapping_fields key.
  canonical_field  text CHECK (canonical_field IS NULL OR canonical_field = 'IGNORE' OR canonical_field ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- A person confirmed the field although the values did not look like it (value-shape check).
  accept_any_shape boolean NOT NULL DEFAULT false,
  method           text NOT NULL CHECK (method IN ('MANUAL', 'MIGRATED')),
  note             text,
  decided_by       uuid,
  decided_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_code, scheme, header_key)
);
ALTER TABLE public.header_decisions ENABLE ROW LEVEL SECURITY;
SELECT private.protect_table('public.header_decisions', 'id');

CREATE POLICY header_decisions_read ON public.header_decisions
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_add_edit')));
GRANT SELECT ON public.header_decisions TO authenticated;
-- No INSERT / UPDATE grant for logged-in users: changes only through decide_header().

-- 4. -------------------------------------------------------------------------------------
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
                      WHERE hospital_code = p_hospital_code AND scheme = p_scheme
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
         decided_at = EXCLUDED.decided_at;

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
REVOKE EXECUTE ON FUNCTION public.decide_header(text, text, text, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decide_header(text, text, text, text, boolean) TO authenticated;

-- 5. -------------------------------------------------------------------------------------
-- A function, so supabase/tests/12_header_decisions.test.sql can run the same move on fake
-- rows. It is safe to run again (existing decisions are kept). No grants: postgres only.
CREATE OR REPLACE FUNCTION private.migrate_header_decisions()
RETURNS integer
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM set_config('oksy.audit_reason', 'Stage 1b-i: per-tab approvals moved to one decision per hospital + scheme + header', true);
  WITH observed AS (
    SELECT hospital_code, scheme, header_key,
           min(source_header) AS source_header,
           (array_agg(approved_by ORDER BY approved_at DESC) FILTER (WHERE approved_by IS NOT NULL))[1] AS approver
      FROM public.column_mappings
     WHERE header_key <> '' AND scheme IS NOT NULL AND status <> 'RETIRED'
     GROUP BY 1, 2, 3
  ),
  auto_ignored AS (  -- same list as autoIgnoreByHeader() in packages/rules/src/decisions.ts
    SELECT o.* FROM observed o
     WHERE o.header_key = 'los' OR o.header_key LIKE 'lengthofstay%' OR o.header_key LIKE 'loslengthofstay%'
        OR o.header_key LIKE 'settlementdelay%'
        OR o.header_key LIKE 'balanceamount%' OR o.header_key LIKE 'balanceamt%' OR o.header_key LIKE 'balamount%' OR o.header_key LIKE 'balamt%'
        OR (o.header_key LIKE 'tds%' AND (o.source_header LIKE '%\%%' OR o.header_key ~ '^tds(percent|percentage|rate|per)$'))
  ),
  -- A plain "TDS" next to a "TDS AMOUNT" is usually the rate, and its old approvals disagree
  -- (live: HOSPPVTP0001, 0002). Not stored: the value-based auto-Ignore (looksLikeTdsPercent)
  -- or the decision list handles it.
  tds_beside_amount AS (
    SELECT o.* FROM observed o
     WHERE o.header_key = 'tds'
       AND EXISTS (SELECT 1 FROM observed t
                    WHERE (t.hospital_code, t.scheme, t.header_key) = (o.hospital_code, o.scheme, 'tdsamount'))
  ),
  seven(header_key, canonical_field) AS (  -- decisions.md section 5, 30-Oct
    VALUES ('roomcategory', 'room_category'),
           ('uhid', 'uhid'),
           ('tds', 'tds_amount_stated'),
           ('tdsamount', 'tds_amount_stated'),
           ('remark', 'remarks'),
           ('remarks', 'remarks'),
           ('claimremark', 'remarks'),
           ('followupremarks', 'remarks'),
           ('discount', 'discount_amount'),
           ('paymentfollowupdate', 'followup_date')
  ),
  agreed AS (  -- every approved row of the header made the same, real choice
    SELECT hospital_code, scheme, header_key, min(canonical_field) AS canonical_field
      FROM public.column_mappings
     WHERE status = 'APPROVED' AND header_key <> '' AND scheme IS NOT NULL
     GROUP BY 1, 2, 3
    HAVING count(*) = count(canonical_field) AND count(DISTINCT canonical_field) = 1
  )
  INSERT INTO public.header_decisions (hospital_code, scheme, header_key, source_header, canonical_field, method, note, decided_by)
  SELECT o.hospital_code, o.scheme, o.header_key, o.source_header,
         coalesce(s.canonical_field, a.canonical_field),
         'MIGRATED',
         CASE WHEN s.header_key IS NOT NULL THEN 'Anoop''s header decisions of 30-Oct (decisions.md section 5)'
              ELSE 'Moved from the per-tab approvals (all tabs agreed)' END,
         o.approver
    FROM observed o
    LEFT JOIN seven s ON s.header_key = o.header_key
    LEFT JOIN agreed a ON (a.hospital_code, a.scheme, a.header_key) = (o.hospital_code, o.scheme, o.header_key)
   WHERE (s.header_key IS NOT NULL OR a.header_key IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM auto_ignored x WHERE (x.hospital_code, x.scheme, x.header_key) = (o.hospital_code, o.scheme, o.header_key))
     AND NOT EXISTS (SELECT 1 FROM tds_beside_amount x WHERE (x.hospital_code, x.scheme, x.header_key) = (o.hospital_code, o.scheme, o.header_key))
  ON CONFLICT (hospital_code, scheme, header_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.migrate_header_decisions() FROM public;

SELECT private.migrate_header_decisions();

-- 6. -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_mapping_field(p_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_field public.mapping_fields;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can change the field list' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_field FROM public.mapping_fields WHERE key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No field with key %', p_key USING ERRCODE = 'P0002';
  END IF;
  IF v_field.is_core THEN
    RAISE EXCEPTION 'Core field: hide instead' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.column_mappings WHERE canonical_field = p_key)
     OR EXISTS (SELECT 1 FROM public.header_decisions WHERE canonical_field = p_key)
     OR EXISTS (SELECT 1 FROM public.claims_staging WHERE extra_fields ? p_key) THEN
    RAISE EXCEPTION 'In use, hide instead' USING ERRCODE = '23503';
  END IF;
  PERFORM set_config('oksy.audit_reason', 'Fields page: delete unused field', true);
  DELETE FROM public.mapping_fields WHERE key = p_key;
END;
$$;
-- Same signature, so the grants of 20261027143126 stay.

-- 7. -------------------------------------------------------------------------------------
GRANT SELECT ON public.header_decisions TO service_role;
GRANT UPDATE (review_reason) ON public.column_mappings TO service_role;

NOTIFY pgrst, 'reload schema';
