-- Stage 1: enforce per-page access ticks on reads (requirements v2 §3).
-- Owner and Admin always pass. A User passes only when their active row in
-- user_access_ticks has the named tick set to true.
-- Write policies on these tables are unchanged.

-------------------------------------------------------------------------------
-- 1. private.has_tick(text)
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.has_tick(p_tick text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(
    private.current_app_role() IN ('OWNER', 'ADMIN')
    OR (
      private.current_app_role() IS NOT NULL
      AND EXISTS (
        SELECT 1
          FROM public.user_access_ticks t
          JOIN public.users_roles ur ON ur.email = t.email
         WHERE ur.user_id = (SELECT auth.uid())
           AND ur.active
           AND CASE p_tick
                 WHEN 'dashboard_view'           THEN t.dashboard_view
                 WHEN 'dashboard_copy_reminders' THEN t.dashboard_copy_reminders
                 WHEN 'hospitals_view'           THEN t.hospitals_view
                 WHEN 'hospitals_add_edit'       THEN t.hospitals_add_edit
                 WHEN 'questions_view'           THEN t.questions_view
                 WHEN 'questions_mark_answered'  THEN t.questions_mark_answered
                 WHEN 'clean_data_view'          THEN t.clean_data_view
                 WHEN 'clean_data_download'      THEN t.clean_data_download
                 WHEN 'rule_library_view'        THEN t.rule_library_view
                 WHEN 'rule_library_add_edit'    THEN t.rule_library_add_edit
                 WHEN 'audit_runs_view'          THEN t.audit_runs_view
                 ELSE false  -- unknown tick name never grants access
               END
      )
    ),
    false
  )
$$;

REVOKE EXECUTE ON FUNCTION private.has_tick(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.has_tick(text) TO authenticated, service_role;

-------------------------------------------------------------------------------
-- 2. SELECT policies: Hospitals need hospitals_view
-------------------------------------------------------------------------------
DROP POLICY IF EXISTS hospitals_read ON public.hospitals;
CREATE POLICY hospitals_read ON public.hospitals
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('hospitals_view')));

-------------------------------------------------------------------------------
-- 3. SELECT policies: Rule Library needs rule_library_view
-------------------------------------------------------------------------------
DROP POLICY IF EXISTS rules_read ON public.rules;
CREATE POLICY rules_read ON public.rules
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('rule_library_view')));

DROP POLICY IF EXISTS rule_versions_read ON public.rule_versions;
CREATE POLICY rule_versions_read ON public.rule_versions
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('rule_library_view')));

DROP POLICY IF EXISTS rule_approvals_read ON public.rule_approvals;
CREATE POLICY rule_approvals_read ON public.rule_approvals
  FOR SELECT TO authenticated
  USING ((SELECT private.has_tick('rule_library_view')));
