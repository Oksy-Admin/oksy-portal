-- Stage 1c: one schema for live and the migration files (schema drift found 31-Oct-2026).
-- NOT APPLIED. Waiting for Anoop's OK on this SQL. Take a backup first.
--
-- Found (read-only, scripts/schema-names.sql on live vs a fresh replay of the files):
--   * 7 tables the code uses were never on live: snapshots, record_keys, change_log (worker
--     WRITE runs), district_heads, open_checks, retired_ids, staff_contacts (hospital page).
--   * live has columns no file creates (hospital_key on 4 tables and its keys, 12 more).
--   * live has the tick policies of 20261027000024, which a fresh replay skips.
-- Every statement is safe to run on both: IF NOT EXISTS, or drop-and-create of the same thing.
--
-- What changes on live:
-- 1. Nothing: the live-only columns and keys are written down here so a fresh replay has them.
-- 2. The 7 tables are created as the files define them; their RLS policies and grants are
--    written new for today's access model (Owner / Admin / User + ticks), not the old roles.
--    reconciliations.snapshot_id (in the files, not on live) is added.
-- 3. Snapshots (raw cell values: patient data, decision 31-Oct): kept 12 months. A row may be
--    deleted only when it is older than that, and only by purge_old_snapshots() (worker).
-- 4. The tick policies of 20261027000024, again (same statements).
-- 5. header_decisions / header_decision_batches: also readable with the Hospitals view tick.
-- 5b. TRUNCATE / REFERENCES / TRIGGER rights of the API roles removed (nobody needs them).
-- 6. Retired (decision 31-Oct): tables hospital_aliases, golden_tests, discount2_decisions,
--    import_runs (not on live) and the functions that only served them: import_register(),
--    confirm_discount2_decision(), private.guard_d2_status() (on live, never called).

-- 1. -------------------------------------------------------------------------------------
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS hospital_key uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.hospital_sheets ADD COLUMN IF NOT EXISTS hospital_key uuid;
ALTER TABLE public.claims_staging ADD COLUMN IF NOT EXISTS hospital_key uuid;
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS hospital_key uuid,
  ADD COLUMN IF NOT EXISTS scheme text,
  ADD COLUMN IF NOT EXISTS insurer text,
  ADD COLUMN IF NOT EXISTS tpa text,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_to date;
ALTER TABLE public.column_mappings ADD COLUMN IF NOT EXISTS approved_on timestamptz;
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS answer_type text,
  ADD COLUMN IF NOT EXISTS row_ref text,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'QUEUED';
ALTER TABLE public.rule_approvals
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_on timestamptz DEFAULT now();
ALTER TABLE public.rule_versions ADD COLUMN IF NOT EXISTS condition text;

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      ('public.hospitals', 'hospitals_hospital_key_uniq', 'UNIQUE (hospital_key)'),
      ('public.hospital_sheets', 'hospital_sheets_hospital_fk', 'FOREIGN KEY (hospital_key) REFERENCES public.hospitals (hospital_key)'),
      ('public.claims_staging', 'claims_staging_hospital_fk', 'FOREIGN KEY (hospital_key) REFERENCES public.hospitals (hospital_key)'),
      ('public.rules', 'rules_hospital_fk', 'FOREIGN KEY (hospital_key) REFERENCES public.hospitals (hospital_key)'),
      ('public.hospital_id_history', 'hospital_id_history_fk', 'FOREIGN KEY (hospital_key) REFERENCES public.hospitals (hospital_key)'),
      ('public.report_downloads', 'report_downloads_fk', 'FOREIGN KEY (hospital_key) REFERENCES public.hospitals (hospital_key)')
    ) AS v(tbl, name, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name AND conrelid = c.tbl::regclass) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', c.tbl, c.name, c.def);
    END IF;
  END LOOP;
END
$$;

-- 2. -------------------------------------------------------------------------------------
-- Raw sheet copy per run (cell values and colours: patient data).
CREATE TABLE IF NOT EXISTS public.snapshots (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id),
  hospital_code  text not null references public.hospitals (hospital_code),
  sheet_key      text not null references public.hospital_sheets (sheet_key),
  spreadsheet_id text not null,
  taken_at       timestamptz not null default now(),
  tabs           jsonb not null,             -- per tab: name, rows, header fingerprint (no cell values)
  raw            jsonb not null,             -- cell values and colours: patient data
  raw_sha256     text not null check (raw_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS snapshots_sheet ON public.snapshots (sheet_key, taken_at desc);

-- Record keys: several keys may point to one claim.
CREATE TABLE IF NOT EXISTS public.record_keys (
  record_key    text primary key,
  record_uid    uuid not null references public.claims_staging (record_uid),
  key_type      text not null check (key_type in ('CLAIM_NO', 'FALLBACK')),
  hospital_code text not null references public.hospitals (hospital_code),
  scheme        text not null,
  created_at    timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS record_keys_uid ON public.record_keys (record_uid);

-- Field-level history of every stored claim value (never updated, never deleted).
CREATE TABLE IF NOT EXISTS public.change_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  record_uid   uuid not null references public.claims_staging (record_uid),
  field        text not null,
  old_value    text,
  new_value    text,
  rule_id      text,
  rule_version integer,
  tier         text check (tier in ('A', 'B', 'C', 'D')),
  actor        text not null default 'ENGINE',
  job_id       uuid references public.jobs (id)
);
CREATE INDEX IF NOT EXISTS change_log_record ON public.change_log (record_uid, at);

CREATE TABLE IF NOT EXISTS public.district_heads (
  district   text primary key check (length(district) between 1 and 100),
  dbdo       text,
  rbdo       text,
  note       text,
  updated_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.retired_ids (
  retired_id           text primary key check (retired_id ~ '^HOSP32P[0-9]{6}$'),
  kept_id              text not null references public.hospitals (hospital_code),
  name_at_retirement   text,
  status_at_retirement text,
  retired_on           date,
  reason               text,
  created_at           timestamptz not null default now(),
  check (retired_id <> kept_id)
);

CREATE TABLE IF NOT EXISTS public.open_checks (
  check_no       integer primary key,
  status         text not null,
  hospital_code  text,                 -- may be blank or a retired ID: no foreign key on purpose
  hospital_name  text,
  flag           text,
  what_to_decide text,
  decision       text,
  decided_by     text,
  decided_on     text,                 -- as written in the register
  updated_at     timestamptz not null default now()
);

-- Staff phone numbers: personal data.
CREATE TABLE IF NOT EXISTS public.staff_contacts (
  id            uuid primary key default gen_random_uuid(),
  hospital_code text not null references public.hospitals (hospital_code),
  staff_name    text not null,
  designation   text,
  phone         text,
  source        text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  retired_by    uuid,
  retired_at    timestamptz
);

ALTER TABLE public.reconciliations ADD COLUMN IF NOT EXISTS snapshot_id uuid;
ALTER TABLE public.reconciliations DROP CONSTRAINT IF EXISTS reconciliations_snapshot_id_fkey;
-- A snapshot past its 12 months may go; the reconciliation keeps its counts.
ALTER TABLE public.reconciliations
  ADD CONSTRAINT reconciliations_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.snapshots (id) ON DELETE SET NULL;

-- Never-delete and audit triggers, as the files define them (dropped first: same triggers).
DROP TRIGGER IF EXISTS snapshots_no_update ON public.snapshots;
DROP TRIGGER IF EXISTS snapshots_no_delete ON public.snapshots;
DROP TRIGGER IF EXISTS snapshots_no_truncate ON public.snapshots;
CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON public.snapshots FOR EACH ROW EXECUTE FUNCTION private.forbid_log_change();
CREATE TRIGGER snapshots_no_truncate BEFORE TRUNCATE ON public.snapshots FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_log_change();
DROP TRIGGER IF EXISTS record_keys_no_delete ON public.record_keys;
CREATE TRIGGER record_keys_no_delete BEFORE DELETE ON public.record_keys FOR EACH ROW EXECUTE FUNCTION private.forbid_delete();
DROP TRIGGER IF EXISTS change_log_no_update ON public.change_log;
DROP TRIGGER IF EXISTS change_log_no_delete ON public.change_log;
CREATE TRIGGER change_log_no_update BEFORE UPDATE ON public.change_log FOR EACH ROW EXECUTE FUNCTION private.forbid_log_change();
CREATE TRIGGER change_log_no_delete BEFORE DELETE ON public.change_log FOR EACH ROW EXECUTE FUNCTION private.forbid_log_change();
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['district_heads', 'retired_ids', 'open_checks', 'staff_contacts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS no_delete ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS no_truncate ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS audit ON public.%I', t);
  END LOOP;
END
$$;
SELECT private.protect_table('public.district_heads', 'district');
SELECT private.protect_table('public.retired_ids', 'retired_id');
SELECT private.protect_table('public.open_checks', 'check_no');
SELECT private.protect_table('public.staff_contacts', 'id');
DROP TRIGGER IF EXISTS guard_retired_id ON public.retired_ids;
CREATE TRIGGER guard_retired_id BEFORE INSERT OR UPDATE ON public.retired_ids
  FOR EACH ROW EXECUTE FUNCTION private.guard_retired_id();

-- RLS and grants for today's access model.
ALTER TABLE public.snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.district_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retired_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS snapshots_read ON public.snapshots;
DROP POLICY IF EXISTS record_keys_read ON public.record_keys;
DROP POLICY IF EXISTS change_log_read ON public.change_log;
DROP POLICY IF EXISTS district_heads_read ON public.district_heads;
DROP POLICY IF EXISTS retired_ids_read ON public.retired_ids;
DROP POLICY IF EXISTS open_checks_read ON public.open_checks;
DROP POLICY IF EXISTS staff_contacts_read ON public.staff_contacts;
DROP POLICY IF EXISTS staff_contacts_insert ON public.staff_contacts;
DROP POLICY IF EXISTS staff_contacts_update ON public.staff_contacts;

-- Raw copies hold every cell: Owner and Admin only.
CREATE POLICY snapshots_read ON public.snapshots FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN')));
-- Claim keys and claim history: who may see clean data.
CREATE POLICY record_keys_read ON public.record_keys FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('clean_data_view')));
CREATE POLICY change_log_read ON public.change_log FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('clean_data_view')));
-- Register details: who may see hospitals.
CREATE POLICY district_heads_read ON public.district_heads FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_view')));
CREATE POLICY retired_ids_read ON public.retired_ids FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_view')));
CREATE POLICY open_checks_read ON public.open_checks FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_view')));
-- Staff phones: personal data, only who may edit hospitals.
CREATE POLICY staff_contacts_read ON public.staff_contacts FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_add_edit')));
CREATE POLICY staff_contacts_insert ON public.staff_contacts FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_tick('hospitals_add_edit')));
CREATE POLICY staff_contacts_update ON public.staff_contacts FOR UPDATE TO authenticated
  USING ((SELECT private.has_tick('hospitals_add_edit')))
  WITH CHECK ((SELECT private.has_tick('hospitals_add_edit')));

REVOKE ALL ON public.snapshots, public.record_keys, public.change_log, public.district_heads,
              public.retired_ids, public.open_checks, public.staff_contacts
  FROM anon, authenticated, service_role;
GRANT SELECT ON public.snapshots, public.record_keys, public.change_log, public.district_heads,
                public.retired_ids, public.open_checks, public.staff_contacts TO authenticated;
GRANT INSERT, UPDATE ON public.staff_contacts TO authenticated;
-- Worker (least privilege, no delete).
GRANT SELECT, INSERT ON public.snapshots, public.record_keys, public.change_log TO service_role;

-- 3. -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.snapshot_delete_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF old.taken_at > now() - interval '12 months' THEN
    RAISE EXCEPTION 'A snapshot is kept 12 months (taken %)', old.taken_at USING ERRCODE = 'P0001';
  END IF;
  RETURN old;
END;
$$;
CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON public.snapshots
  FOR EACH ROW EXECUTE FUNCTION private.snapshot_delete_guard();

-- Deletes the snapshots older than 12 months; one audit entry with the count.
CREATE OR REPLACE FUNCTION public.purge_old_snapshots()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.snapshots WHERE taken_at <= now() - interval '12 months';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    INSERT INTO public.audit_log (action, table_name, record_id, after, reason)
    VALUES ('DELETE', 'snapshots', NULL, jsonb_build_object('deleted', v_count),
            'Snapshots older than 12 months deleted (decision 31-Oct)');
  END IF;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_old_snapshots() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_snapshots() TO service_role;

-- 4. -------------------------------------------------------------------------------------
-- The tick policies of 20261027000024 (on live already; a fresh replay creates them here).
drop policy if exists hospital_id_history_manage on public.hospital_id_history;
drop policy if exists hospital_id_history_read   on public.hospital_id_history;
drop policy if exists hospital_id_history_write  on public.hospital_id_history;
create policy hospital_id_history_read on public.hospital_id_history
  for select to authenticated using ((select private.has_tick('hospitals_view')));
create policy hospital_id_history_write on public.hospital_id_history
  for all to authenticated
  using ((select private.has_tick('hospitals_add_edit')))
  with check ((select private.has_tick('hospitals_add_edit')));

drop policy if exists report_downloads_manage on public.report_downloads;
drop policy if exists report_downloads_read   on public.report_downloads;
drop policy if exists report_downloads_write  on public.report_downloads;
create policy report_downloads_read on public.report_downloads
  for select to authenticated using ((select private.has_tick('clean_data_view')));
create policy report_downloads_write on public.report_downloads
  for all to authenticated
  using ((select private.has_tick('clean_data_download')))
  with check ((select private.has_tick('clean_data_download')));

drop policy if exists rule_upload_batches_manage on public.rule_upload_batches;
drop policy if exists rule_upload_batches_read   on public.rule_upload_batches;
drop policy if exists rule_upload_batches_write  on public.rule_upload_batches;
create policy rule_upload_batches_read on public.rule_upload_batches
  for select to authenticated using ((select private.has_tick('rule_library_view')));
create policy rule_upload_batches_write on public.rule_upload_batches
  for all to authenticated
  using ((select private.has_tick('rule_library_add_edit')))
  with check ((select private.has_tick('rule_library_add_edit')));

-- 5. -------------------------------------------------------------------------------------
DROP POLICY IF EXISTS header_decisions_read ON public.header_decisions;
CREATE POLICY header_decisions_read ON public.header_decisions FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_view')) OR (SELECT private.has_tick('hospitals_add_edit')));
DROP POLICY IF EXISTS header_decision_batches_read ON public.header_decision_batches;
CREATE POLICY header_decision_batches_read ON public.header_decision_batches FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_view')) OR (SELECT private.has_tick('hospitals_add_edit')));

-- 5b. ------------------------------------------------------------------------------------
-- Live gives TRUNCATE / REFERENCES / TRIGGER on several tables to the API roles (Supabase's
-- default for tables made outside migrations). Nobody needs them: removed everywhere.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;

-- 6. -------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.import_register(jsonb);
DROP FUNCTION IF EXISTS public.confirm_discount2_decision(uuid, boolean, text);
DROP TABLE IF EXISTS public.hospital_aliases, public.golden_tests, public.discount2_decisions, public.import_runs CASCADE;
DROP FUNCTION IF EXISTS private.guard_d2_status();

NOTIFY pgrst, 'reload schema';
