-- Stage 2e: rule trial and check sets (stage-plan.md "2e - Rule trial and check sets",
-- decisions.md section 9 "Rule trial before questions go out"). Backup first; apply to live
-- only after Anoop's OK (CLAUDE.md "Schema changes").
--
-- 1. rule_trials: "Run now" with trial for one hospital (stage-plan 2e) -- every ACTIVE rule
--    run once against the hospital's stored claims (packages/worker/src/rule-trial-runner.ts),
--    never inside the page request, same reasoning as rule_test_runs (2d). Owner approves a
--    finished trial once; Stage 4 checks approved_at before a hospital's first questions go out.
-- 2. check_set_claims: the 5 claims per pilot Anoop knows are correct, with their key values
--    at pick time. Every write goes through pick_check_set_claim / accept_check_set_claim
--    (SECURITY DEFINER, Owner/Admin only); pass/fail itself is computed live on the trial page
--    from the claim's current values and open issues, never cached here, so it can never go
--    stale (packages/rules/src/check-set.ts).

-------------------------------------------------------------------------------
-- 1. rule_trials
-------------------------------------------------------------------------------
CREATE TABLE public.rule_trials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_code text NOT NULL REFERENCES public.hospitals (hospital_code),
  requested_by  uuid DEFAULT auth.uid(),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  status        public.job_status NOT NULL DEFAULT 'QUEUED',
  -- Per rule: severity, claims hit, up to 5 {tab, row} references; plus total/clean claim
  -- counts. Never a patient name or a cell value (hard rules 1, 10).
  summary       jsonb,
  error         text CHECK (length(error) <= 500),
  approved_at   timestamptz,
  approved_by   uuid
);
ALTER TABLE public.rule_trials ENABLE ROW LEVEL SECURITY;
SELECT private.protect_table('public.rule_trials', 'id');
CREATE INDEX rule_trials_status ON public.rule_trials (status, requested_at);
CREATE INDEX rule_trials_hospital ON public.rule_trials (hospital_code, requested_at DESC);

CREATE POLICY rule_trials_read ON public.rule_trials
  FOR SELECT TO authenticated USING ((SELECT private.has_tick('rule_library_view')));
CREATE POLICY rule_trials_insert ON public.rule_trials
  FOR INSERT TO authenticated WITH CHECK ((SELECT private.has_tick('rule_library_add_edit')) AND requested_by = (SELECT auth.uid()));
GRANT SELECT, INSERT ON public.rule_trials TO authenticated;
-- The worker claims and finishes a trial (status/summary/timestamps) with the service key,
-- same grant shape as rule_test_runs.
GRANT SELECT, UPDATE ON public.rule_trials TO service_role;

-- Owner/Admin only (has_role('ADMIN') already passes Owner too): "Owner approves once" over
-- a finished trial, recorded with who and when (stage-plan 2e).
CREATE FUNCTION public.approve_rule_trial(p_trial_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_trial public.rule_trials;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can approve a rule trial' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_trial FROM public.rule_trials WHERE id = p_trial_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such rule trial' USING ERRCODE = 'P0002';
  END IF;
  IF v_trial.status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'Only a finished trial can be approved' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('oksy.audit_reason', coalesce(p_note, format('Rule trial approved for %s', v_trial.hospital_code)), true);
  UPDATE public.rule_trials SET approved_at = now(), approved_by = auth.uid() WHERE id = p_trial_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.approve_rule_trial(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_rule_trial(uuid, text) TO authenticated;

-------------------------------------------------------------------------------
-- 2. check_set_claims: picked by hand (search by claim number), at most 5 per hospital.
--    key_values mirrors packages/rules/src/check-set.ts's KEY_VALUE_FIELDS exactly; the
--    trial page reads the current claims_staging row and open issues and compares live.
-------------------------------------------------------------------------------
CREATE TABLE public.check_set_claims (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_code     text NOT NULL REFERENCES public.hospitals (hospital_code),
  record_uid        uuid NOT NULL REFERENCES public.claims_staging (record_uid),
  claim_number      text,
  key_values        jsonb NOT NULL,
  picked_by         uuid NOT NULL DEFAULT auth.uid(),
  picked_at         timestamptz NOT NULL DEFAULT now(),
  accepted_at       timestamptz,
  accepted_by       uuid,
  accepted_reason   text CHECK (length(accepted_reason) <= 500),
  UNIQUE (hospital_code, record_uid)
);
ALTER TABLE public.check_set_claims ENABLE ROW LEVEL SECURITY;
SELECT private.protect_table('public.check_set_claims', 'id');
CREATE INDEX check_set_claims_hospital ON public.check_set_claims (hospital_code);

CREATE POLICY check_set_claims_read ON public.check_set_claims
  FOR SELECT TO authenticated USING ((SELECT private.has_tick('rule_library_view')));
GRANT SELECT ON public.check_set_claims TO authenticated;
-- No INSERT/UPDATE grant to authenticated at all: pick_check_set_claim and
-- accept_check_set_claim (both SECURITY DEFINER) are the only way in, same shape as
-- claim_links / decide_claim_link (2c).

CREATE FUNCTION public.pick_check_set_claim(p_record_uid uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claim public.claims_staging;
  v_count integer;
  v_id uuid;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can pick a check-set claim' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_claim FROM public.claims_staging WHERE record_uid = p_record_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such claim' USING ERRCODE = 'P0002';
  END IF;
  SELECT count(*) INTO v_count FROM public.check_set_claims WHERE hospital_code = v_claim.hospital_code;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'Already 5 check-set claims picked for %', v_claim.hospital_code USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('oksy.audit_reason', format('Check-set claim picked: %s', coalesce(v_claim.preauth_or_claim_no, p_record_uid::text)), true);
  INSERT INTO public.check_set_claims (hospital_code, record_uid, claim_number, key_values)
  VALUES (
    v_claim.hospital_code, p_record_uid, v_claim.preauth_or_claim_no,
    jsonb_build_object(
      'claim_status', v_claim.claim_status, 'bill_amount', v_claim.bill_amount, 'claimed_amount', v_claim.claimed_amount,
      'approved_amount', v_claim.approved_amount, 'discount_amount', v_claim.discount_amount, 'deduction_amount', v_claim.deduction_amount,
      'settled_amount', v_claim.settled_amount, 'tds_amount', v_claim.tds_amount, 'expected_tds_amount', v_claim.expected_tds_amount,
      'expected_settlement_amount', v_claim.expected_settlement_amount, 'balance_amount', v_claim.balance_amount,
      'admission_date', v_claim.admission_date, 'discharge_date', v_claim.discharge_date, 'settlement_date', v_claim.settlement_date,
      'utr_no', v_claim.utr_no, 'rejection_reason', v_claim.rejection_reason, 'cancellation_reason', v_claim.cancellation_reason
    )
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pick_check_set_claim(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pick_check_set_claim(uuid) TO authenticated;

-- "A value that changed for a real reason (for example a new payment)": one click per claim,
-- with a reason (decisions.md section 9, human decisions record a reason) -- re-snapshots the
-- claim's current values so the next check starts from them, same as a fresh pick.
CREATE FUNCTION public.accept_check_set_claim(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_set public.check_set_claims;
  v_claim public.claims_staging;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can accept new values for a check-set claim' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to accept new values' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_set FROM public.check_set_claims WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such check-set claim' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_claim FROM public.claims_staging WHERE record_uid = v_set.record_uid;
  PERFORM set_config('oksy.audit_reason', p_reason, true);
  UPDATE public.check_set_claims SET
    key_values = jsonb_build_object(
      'claim_status', v_claim.claim_status, 'bill_amount', v_claim.bill_amount, 'claimed_amount', v_claim.claimed_amount,
      'approved_amount', v_claim.approved_amount, 'discount_amount', v_claim.discount_amount, 'deduction_amount', v_claim.deduction_amount,
      'settled_amount', v_claim.settled_amount, 'tds_amount', v_claim.tds_amount, 'expected_tds_amount', v_claim.expected_tds_amount,
      'expected_settlement_amount', v_claim.expected_settlement_amount, 'balance_amount', v_claim.balance_amount,
      'admission_date', v_claim.admission_date, 'discharge_date', v_claim.discharge_date, 'settlement_date', v_claim.settlement_date,
      'utr_no', v_claim.utr_no, 'rejection_reason', v_claim.rejection_reason, 'cancellation_reason', v_claim.cancellation_reason
    ),
    accepted_at = now(), accepted_by = auth.uid(), accepted_reason = p_reason
  WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.accept_check_set_claim(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.accept_check_set_claim(uuid, text) TO authenticated;
