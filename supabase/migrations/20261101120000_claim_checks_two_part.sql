-- Stage 2c: claim checks, two-part approvals, "value is correct" (decisions.md sections 7
-- and 9; stage-plan.md 2c). Anoop's decisions of 1-Nov-2026.
-- Backup first; apply to live only after Anoop's OK (CLAUDE.md "Schema changes").

-------------------------------------------------------------------------------
-- 1. POD Start Date moves to hospital_profile_facts (decisions.md section 8): the worker has
--    no read right on `hospitals` (04_worker_grants.test.sql) and R-K06 below needs to read
--    it every run. `hospitals.pod_start_date` (added 2b) is left in place, unused, same as
--    every other retired/superseded column; hospital_profile_facts.pod_start_date is the one
--    the engine reads from now on. Existing values are copied over.
-------------------------------------------------------------------------------
ALTER TABLE public.hospital_profile_facts
  ADD COLUMN IF NOT EXISTS pod_start_date date;
COMMENT ON COLUMN public.hospitals.pod_start_date IS
  'Superseded 1-Nov (Stage 2c): the worker cannot read this table. See hospital_profile_facts.pod_start_date.';

UPDATE public.hospital_profile_facts f
   SET pod_start_date = h.pod_start_date
  FROM public.hospitals h
 WHERE h.hospital_code = f.hospital_code
   AND h.pod_start_date IS NOT NULL
   AND f.pod_start_date IS NULL;
-- A hospital with facts not yet created (no row at all) has no POD Start Date to copy either;
-- the Rule Library / a future hospital-facts page is where Anoop sets this from here on.

-------------------------------------------------------------------------------
-- 2. claims_staging: two fields that were mappable but never actually read or stored (found
--    on the way, needed for R-K04/R-K05 below); the two-part link column (decisions.md
--    section 7, 1-Nov).
-------------------------------------------------------------------------------
ALTER TABLE public.claims_staging
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS policy_holder_name text,
  ADD COLUMN IF NOT EXISTS courier_no text,
  ADD COLUMN IF NOT EXISTS combined_into_record_uid uuid REFERENCES public.claims_staging (record_uid);
COMMENT ON COLUMN public.claims_staging.phone_number IS
  'Stage 2c: a mappable field (fields.ts) that clean.ts never read before; needed for R-K04.';
COMMENT ON COLUMN public.claims_staging.policy_holder_name IS
  'Stage 2c: a mappable field (fields.ts) that clean.ts never read before; needed for R-K05.';
COMMENT ON COLUMN public.claims_staging.courier_no IS
  'POD Number (column-dictionary.md section 1): a mappable field that clean.ts never read before; needed for R-K06.';
COMMENT ON COLUMN public.claims_staging.combined_into_record_uid IS
  'Two-part approval (decisions.md section 7, 1-Nov): set on the secondary part once a person '
  'confirms the claim_links row. The row is never deleted; the claims page and reports show '
  'the primary row only. NULL = this row is not folded into another.';
CREATE INDEX IF NOT EXISTS claims_staging_combined_into ON public.claims_staging (combined_into_record_uid) WHERE combined_into_record_uid IS NOT NULL;

-------------------------------------------------------------------------------
-- 3. issues.status gets a third value: CONFIRMED (decisions.md section 9, "value is
--    correct"). The row stays (the condition still fires every run); a person has recorded
--    it is fine. Never counted as open in "clean = zero Errors and zero Warnings".
-------------------------------------------------------------------------------
ALTER TABLE public.issues DROP CONSTRAINT issues_status_check;
ALTER TABLE public.issues ADD CONSTRAINT issues_status_check CHECK (status IN ('OPEN', 'CONFIRMED', 'RESOLVED'));

-------------------------------------------------------------------------------
-- 4. issue_confirmations: "value is correct" (decisions.md section 9). Append-only, like
--    change_log and snapshots; the latest row per (record_uid, rule_id, field) is the current
--    confirmation. The worker compares its fingerprint against the value read fresh each run
--    (packages/rules/src/confirmations.ts); a mismatch means the value changed, so the
--    Warning is open again (never silently kept confirmed against a different value).
-------------------------------------------------------------------------------
CREATE TABLE public.issue_confirmations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_uid    uuid NOT NULL REFERENCES public.claims_staging (record_uid),
  rule_id       text NOT NULL,
  field         text NOT NULL,
  fingerprint   text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  reason        text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  confirmed_by  uuid NOT NULL DEFAULT auth.uid(),
  confirmed_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.issue_confirmations ENABLE ROW LEVEL SECURITY;
CREATE INDEX issue_confirmations_latest ON public.issue_confirmations (record_uid, rule_id, field, confirmed_at DESC);
CREATE TRIGGER issue_confirmations_no_update BEFORE UPDATE ON public.issue_confirmations
  FOR EACH ROW EXECUTE FUNCTION private.forbid_log_change();
CREATE TRIGGER issue_confirmations_no_delete BEFORE DELETE ON public.issue_confirmations
  FOR EACH ROW EXECUTE FUNCTION private.forbid_log_change();
CREATE POLICY issue_confirmations_read ON public.issue_confirmations
  FOR SELECT TO authenticated
  USING (private.has_role('ADMIN'));
GRANT SELECT ON public.issue_confirmations TO authenticated;
GRANT SELECT, INSERT ON public.issue_confirmations TO service_role;

-- Owner/Admin only for 2c (no clean-data action tick exists yet; decisions.md section 3 can
-- add one later if Users should do this too). Rejects an Error outright (hard rule: "Errors
-- cannot be confirmed away", decisions.md section 9).
CREATE FUNCTION public.confirm_issue(p_record_uid uuid, p_rule_id text, p_field text, p_fingerprint text, p_reason text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_issue public.issues;
  v_id    bigint;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can confirm an issue' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_issue FROM public.issues
   WHERE record_uid = p_record_uid AND rule_id = p_rule_id AND field = p_field;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such issue' USING ERRCODE = 'P0002';
  END IF;
  IF v_issue.severity = 'E' THEN
    RAISE EXCEPTION 'An Error cannot be confirmed away' USING ERRCODE = '42501';
  END IF;
  IF v_issue.status = 'RESOLVED' THEN
    RAISE EXCEPTION 'This issue is already resolved (the condition stopped firing)' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('oksy.audit_reason', p_reason, true);
  INSERT INTO public.issue_confirmations (record_uid, rule_id, field, fingerprint, reason)
  VALUES (p_record_uid, p_rule_id, p_field, p_fingerprint, p_reason)
  RETURNING id INTO v_id;
  UPDATE public.issues SET status = 'CONFIRMED' WHERE record_uid = p_record_uid AND rule_id = p_rule_id AND field = p_field;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.confirm_issue(uuid, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_issue(uuid, text, text, text, text) TO authenticated;

-------------------------------------------------------------------------------
-- 5. claim_links: two-part approval candidates (decisions.md section 7, 1-Nov: "combine only
--    after a person confirms"). Keyed by record_key, not record_uid: the worker detects a
--    candidate before either row has been upserted (and so before a record_uid exists), and
--    record_key is stable across runs for the same claim. SUGGESTED rows are inserted by the
--    worker (never overwriting a human decision); a person decides with decide_claim_link().
-------------------------------------------------------------------------------
CREATE TABLE public.claim_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_code         text NOT NULL REFERENCES public.hospitals (hospital_code),
  scheme                text NOT NULL,
  kind                  text NOT NULL DEFAULT 'TWO_PART_APPROVAL' CHECK (kind IN ('TWO_PART_APPROVAL')),
  primary_record_key    text NOT NULL,
  secondary_record_key  text NOT NULL,
  status                text NOT NULL DEFAULT 'SUGGESTED' CHECK (status IN ('SUGGESTED', 'CONFIRMED', 'REJECTED')),
  evidence              jsonb NOT NULL DEFAULT '{}',  -- amounts, dates, UTRs only: never patient data
  decided_by            uuid,
  decided_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (primary_record_key, secondary_record_key)
);
ALTER TABLE public.claim_links ENABLE ROW LEVEL SECURITY;
CREATE INDEX claim_links_hospital ON public.claim_links (hospital_code, scheme, status);
CREATE POLICY claim_links_read ON public.claim_links
  FOR SELECT TO authenticated
  USING (private.has_role('ADMIN'));
GRANT SELECT ON public.claim_links TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.claim_links TO service_role;

CREATE FUNCTION public.decide_claim_link(p_primary_record_key text, p_secondary_record_key text, p_decision text, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can decide a two-part match' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('CONFIRMED', 'REJECTED') THEN
    RAISE EXCEPTION 'Decision must be CONFIRMED or REJECTED' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('oksy.audit_reason', p_reason, true);
  UPDATE public.claim_links
     SET status = p_decision, decided_by = auth.uid(), decided_at = now()
   WHERE primary_record_key = p_primary_record_key AND secondary_record_key = p_secondary_record_key
  RETURNING id INTO v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such candidate' USING ERRCODE = 'P0002';
  END IF;
  -- Applying a CONFIRMED decision to the two claims_staging rows happens on the next run
  -- (packages/rules/src/two-part.ts): a decision never edits patient data by itself.
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.decide_claim_link(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decide_claim_link(text, text, text, text) TO authenticated;

-------------------------------------------------------------------------------
-- 6. Rule Library: R-Y03's wording moves into the library (it was deliberately kept running
--    from code and left ACTIVE by the 2a migration); two new cross-row structural rules;
--    Anoop's 3 new rules (1-Nov). check_definition stays NULL for the three structural ones
--    (R-Y03, R-K01, R-K02): the comparison itself is still in code (packages/worker/src/
--    identity.ts, packages/rules/src/two-part.ts), the same allowed exception as R-C01/R-N02;
--    only their severity, action and staff_message are now read from here, which R-C01/R-N02
--    still do not do (unchanged, out of scope).
-------------------------------------------------------------------------------
INSERT INTO public.rules (rule_id, rule_type, title) VALUES
  ('R-Y03', 'CHECK', 'Same patient with the same admission date under another claim number'),
  ('R-K01', 'CHECK', 'Same UTR appears on more than one claim'),
  ('R-K02', 'CHECK', 'Same claim (claim number, admission and discharge date) repeats with different values'),
  ('R-K04', 'CHECK', 'Policy number equals phone number'),
  ('R-K05', 'CHECK', 'Policy Holder Name empty with a claim number present'),
  ('R-K06', 'CHECK', 'POD Number empty while Hardcopy Sent Date is present')
ON CONFLICT (rule_id) DO UPDATE SET rule_type = EXCLUDED.rule_type, title = EXCLUDED.title;

ALTER TABLE public.rule_versions DISABLE TRIGGER guard_rule_status;
UPDATE public.rule_versions SET status = 'RETIRED' WHERE rule_id = 'R-Y03' AND status <> 'RETIRED';
ALTER TABLE public.rule_versions ENABLE TRIGGER guard_rule_status;

INSERT INTO public.rule_versions
  (rule_id, version, status, severity, condition_text, check_definition, action, staff_message, approved_by, approver_note)
SELECT v.rule_id, coalesce(mv.max_version, 0) + 1, v.status, v.severity, v.condition_text, v.check_definition::jsonb, v.action, v.staff_message,
  (SELECT id FROM auth.users WHERE email = 'anoop@oksy.in'), 'Stage 2c, Anoop''s decisions of 1-Nov-2026'
FROM (VALUES
  ('R-Y03'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity,
   'Cross-row: same claim identity on two rows, same patient and admission date, different claim number (packages/worker/src/identity.ts).'::text,
   NULL::text, 'ASK_STAFF'::text, 'Same patient with the same admission date under another claim number.'::text),
  ('R-K01'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity,
   'Cross-row: the same UTR appears on more than one claim in this hospital''s run (packages/worker/src/identity.ts).',
   NULL, 'ASK_STAFF', 'Same UTR appears on more than one claim: please confirm this is not a data entry error.'),
  ('R-K02'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity,
   'Cross-row: same claim identity (claim number, admission and discharge date) on two rows with different values (packages/worker/src/identity.ts). Was hard-coded under R-Y03 before 1-Nov; split off so R-Y03''s own message (same patient, same admission date) is not shown for this case too.',
   NULL, 'ASK_STAFF', 'Same claim (claim number, admission and discharge date) on more than one row with different values.'),
  ('R-K04'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, NULL,
   '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"policy_or_card_no","operator":"EQUALS","compareField":"phone_number"}],"issueField":"policy_or_card_no"}',
   'ASK_STAFF', 'Policy number is the same as the phone number: please confirm this is correct.'),
  ('R-K05'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, NULL,
   '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"policy_holder_name","operator":"EMPTY"},{"field":"preauth_or_claim_no","operator":"NOT_EMPTY"}],"issueField":"policy_holder_name"}',
   'ASK_STAFF', 'Policy Holder Name is empty but a claim number is present.'),
  ('R-K06'::text, 'ACTIVE'::public.rule_status, 'W'::public.rule_severity, NULL,
   '{"kind":"SIMPLE","logic":"AND","conditions":[{"field":"courier_no","operator":"EMPTY"},{"field":"casesheet_sent_date","operator":"NOT_EMPTY"},{"field":"casesheet_sent_date","operator":"AFTER","compareField":"pod_start_date"}],"issueField":"courier_no"}',
   'ASK_STAFF', 'Hardcopy was sent on {casesheet_sent_date} but no POD Number is recorded.')
) AS v(rule_id, status, severity, condition_text, check_definition, action, staff_message)
LEFT JOIN (SELECT rule_id, max(version) AS max_version FROM public.rule_versions GROUP BY rule_id) mv ON mv.rule_id = v.rule_id;
