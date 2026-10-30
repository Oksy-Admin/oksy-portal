-- Item 3 / Item 8 (27-Oct-2026): the Hospitals page now opens with the hospitals_view tick
-- (Anoop approved, handoff 9b). hospital_sheets is still read by the old roles (ADMIN,
-- APPROVER, HELPER), so a user with only the tick would see the hospitals but none of their
-- sheets. This gives hospital_sheets the same read rule as hospitals (migration 0021).
-- Writes to hospital_sheets go through save_hospital_scheme (hospitals_add_edit, live).
-- NOT APPLIED. Waiting for Anoop's OK on this SQL.
-- Backup / rollback: supabase/.temp/backup_before_0029_0030_20261027.sql.

DROP POLICY IF EXISTS hospital_sheets_read ON public.hospital_sheets;
CREATE POLICY hospital_sheets_read ON public.hospital_sheets
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_view')));

NOTIFY pgrst, 'reload schema';
