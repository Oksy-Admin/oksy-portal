-- Stage 2b: dictionaries and lane 1 fixes (decisions.md section 9, stage-plan.md 2b).
-- Take a backup before applying to live; show this file to Anoop; apply only after his OK.
--
-- What changes:
-- 1. dictionary_entries: one table for status words (per hospital), colours (per hospital),
--    insurer / TPA / department names (one list per scheme for all hospitals), doctor names
--    (per hospital). Raw spelling key -> standard value, status Suggested / Confirmed /
--    Rejected / Retired, evidence, who / when / reason. Unique on (kind, scheme, hospital,
--    key) with NULLS NOT DISTINCT, so a global (hospital_code NULL) spelling has only one
--    standard value. A CONFIRMED row is never overwritten: a change retires it and inserts a
--    new current row (decided_header()-style history); every insert/update is in audit_log
--    (protect_table), tagged with who, when and the reason. No new change_log entry: these
--    are reference-data rows, not a claim's own field (change_log stays claim-scoped).
--    "Forces a full re-read" needs no new code: change detection is already off (1e), so
--    every run already reads the full sheet.
-- 2. decide_dictionary_entry(): Owner, Admin or the Hospitals edit tick decide one spelling
--    (Confirm or Reject). dictionary_entry_batches + bulk_confirm_dictionary() +
--    undo_dictionary_batch(): the 1b-ii "Confirm all" pattern, for status words and doctor
--    names only (the cross-hospital pre-fill the plan asks for; insurer/TPA/department are
--    already one list for every hospital, so there is no "another hospital" to copy from).
-- 3. hospital_profile_facts: tab_stage_facts, tpa_cell_may_hold_insurer, paid_meaning_open_tabs
--    (moved out of the retired packages/worker/src/hms-profile.ts) in their own table, not on
--    hospitals -- 04_worker_grants.test.sql deliberately refuses service_role any right on
--    hospitals, and the worker (sheet-run.ts) must read these every run. hospitals itself
--    gets pod_start_date (decisions.md section 8, POD flags wait for it; not yet read by the
--    worker, so the existing restriction does not apply to it).
-- 4. scheme_insurers: hardcopy_required (decisions.md section 8, "the insurer list"); the
--    worker already has scheme_insurers.SELECT (1d), so no new grant is needed for this one.
-- 5. Seed: HMS's 25-Oct confirmed status words and tab/TPA facts, as CONFIRMED rows and
--    hospitals columns on its real, current code HOSPPVTP0003 -- not the stale
--    HOSP32P000107 in the old code (checked live, read-only, 31-Oct: hospitals and
--    hospital_sheets both key HMS as HOSPPVTP0003; HOSP32P000107 matches nothing live, so
--    hmsProfile() had never actually run for any live sheet -- found on the way, fixed here).
--    Badagara and Tree G (same scheme, no confirmed words of their own yet) get the same
--    spellings as SUGGESTED, pre-filled from HMS, ready for one "Confirm all" click (Policy
--    B + D, decisions.md section 5). A scheme-wide INSURER list from the old insurerKeys
--    array. The old doctorAliasesFrom(questions/answers) path had 0 live rows to migrate
--    (checked read-only): no DOCTOR rows are seeded, the dictionary starts exactly as empty
--    for doctor names as the mechanism it replaces.

-- 1. -------------------------------------------------------------------------------------
CREATE TABLE public.dictionary_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL CHECK (kind IN ('STATUS_WORD', 'COLOUR', 'INSURER', 'TPA', 'DEPARTMENT', 'DOCTOR')),
  scheme         text NOT NULL CHECK (length(trim(scheme)) BETWEEN 1 AND 40),
  -- Per-hospital kinds (status words, colours, doctor names) require a hospital; the
  -- scheme-wide kinds (insurer, TPA, department: one list for every hospital) never have one.
  hospital_code  text REFERENCES public.hospitals (hospital_code) ON UPDATE CASCADE,
  spelling_key   text NOT NULL CHECK (length(spelling_key) BETWEEN 1 AND 120),
  spelling_raw   text NOT NULL,
  standard_value text NOT NULL CHECK (length(trim(standard_value)) BETWEEN 1 AND 160),
  status         text NOT NULL DEFAULT 'SUGGESTED' CHECK (status IN ('SUGGESTED', 'CONFIRMED', 'REJECTED', 'RETIRED')),
  evidence       jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason         text,
  decided_by     uuid,
  decided_at     timestamptz,
  batch_id       uuid,
  superseded_by  uuid REFERENCES public.dictionary_entries (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind IN ('STATUS_WORD', 'COLOUR', 'DOCTOR') AND hospital_code IS NOT NULL)
      OR (kind IN ('INSURER', 'TPA', 'DEPARTMENT') AND hospital_code IS NULL)),
  -- Only a CONFIRMED row is ever applied by the cleaning engine, so only it must already be
  -- a real Stage / ColourMeaning word; a SUGGESTED guess may be any text pending a decision.
  CHECK (status <> 'CONFIRMED' OR kind NOT IN ('STATUS_WORD', 'COLOUR')
      OR (kind = 'STATUS_WORD' AND standard_value IN ('UNDER_TREATMENT', 'UNDER_PROCESSING', 'APPROVED', 'SETTLED', 'REJECTED', 'CANCELLED', 'NOT_WRITTEN'))
      OR (kind = 'COLOUR' AND standard_value IN ('PREAUTH_INITIATED', 'PREAUTH_APPROVED', 'REJECTED_OR_CANCELLED', 'DISCHARGED', 'CLAIM_SUBMITTED', 'PAID')))
);
CREATE UNIQUE INDEX dictionary_entries_one ON public.dictionary_entries (kind, scheme, hospital_code, spelling_key) NULLS NOT DISTINCT WHERE status <> 'RETIRED';
CREATE INDEX dictionary_entries_batch ON public.dictionary_entries (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX dictionary_entries_lookup ON public.dictionary_entries (kind, scheme, hospital_code, status);
ALTER TABLE public.dictionary_entries ENABLE ROW LEVEL SECURITY;
SELECT private.protect_table('public.dictionary_entries', 'id');
-- One audit entry per bulk action (the batch row carries the list), same as header_decisions.
DROP TRIGGER audit ON public.dictionary_entries;
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON public.dictionary_entries
  FOR EACH ROW WHEN (NEW.batch_id IS NULL) EXECUTE FUNCTION private.audit_row('id');

CREATE POLICY dictionary_entries_read ON public.dictionary_entries
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_add_edit')));
GRANT SELECT ON public.dictionary_entries TO authenticated;
-- No INSERT / UPDATE grant for logged-in users: changes only through the functions below.
-- The worker only ever reads and inserts new SUGGESTED rows (dictionary-sync.ts); a decision
-- (Confirm / Reject / undo) is a person, through the SECURITY DEFINER functions above.
GRANT SELECT, INSERT ON public.dictionary_entries TO service_role;

CREATE TABLE public.dictionary_entry_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('STATUS_WORD', 'DOCTOR')),
  scheme        text NOT NULL,
  hospital_code text NOT NULL REFERENCES public.hospitals (hospital_code) ON UPDATE CASCADE,
  -- [{spelling_key, standard_value, from}]: what was confirmed, and from which hospitals.
  items         jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  item_count    integer NOT NULL CHECK (item_count BETWEEN 1 AND 50),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  undone_at     timestamptz,
  undone_by     uuid,
  undone_count  integer
);
ALTER TABLE public.dictionary_entry_batches ENABLE ROW LEVEL SECURITY;
SELECT private.protect_table('public.dictionary_entry_batches', 'id');
CREATE POLICY dictionary_entry_batches_read ON public.dictionary_entry_batches
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_add_edit')));
GRANT SELECT ON public.dictionary_entry_batches TO authenticated;

-- 2. -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_dictionary_entry(
  p_kind text,
  p_scheme text,
  p_hospital_code text,
  p_spelling_key text,
  p_status text,
  p_standard_value text,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_hospital_code text;
  v_existing public.dictionary_entries;
  v_new_id uuid;
BEGIN
  IF NOT private.has_tick('hospitals_add_edit') THEN
    RAISE EXCEPTION 'Only Owner, Admin or users with the Hospitals edit tick can decide dictionary entries' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('STATUS_WORD', 'COLOUR', 'INSURER', 'TPA', 'DEPARTMENT', 'DOCTOR') THEN
    RAISE EXCEPTION 'Unknown dictionary kind: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('CONFIRMED', 'REJECTED') THEN
    RAISE EXCEPTION 'A decision is Confirmed or Rejected' USING ERRCODE = '22023';
  END IF;
  v_hospital_code := CASE WHEN p_kind IN ('INSURER', 'TPA', 'DEPARTMENT') THEN NULL ELSE p_hospital_code END;
  IF v_hospital_code IS NULL AND p_kind IN ('STATUS_WORD', 'COLOUR', 'DOCTOR') THEN
    RAISE EXCEPTION 'A hospital is required for %', p_kind USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.dictionary_entries
   WHERE kind = p_kind AND scheme = p_scheme AND hospital_code IS NOT DISTINCT FROM v_hospital_code
     AND spelling_key = p_spelling_key AND status <> 'RETIRED'
   FOR UPDATE;

  PERFORM set_config('oksy.audit_reason', coalesce(p_reason, 'Dictionary: ' || p_kind || ' decided'), true);

  IF v_existing.id IS NOT NULL AND v_existing.status = 'CONFIRMED' AND p_status = 'CONFIRMED' AND v_existing.standard_value = p_standard_value THEN
    RETURN v_existing.id; -- nothing really changed
  END IF;

  IF v_existing.id IS NOT NULL AND v_existing.status = 'CONFIRMED' THEN
    -- A confirmed entry is never overwritten: retire it first (frees the unique key), then
    -- insert the new current row, then point the old row at it.
    UPDATE public.dictionary_entries SET status = 'RETIRED' WHERE id = v_existing.id;
    INSERT INTO public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status, evidence, reason, decided_by, decided_at)
    VALUES (p_kind, p_scheme, v_hospital_code, p_spelling_key, v_existing.spelling_raw, p_standard_value, p_status, v_existing.evidence, p_reason, auth.uid(), now())
    RETURNING id INTO v_new_id;
    UPDATE public.dictionary_entries SET superseded_by = v_new_id WHERE id = v_existing.id;
    RETURN v_new_id;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    -- SUGGESTED or REJECTED, never yet confirmed: decide it in place (no history needed).
    UPDATE public.dictionary_entries
       SET status = p_status, standard_value = p_standard_value, reason = p_reason,
           decided_by = auth.uid(), decided_at = now(), batch_id = NULL
     WHERE id = v_existing.id;
    RETURN v_existing.id;
  END IF;

  INSERT INTO public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status, reason, decided_by, decided_at)
  VALUES (p_kind, p_scheme, v_hospital_code, p_spelling_key, p_spelling_key, p_standard_value, p_status, p_reason, auth.uid(), now())
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.decide_dictionary_entry(text, text, text, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decide_dictionary_entry(text, text, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_confirm_dictionary(p_kind text, p_scheme text, p_hospital_code text, p_items jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_n integer;
  v_item jsonb;
  v_key text;
  v_value text;
  v_from text[];
  v_list jsonb := '[]'::jsonb;
  v_batch uuid;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can confirm dictionary entries in bulk' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('STATUS_WORD', 'DOCTOR') THEN
    RAISE EXCEPTION 'Bulk confirm is only for status words and doctor names' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Items must be a list' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_items);
  IF v_n < 1 OR v_n > 50 THEN
    RAISE EXCEPTION 'Bulk confirm takes 1 to 50 entries at a time (got %)', v_n USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT x->>'spelling_key') FROM jsonb_array_elements(p_items) x) <> v_n THEN
    RAISE EXCEPTION 'A spelling appears twice in the list' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_key := v_item->>'spelling_key';
    v_value := v_item->>'standard_value';
    IF EXISTS (SELECT 1 FROM public.dictionary_entries
                WHERE kind = p_kind AND scheme = p_scheme AND hospital_code = p_hospital_code
                  AND spelling_key = v_key AND status = 'CONFIRMED') THEN
      RAISE EXCEPTION 'Spelling "%" is already decided; change it on its own row', v_key USING ERRCODE = '23505';
    END IF;
    -- Exact match only: another hospital of the scheme already confirmed this spelling the same way.
    SELECT array_agg(DISTINCT hospital_code ORDER BY hospital_code) INTO v_from
      FROM public.dictionary_entries
     WHERE kind = p_kind AND scheme = p_scheme AND hospital_code <> p_hospital_code
       AND spelling_key = v_key AND status = 'CONFIRMED' AND standard_value = v_value;
    IF v_from IS NULL THEN
      RAISE EXCEPTION 'Spelling "%" has no matching confirmed decision in another hospital of scheme %', v_key, p_scheme USING ERRCODE = '22023';
    END IF;
    v_list := v_list || jsonb_build_object('spelling_key', v_key, 'standard_value', v_value, 'from', to_jsonb(v_from));
  END LOOP;

  PERFORM set_config('oksy.audit_reason', format('Dictionary: bulk confirm of %s %s entries', v_n, p_kind), true);
  INSERT INTO public.dictionary_entry_batches (kind, scheme, hospital_code, items, item_count, created_by)
  VALUES (p_kind, p_scheme, p_hospital_code, v_list, v_n, auth.uid())
  RETURNING id INTO v_batch;

  INSERT INTO public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status, reason, decided_by, decided_at, batch_id)
  SELECT p_kind, p_scheme, p_hospital_code, x->>'spelling_key', x->>'spelling_key', x->>'standard_value', 'CONFIRMED',
         'Confirmed in bulk, same as ' || (SELECT string_agg(f, ', ') FROM jsonb_array_elements_text(x->'from') f),
         auth.uid(), now(), v_batch
    FROM jsonb_array_elements(v_list) x
  ON CONFLICT (kind, scheme, hospital_code, spelling_key) WHERE status <> 'RETIRED' DO UPDATE
     SET standard_value = EXCLUDED.standard_value, status = 'CONFIRMED', reason = EXCLUDED.reason,
         decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at, batch_id = EXCLUDED.batch_id;
  RETURN v_batch;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bulk_confirm_dictionary(text, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bulk_confirm_dictionary(text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.undo_dictionary_batch(p_batch_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_batch public.dictionary_entry_batches;
  v_count integer;
BEGIN
  IF NOT private.has_role('ADMIN') THEN
    RAISE EXCEPTION 'Only Owner or Admin can undo a bulk confirm' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_batch FROM public.dictionary_entry_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No bulk confirm with this id' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'This bulk confirm was already undone' USING ERRCODE = '22023';
  END IF;

  -- An entry someone decided on its own row since then has batch_id NULL (cleared by
  -- decide_dictionary_entry): it stays. The rest go back to Suggested (undo = undecided again).
  UPDATE public.dictionary_entries
     SET status = 'SUGGESTED', decided_by = NULL, decided_at = NULL
   WHERE batch_id = p_batch_id AND status = 'CONFIRMED';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('oksy.audit_reason', format('Dictionary: bulk confirm undone (%s entries)', v_count), true);
  UPDATE public.dictionary_entry_batches
     SET undone_at = now(), undone_by = auth.uid(), undone_count = v_count
   WHERE id = p_batch_id;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.undo_dictionary_batch(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.undo_dictionary_batch(uuid) TO authenticated;

-- 3. -------------------------------------------------------------------------------------
CREATE TABLE public.hospital_profile_facts (
  hospital_code             text PRIMARY KEY REFERENCES public.hospitals (hospital_code) ON UPDATE CASCADE,
  -- Tab -> stage, only where the hospital confirmed it (HMS: every PAID row is paid).
  tab_stage_facts           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Confirmed: a TPA cell holding an insurer name means no separate TPA (HMS 25-Oct).
  tpa_cell_may_hold_insurer boolean NOT NULL DEFAULT false,
  -- Tabs whose paid cell meaning (gross or net) is still an open question: no Discount 2.
  paid_meaning_open_tabs    text[] NOT NULL DEFAULT '{}',
  updated_at                timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hospital_profile_facts ENABLE ROW LEVEL SECURITY;
SELECT private.protect_table('public.hospital_profile_facts', 'hospital_code');
CREATE POLICY hospital_profile_facts_read ON public.hospital_profile_facts
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_view')));
GRANT SELECT ON public.hospital_profile_facts TO authenticated;
GRANT SELECT ON public.hospital_profile_facts TO service_role;

ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS pod_start_date date;

-- 4. -------------------------------------------------------------------------------------
ALTER TABLE public.scheme_insurers
  ADD COLUMN IF NOT EXISTS hardcopy_required boolean;

-- 5. -------------------------------------------------------------------------------------
SELECT set_config('oksy.audit_reason', 'Stage 2b: HMS confirmed facts moved out of code (25-Oct hospital answers)', true);
INSERT INTO public.hospital_profile_facts (hospital_code, tab_stage_facts, tpa_cell_may_hold_insurer)
SELECT 'HOSPPVTP0003', '{"PAID": "SETTLED"}'::jsonb, true
 WHERE EXISTS (SELECT 1 FROM public.hospitals WHERE hospital_code = 'HOSPPVTP0003')
ON CONFLICT (hospital_code) DO UPDATE
   SET tab_stage_facts = EXCLUDED.tab_stage_facts, tpa_cell_may_hold_insurer = EXCLUDED.tpa_cell_may_hold_insurer;

-- Guarded by EXISTS: a fresh database (CI, scripts/db-test-local.sh) has no hospitals rows
-- yet (they are entered through the app, not seeded by a migration); these seeds then
-- insert nothing, same as migrate_header_decisions() finding no column_mappings to move.
WITH words(spelling_key, standard_value) AS (
  VALUES ('paid', 'SETTLED'), ('settled', 'SETTLED'), ('setteled', 'SETTLED'), ('fullypaid', 'SETTLED'),
         ('claimapproved', 'APPROVED'), ('settelmentapproved', 'APPROVED'), ('settlementapproved', 'APPROVED'),
         ('na', 'NOT_WRITTEN'), ('0', 'NOT_WRITTEN')
)
INSERT INTO public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status, evidence, reason, decided_at)
SELECT 'STATUS_WORD', 'PRIVATE', 'HOSPPVTP0003', spelling_key, spelling_key, standard_value, 'CONFIRMED',
       jsonb_build_object('source', '25-Oct hospital answers'), 'Stage 2b migration: moved out of hms-profile.ts', now()
  FROM words
 WHERE EXISTS (SELECT 1 FROM public.hospitals WHERE hospital_code = 'HOSPPVTP0003')
ON CONFLICT (kind, scheme, hospital_code, spelling_key) WHERE status <> 'RETIRED' DO NOTHING;

-- Policy B + D pre-fill (decisions.md section 5): the same words, Suggested, for the scheme's
-- other hospitals, ready for one "Confirm all" click once their own data is read.
WITH words(spelling_key, standard_value) AS (
  VALUES ('paid', 'SETTLED'), ('settled', 'SETTLED'), ('setteled', 'SETTLED'), ('fullypaid', 'SETTLED'),
         ('claimapproved', 'APPROVED'), ('settelmentapproved', 'APPROVED'), ('settlementapproved', 'APPROVED'),
         ('na', 'NOT_WRITTEN'), ('0', 'NOT_WRITTEN')
), targets(hospital_code) AS (VALUES ('HOSPPVTP0001'), ('HOSPPVTP0002'))
INSERT INTO public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status, evidence)
SELECT 'STATUS_WORD', 'PRIVATE', t.hospital_code, w.spelling_key, w.spelling_key, w.standard_value, 'SUGGESTED',
       jsonb_build_object('source', 'pre-filled from HOSPPVTP0003 (same scheme)')
  FROM words w, targets t
 WHERE EXISTS (SELECT 1 FROM public.hospitals WHERE hospital_code = t.hospital_code)
ON CONFLICT (kind, scheme, hospital_code, spelling_key) WHERE status <> 'RETIRED' DO NOTHING;

-- Scheme-wide insurer recognition list (was insurerKeys in hms-profile.ts): lets the engine
-- tell an insurer name typed in the TPA cell apart (decisions.md section 9 "HMS 25-Oct").
WITH insurers(spelling_key, standard_value) AS (
  VALUES ('star', 'Star Health'), ('newindia', 'New India Assurance'), ('unitedindia', 'United India Insurance'),
         ('national', 'National Insurance'), ('oriental', 'Oriental Insurance'), ('iffco', 'IFFCO Tokio'),
         ('icici', 'ICICI Lombard'), ('hdfc', 'HDFC ERGO'), ('bajaj', 'Bajaj Allianz'), ('careh', 'Care Health Insurance'),
         ('niva', 'Niva Bupa'), ('aditya', 'Aditya Birla Health Insurance'), ('manipal', 'Manipal Cigna'),
         ('sbigeneral', 'SBI General Insurance'), ('tata', 'Tata AIG'), ('reliance', 'Reliance General Insurance'),
         ('royal', 'Royal Sundaram'), ('chola', 'Cholamandalam MS'), ('universalsompo', 'Universal Sompo'),
         ('liberty', 'Liberty General Insurance'), ('futuregenerali', 'Future Generali'), ('kotak', 'Kotak Mahindra General Insurance'),
         ('galaxy', 'Galaxy Health Insurance'), ('magma', 'Magma HDI'), ('zuno', 'Zuno General Insurance'),
         ('acko', 'Acko General Insurance'), ('digit', 'Go Digit General Insurance')
)
INSERT INTO public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status, evidence, reason, decided_at)
SELECT 'INSURER', 'PRIVATE', NULL, spelling_key, standard_value, standard_value, 'CONFIRMED',
       jsonb_build_object('source', '25-Oct hospital answers'), 'Stage 2b migration: moved out of hms-profile.ts (insurerKeys)', now()
  FROM insurers
ON CONFLICT (kind, scheme, hospital_code, spelling_key) WHERE status <> 'RETIRED' DO NOTHING;

NOTIFY pgrst, 'reload schema';
