-- Fields page (Anoop, 27-Oct-2026; handoff 9e). Anoop approved; APPLIED to live 27-Oct-2026
-- (recorded as version 20261027143126, name mapping_fields).
-- Backup: supabase/.temp/backup_before_0028_20261027.sql (approve_column_mapping as it is
-- now, and the rollback for everything below).
--
-- 1. Table mapping_fields: the field list for column mapping, managed on the Fields page.
--    key never changes (mappings store it), so a rename changes only label. Seeded with the
--    35 core fields from packages/rules/src/fields.ts, same labels-to-keys and aliases, so
--    mapping behaviour does not change (tests: packages/worker/test/field-seed.test.ts and
--    packages/rules/test/field-list.test.ts).
--    sort_order is the fixed report order (core fields 10..350, new fields after them).
-- 2. Read: every approved user (labels are needed for reports). Write: only through the
--    functions below, Owner and Admin only (has_role('ADMIN'); Owner always passes).
-- 3. Delete only when no column mapping and no stored claim uses the field; core fields are
--    never deleted (the cleaning engine reads them by key): "in use, hide instead".
-- 4. approve_column_mapping (from 0027) also checks the choice: NULL (extra_fields),
--    'IGNORE', an ACTIVE field, or the value the row already has. A hidden field is not
--    offered for new mappings.
-- Every change is written to audit_log (insert, update, delete).

-- 1. ------------------------------------------------------------------------------------
CREATE TABLE public.mapping_fields (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label       text NOT NULL CHECK (btrim(label) <> '' AND length(label) <= 80),
  data_type   text NOT NULL CHECK (data_type IN ('text', 'number', 'date', 'amount')),
  aliases     text[] NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'HIDDEN')),
  is_core     boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mapping_fields_label_unique ON public.mapping_fields (lower(btrim(label)));

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON public.mapping_fields
  FOR EACH ROW EXECUTE FUNCTION private.audit_row('key');
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON public.mapping_fields
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_delete();

SELECT set_config('oksy.audit_reason', 'Fields page: seed the 35 core fields (migration 0028)', true);
INSERT INTO public.mapping_fields (key, label, data_type, aliases, status, is_core, sort_order) VALUES
  ('serial_no', 'Serial No', 'number', ARRAY['Sl No', 'Sl. No', 'S No', 'S.No', 'Sr No', 'No', 'Sno', 'Slno'], 'ACTIVE', true, 10),
  ('patient_name', 'Patient Name', 'text', ARRAY['Patient Name', 'Pt Name', 'Name of Patient', 'Patient', 'Name'], 'ACTIVE', true, 20),
  ('patient_ip_no', 'IP Number', 'text', ARRAY['IP No', 'IP Number', 'UHID', 'MR No', 'MRD No', 'IP', 'MRD/ UHID/ IP NUMBER', 'MRD / UHID / IP No'], 'ACTIVE', true, 30),
  ('policy_or_card_no', 'Policy Number / Card ID', 'text', ARRAY['Policy No', 'Policy Number', 'Card No', 'Member ID', 'Policy No / Card No', 'Card Number', 'Policy / Card Number', 'Card Number / Policy Number'], 'ACTIVE', true, 40),
  ('phone_number', 'Phone Number', 'text', ARRAY['Phone', 'Phone No', 'Phone Number', 'Mobile', 'Mobile No', 'Mobile Number', 'Contact No', 'Contact Number'], 'ACTIVE', true, 50),
  ('policy_holder_name', 'Policy Holder Name', 'text', ARRAY['Policy Holder', 'Policy Holder Name', 'Insured Name', 'Card Holder', 'Card Holder Name'], 'ACTIVE', true, 60),
  ('preauth_or_claim_no', 'Claim Number', 'text', ARRAY['Pre-auth No', 'Preauth No', 'Claim No', 'Claim Number', 'Case No', 'Authorisation No', 'Authorization No', 'CCN', 'Claim ID', 'AL No', 'Pre Auth No'], 'ACTIVE', true, 70),
  ('insurer_name', 'Insurer', 'text', ARRAY['Insurer', 'Insurance Company', 'Insurance', 'Company', 'Insurer Name', 'Insurance Co', 'Insurance Company Name'], 'ACTIVE', true, 80),
  ('tpa_name', 'TPA', 'text', ARRAY['TPA', 'TPA Name'], 'ACTIVE', true, 90),
  ('admission_date', 'Admission Date', 'date', ARRAY['DOA', 'Adm Date', 'Admission Date', 'Date of Admission', 'Date Of Admission'], 'ACTIVE', true, 100),
  ('discharge_date', 'Discharge Date', 'date', ARRAY['DOD', 'Discharge Date', 'Date of Discharge', 'Date Of Discharge', 'Dis Date'], 'ACTIVE', true, 110),
  ('treatment_or_surgery', 'Procedure / Treatment', 'text', ARRAY['Treatment', 'Procedure', 'Package', 'Surgery', 'Diagnosis', 'Treatment / Surgery', 'Procedure Name', 'Procedure/Treatment', 'Procedure / Treatment'], 'ACTIVE', true, 120),
  ('department', 'Department', 'text', ARRAY['Department', 'Dept', 'Speciality', 'Specialty'], 'ACTIVE', true, 130),
  ('doctor_name', 'Doctor', 'text', ARRAY['Doctor', 'Consultant', 'Doctor Name', 'Consultant Name', 'Treating Doctor', 'DR NAME'], 'ACTIVE', true, 140),
  ('room_no', 'Room No', 'text', ARRAY['Room No', 'Room', 'Bed No'], 'ACTIVE', true, 150),
  ('room_category', 'Room Category', 'text', ARRAY['Room Category', 'Room Type'], 'ACTIVE', true, 160),
  ('bill_amount', 'Bill Amount', 'amount', ARRAY['Bill', 'Final Bill', 'Bill Amount', 'Total Bill', 'Bill Amt', 'Hospital Bill Amount'], 'ACTIVE', true, 170),
  ('claimed_amount', 'Claimed Amount', 'amount', ARRAY['Claimed Amount', 'Claim Amount', 'Claimed Amt'], 'ACTIVE', true, 180),
  ('preauth_approved_amount', 'Pre-auth Approved Amount', 'amount', ARRAY['Pre-auth Approval Amount', 'Pre-auth Approved Amount', 'Preauth Approved Amount', 'Pre Auth Approved Amount', 'Preauth Approval Amount'], 'ACTIVE', true, 190),
  ('approved_amount', 'Approved Amount', 'amount', ARRAY['Final Approved Amount', 'Final Approved', 'Sanctioned', 'Sanctioned Amount', 'Approved Amount', 'Final Approval'], 'ACTIVE', true, 200),
  ('copay_amount', 'Co-pay', 'amount', ARRAY['Co-pay', 'Copay', 'Co Pay', 'Patient Share', 'Co-Pay Amount'], 'ACTIVE', true, 210),
  ('deduction_amount', 'Deduction', 'amount', ARRAY[]::text[], 'ACTIVE', true, 220),
  ('discount_amount', 'Discount', 'amount', ARRAY['Discount', 'Hospital Discount'], 'ACTIVE', true, 230),
  ('casesheet_sent_date', 'Hardcopy Sent Date', 'date', ARRAY['Hard Copy Sent', 'Courier Date', 'Hard Copy Date', 'Casesheet Sent', 'File Sent Date', 'Hard Copy Sent Date'], 'ACTIVE', true, 240),
  ('courier_no', 'POD Number', 'text', ARRAY['POD Number', 'POD No', 'POD', 'Courier No'], 'ACTIVE', true, 250),
  ('followup_date', 'Follow-up Date', 'date', ARRAY['Follow Up Date', 'Follow-up Date', 'Next Follow Up', 'Next Follow Up Date'], 'ACTIVE', true, 260),
  ('followup_log', 'Follow-up Remarks', 'text', ARRAY['Follow Up', 'Followup', 'Follow-up', 'Follow Up Remarks'], 'ACTIVE', true, 270),
  ('status_text', 'Claim Status', 'text', ARRAY['Claim Status', 'Status of Claim', 'Current Status'], 'ACTIVE', true, 280),
  ('rejection_reason', 'Rejection Reason', 'text', ARRAY['Rejection Reason', 'Reason for Rejection', 'Denial Reason'], 'ACTIVE', true, 290),
  ('cancellation_reason', 'Cancellation Reason', 'text', ARRAY['Cancellation Reason', 'Reason for Cancellation'], 'ACTIVE', true, 300),
  ('payment_date', 'Settlement Date', 'date', ARRAY['Settled Date', 'Payment Date', 'Paid Date', 'Date of Payment', 'Settlement Date', 'Payment Received Date'], 'ACTIVE', true, 310),
  ('payment_amount', 'Settled Amount', 'amount', ARRAY['Paid Amount', 'Amount Received', 'Settled Amount', 'Received Amount', 'Paid Amt'], 'ACTIVE', true, 320),
  ('payment_utr', 'UTR', 'text', ARRAY['UTR', 'UTR No', 'UTR Number', 'NEFT Ref', 'NEFT No', 'Transaction No'], 'ACTIVE', true, 330),
  ('tds_amount_stated', 'TDS', 'amount', ARRAY['TDS', 'TDS Amount'], 'ACTIVE', true, 340),
  ('remarks', 'Remarks', 'text', ARRAY['Remark', 'Remarks', 'Claim Remark'], 'ACTIVE', true, 350);

-- 2. ------------------------------------------------------------------------------------
ALTER TABLE public.mapping_fields ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mapping_fields FROM anon, authenticated;
CREATE POLICY mapping_fields_read ON public.mapping_fields
  FOR SELECT TO authenticated USING ((SELECT private.current_app_role()) IS NOT NULL);
GRANT SELECT ON public.mapping_fields TO authenticated;

-- Header comparison key, the same rule as normaliseHeader in packages/rules.
CREATE FUNCTION private.alias_key(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g') $$;

-- Trimmed, no empties, no repeats; an alias may belong to one field only.
CREATE FUNCTION private.clean_field_aliases(p_key text, p_aliases text[])
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_out text[] := '{}';
  v_seen text[] := '{}';
  v_a text;
  v_k text;
  v_owner text;
BEGIN
  FOREACH v_a IN ARRAY coalesce(p_aliases, '{}') LOOP
    v_a := btrim(v_a);
    v_k := private.alias_key(v_a);
    CONTINUE WHEN v_k = '' OR v_k = ANY (v_seen);
    SELECT f.label INTO v_owner FROM public.mapping_fields f, unnest(f.aliases) a
     WHERE f.key IS DISTINCT FROM p_key AND private.alias_key(a) = v_k LIMIT 1;
    IF v_owner IS NOT NULL THEN
      RAISE EXCEPTION 'Alias "%" is already used by field "%"', v_a, v_owner USING ERRCODE = '23505';
    END IF;
    v_seen := v_seen || v_k;
    v_out := v_out || v_a;
  END LOOP;
  RETURN v_out;
END;
$$;

-- 3. ------------------------------------------------------------------------------------
CREATE FUNCTION public.create_mapping_field(p_label text, p_data_type text, p_aliases text[] DEFAULT '{}')
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_label text := btrim(coalesce(p_label, ''));
  v_base text;
  v_key text;
  v_n integer := 1;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can change the field list' USING ERRCODE = '42501';
  END IF;
  IF v_label = '' OR length(v_label) > 80 THEN
    RAISE EXCEPTION 'A field needs a label of 1 to 80 characters' USING ERRCODE = '22023';
  END IF;
  IF p_data_type IS NULL OR p_data_type NOT IN ('text', 'number', 'date', 'amount') THEN
    RAISE EXCEPTION 'Type must be text, number, date or amount' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mapping_fields WHERE lower(btrim(label)) = lower(v_label)) THEN
    RAISE EXCEPTION 'A field named "%" already exists', v_label USING ERRCODE = '23505';
  END IF;
  -- The key comes from the label once and never changes.
  v_base := left(btrim(regexp_replace(lower(v_label), '[^a-z0-9]+', '_', 'g'), '_'), 50);
  IF v_base !~ '^[a-z]' THEN v_base := 'f_' || v_base; END IF;
  IF length(v_base) < 2 THEN v_base := 'field'; END IF;
  v_key := v_base;
  WHILE EXISTS (SELECT 1 FROM public.mapping_fields WHERE key = v_key) LOOP
    v_n := v_n + 1;
    v_key := v_base || '_' || v_n;
  END LOOP;

  PERFORM set_config('oksy.audit_reason', 'Fields page: add field', true);
  INSERT INTO public.mapping_fields (key, label, data_type, aliases, status, is_core, sort_order, created_by)
  VALUES (v_key, v_label, p_data_type, private.clean_field_aliases(v_key, p_aliases), 'ACTIVE', false,
          (SELECT coalesce(max(sort_order), 0) + 10 FROM public.mapping_fields), auth.uid());
  RETURN v_key;
END;
$$;

CREATE FUNCTION public.update_mapping_field(p_key text, p_label text, p_data_type text, p_aliases text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_field public.mapping_fields;
  v_label text := btrim(coalesce(p_label, ''));
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can change the field list' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_field FROM public.mapping_fields WHERE key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No field with key %', p_key USING ERRCODE = 'P0002';
  END IF;
  IF v_label = '' OR length(v_label) > 80 THEN
    RAISE EXCEPTION 'A field needs a label of 1 to 80 characters' USING ERRCODE = '22023';
  END IF;
  IF p_data_type IS NULL OR p_data_type NOT IN ('text', 'number', 'date', 'amount') THEN
    RAISE EXCEPTION 'Type must be text, number, date or amount' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mapping_fields WHERE key <> p_key AND lower(btrim(label)) = lower(v_label)) THEN
    RAISE EXCEPTION 'A field named "%" already exists', v_label USING ERRCODE = '23505';
  END IF;
  -- The cleaning engine reads core fields as their fixed type, so their type does not change here.
  IF v_field.is_core AND p_data_type IS DISTINCT FROM v_field.data_type THEN
    RAISE EXCEPTION 'The type of a core field cannot be changed' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('oksy.audit_reason', 'Fields page: edit field', true);
  UPDATE public.mapping_fields
     SET label = v_label,            -- key stays: mappings never break
         data_type = p_data_type,
         aliases = private.clean_field_aliases(p_key, p_aliases),
         updated_at = now()
   WHERE key = p_key;
END;
$$;

CREATE FUNCTION public.set_mapping_field_status(p_key text, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can change the field list' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('ACTIVE', 'HIDDEN') THEN
    RAISE EXCEPTION 'Status must be ACTIVE or HIDDEN' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('oksy.audit_reason', 'Fields page: ' || CASE p_status WHEN 'HIDDEN' THEN 'hide' ELSE 'show' END || ' field', true);
  UPDATE public.mapping_fields SET status = p_status, updated_at = now() WHERE key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No field with key %', p_key USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE FUNCTION public.delete_mapping_field(p_key text)
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
     OR EXISTS (SELECT 1 FROM public.claims_staging WHERE extra_fields ? p_key) THEN
    RAISE EXCEPTION 'In use, hide instead' USING ERRCODE = '23503';
  END IF;
  PERFORM set_config('oksy.audit_reason', 'Fields page: delete unused field', true);
  DELETE FROM public.mapping_fields WHERE key = p_key;
END;
$$;

-- 4. ------------------------------------------------------------------------------------
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

REVOKE EXECUTE ON FUNCTION public.create_mapping_field(text, text, text[]) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.update_mapping_field(text, text, text, text[]) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.set_mapping_field_status(text, text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.delete_mapping_field(text) FROM public, anon;
REVOKE EXECUTE ON FUNCTION private.alias_key(text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.clean_field_aliases(text, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mapping_field(text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_mapping_field(text, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_mapping_field_status(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_mapping_field(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
