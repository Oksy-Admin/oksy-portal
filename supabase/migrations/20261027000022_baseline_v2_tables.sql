-- Stage 2 baseline: record 4 tables that exist in the live database but have
-- no migration file (stage0_report.md section 2). Recreated from the live schema
-- of project ciorqudslbprfzxedcfy as read on 2026-10-27 (read-only queries).
-- Idempotent: on the live database every statement is a no-op.
--
-- Depends on public.hospitals.hospital_key (uuid NOT NULL DEFAULT gen_random_uuid(),
-- UNIQUE hospitals_hospital_key_uniq), which is also live-only. The two foreign
-- keys below are added only when that column exists.
--
-- Live state copied as-is, not improved here:
--   - hospital_id_history, report_downloads, rule_upload_batches have RLS on and
--     no policies (advisor 0008), so only the table owner can read or write them.
--   - None of the 4 tables has protect_table() (no-delete / audit triggers).

-------------------------------------------------------------------------------
-- 1. version_groups
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.version_groups (
  version_group text        NOT NULL,
  header_fp     text        NOT NULL,
  headers       jsonb       NOT NULL,
  hospital_code text,
  tab_name      text,
  status        text        NOT NULL DEFAULT 'PROPOSED',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT version_groups_pkey PRIMARY KEY (version_group),
  CONSTRAINT version_groups_header_fp_key UNIQUE (header_fp),
  CONSTRAINT version_groups_status_check
    CHECK (status = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'RETIRED'::text]))
);
ALTER TABLE public.version_groups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'version_groups' AND policyname = 'version_groups_read'
  ) THEN
    CREATE POLICY version_groups_read ON public.version_groups
      FOR SELECT TO authenticated
      USING ((SELECT private.has_role('ADMIN', 'APPROVER', 'HELPER')));
  END IF;
END $$;

-------------------------------------------------------------------------------
-- 2. hospital_id_history
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hospital_id_history (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  hospital_key    uuid        NOT NULL,
  old_hospital_id text        NOT NULL,
  new_hospital_id text        NOT NULL,
  changed_by      uuid,
  changed_on      timestamptz NOT NULL DEFAULT now(),
  reason          text,
  CONSTRAINT hospital_id_history_pkey PRIMARY KEY (id)
);
ALTER TABLE public.hospital_id_history ENABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- 3. rule_upload_batches
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rule_upload_batches (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  file_name     text        NOT NULL,
  uploaded_by   uuid,
  uploaded_on   timestamptz NOT NULL DEFAULT now(),
  total_rows    integer     NOT NULL DEFAULT 0,
  accepted_rows integer     NOT NULL DEFAULT 0,
  rejected_rows integer     NOT NULL DEFAULT 0,
  CONSTRAINT rule_upload_batches_pkey PRIMARY KEY (id)
);
ALTER TABLE public.rule_upload_batches ENABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- 4. report_downloads
-------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_downloads (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  hospital_key      uuid,
  shown_hospital_id text        NOT NULL,
  downloaded_by     uuid,
  downloaded_on     timestamptz NOT NULL DEFAULT now(),
  file_type         text,
  row_count         integer,
  CONSTRAINT report_downloads_pkey PRIMARY KEY (id),
  CONSTRAINT report_downloads_file_type_check
    CHECK (file_type = ANY (ARRAY['EXCEL'::text, 'CSV'::text]))
);
ALTER TABLE public.report_downloads ENABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- 5. Foreign keys to hospitals(hospital_key), only when that column exists
-------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.hospitals'::regclass AND attname = 'hospital_key' AND NOT attisdropped
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hospital_id_history_fk'
                    AND conrelid = 'public.hospital_id_history'::regclass) THEN
      ALTER TABLE public.hospital_id_history
        ADD CONSTRAINT hospital_id_history_fk FOREIGN KEY (hospital_key) REFERENCES public.hospitals(hospital_key);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_downloads_fk'
                    AND conrelid = 'public.report_downloads'::regclass) THEN
      ALTER TABLE public.report_downloads
        ADD CONSTRAINT report_downloads_fk FOREIGN KEY (hospital_key) REFERENCES public.hospitals(hospital_key);
    END IF;
  ELSE
    RAISE NOTICE 'hospitals.hospital_key missing: foreign keys on hospital_id_history and report_downloads not added';
  END IF;
END $$;

-------------------------------------------------------------------------------
-- 6. Grants, matching live (REVOKE/GRANT are idempotent)
-------------------------------------------------------------------------------
REVOKE ALL ON public.version_groups, public.hospital_id_history,
              public.rule_upload_batches, public.report_downloads
  FROM anon, authenticated, service_role;
GRANT SELECT ON public.version_groups TO authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON public.hospital_id_history,
      public.rule_upload_batches, public.report_downloads TO service_role;
