-- Correction: DEPARTMENT dictionary entry 'cardio' (scheme PRIVATE, scheme-wide) was confirmed
-- 10-Nov-2026 16:44:32 UTC by anoop@oksy.in with standard_value 'CARDIO' -- the raw spelling,
-- not a real standard name. The correct value is 'Cardiology' (decisions.md section 18,
-- claude/reference/dictionary-actions-2026-11-10.xlsx, Action = CONFIRM). Root cause: the
-- worker's DEPARTMENT guess function (dictionary-sync.ts) never looked up the directory's
-- standard name, so the SUGGESTED row's standard_value was already just the raw spelling
-- before anyone decided it; the Dictionary page's Confirm box then carried that value through
-- unedited (see report; not fixed here).
--
-- Fix mirrors decide_dictionary_entry()'s own CONFIRMED -> CONFIRMED-with-a-different-value
-- path: a confirmed row is never overwritten in place. Retire the wrong row, insert the right
-- one, link the two with superseded_by. Full history stays in dictionary_entries and audit_log.
--
-- Not in scope here: 8 Badagara (HOSPPVTP0001) claims in claims_staging already have
-- department = 'CARDIO' written from this entry (checked read-only, 10-Nov-2026) -- matches
-- the entry's evidence.count of 8. Correcting those needs a separate decision (re-clean vs.
-- leave as historical) -- not touched by this migration.
--
-- Take a backup; show this file to Anoop; apply to live only after his OK.

SELECT set_config(
  'oksy.audit_reason',
  'Dictionary correction: DEPARTMENT ''cardio'' was confirmed as CARDIO (raw spelling) instead of Cardiology (decisions.md section 18, dictionary-actions-2026-11-10.xlsx)',
  true
);

UPDATE public.dictionary_entries
   SET status = 'RETIRED'
 WHERE id = 'b3a96ab6-004e-403f-89ef-ecd53ce56aa8'
   AND kind = 'DEPARTMENT'
   AND scheme = 'PRIVATE'
   AND hospital_code IS NULL
   AND spelling_key = 'cardio'
   AND standard_value = 'CARDIO'
   AND status = 'CONFIRMED';

WITH new_row AS (
  INSERT INTO public.dictionary_entries (kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status, evidence, reason, decided_by, decided_at)
  SELECT kind, scheme, hospital_code, spelling_key, spelling_raw, 'Cardiology', 'CONFIRMED', evidence,
         'Correction: standard value fixed from CARDIO to Cardiology (decisions.md section 18, dictionary-actions-2026-11-10.xlsx)',
         decided_by, now()
    FROM public.dictionary_entries
   WHERE id = 'b3a96ab6-004e-403f-89ef-ecd53ce56aa8'
     AND status = 'RETIRED'
  RETURNING id
)
UPDATE public.dictionary_entries
   SET superseded_by = (SELECT id FROM new_row)
 WHERE id = 'b3a96ab6-004e-403f-89ef-ecd53ce56aa8';
