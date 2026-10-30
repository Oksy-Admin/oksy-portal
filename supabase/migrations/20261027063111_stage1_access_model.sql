-- Stage 1: open sign-in, Owner role, access ticks, approval workflow.
-- Requirements: requirements_v2.md sections 2.7, 3, and change log in 2.6.
-- Does NOT touch hospitals, rules, or other data tables.

-------------------------------------------------------------------------------
-- 1. OWNER always passes has_role() — Owner = full access (requirements v2 §3).
--    This one change makes every existing RLS policy that checks has_role(...)
--    pass for the Owner without touching each policy individually.
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.has_role(VARIADIC roles public.app_role[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(
    private.current_app_role() = ANY(roles)
    OR private.current_app_role() = 'OWNER',
    false
  )
$$;

-------------------------------------------------------------------------------
-- 2. Promote seed users to v2 roles and migrate any leftover APPROVER/HELPER
-------------------------------------------------------------------------------
SELECT set_config('oksy.audit_reason', 'Stage 1: migrate to v2 roles (Owner / Admin / User)', true);

UPDATE public.users_roles SET role = 'OWNER' WHERE email = 'anoop@oksy.in';
UPDATE public.users_roles SET role = 'ADMIN' WHERE email = 'admin@oksy.in';
-- Any other APPROVER or HELPER rows (none expected) become USER
UPDATE public.users_roles SET role = 'USER'
 WHERE role IN ('APPROVER', 'HELPER')
   AND email NOT IN ('anoop@oksy.in', 'admin@oksy.in');

-------------------------------------------------------------------------------
-- 3. Relax the state constraint so pending users are valid
--    (active=false, retired_at IS NULL, granted_by IS NULL)
-------------------------------------------------------------------------------
ALTER TABLE public.users_roles DROP CONSTRAINT users_roles_retired_consistent;
ALTER TABLE public.users_roles ADD CONSTRAINT users_roles_state_consistent CHECK (
  (active AND retired_at IS NULL)                                -- active user
  OR (NOT active AND retired_at IS NOT NULL)                     -- retired user
  OR (NOT active AND retired_at IS NULL AND granted_by IS NULL)  -- pending approval
);

-------------------------------------------------------------------------------
-- 4. Access ticks table (requirements v2 §3: per-person per-page ticks)
-------------------------------------------------------------------------------
CREATE TABLE public.user_access_ticks (
  email                    text PRIMARY KEY REFERENCES public.users_roles(email),
  dashboard_view           boolean NOT NULL DEFAULT false,
  dashboard_copy_reminders boolean NOT NULL DEFAULT false,
  hospitals_view           boolean NOT NULL DEFAULT false,
  hospitals_add_edit       boolean NOT NULL DEFAULT false,
  questions_view           boolean NOT NULL DEFAULT false,
  questions_mark_answered  boolean NOT NULL DEFAULT false,
  clean_data_view          boolean NOT NULL DEFAULT false,
  clean_data_download      boolean NOT NULL DEFAULT false,
  rule_library_view        boolean NOT NULL DEFAULT false,
  rule_library_add_edit    boolean NOT NULL DEFAULT false,
  audit_runs_view          boolean NOT NULL DEFAULT false,
  updated_by               uuid,
  updated_at               timestamptz
);
ALTER TABLE public.user_access_ticks ENABLE ROW LEVEL SECURITY;
SELECT private.protect_table('public.user_access_ticks', 'email');

-- RLS: own row + Admin/Owner reads all (has_role includes OWNER)
CREATE POLICY ticks_read_own ON public.user_access_ticks
  FOR SELECT TO authenticated
  USING (email = (
    SELECT ur.email FROM public.users_roles ur
     WHERE ur.user_id = (SELECT auth.uid())
  ));

CREATE POLICY ticks_admin_reads_all ON public.user_access_ticks
  FOR SELECT TO authenticated
  USING ((SELECT private.has_role('ADMIN')));

GRANT SELECT ON public.user_access_ticks TO authenticated;
-- No direct INSERT/UPDATE grant; changes go through set_access_ticks().

-- Seed: Owner and Admin get all ticks
INSERT INTO public.user_access_ticks (
  email, dashboard_view, dashboard_copy_reminders,
  hospitals_view, hospitals_add_edit,
  questions_view, questions_mark_answered,
  clean_data_view, clean_data_download,
  rule_library_view, rule_library_add_edit,
  audit_runs_view
) VALUES
  ('anoop@oksy.in',  true,true,true,true,true,true,true,true,true,true,true),
  ('admin@oksy.in',  true,true,true,true,true,true,true,true,true,true,true);

-------------------------------------------------------------------------------
-- 5. Open sign-in: anyone can sign in with Google (requirements v2 §3)
--    Unknown emails get a users_roles row with active=false (pending approval).
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.link_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text := lower(new.email);
  v_name  text := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(new.email, '@', 1)
  );
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'No email on the auth account' USING errcode = '42501';
  END IF;

  -- Existing user (active or pending): link user_id, fill display_name
  UPDATE public.users_roles
     SET user_id = new.id,
         display_name = coalesce(display_name, v_name)
   WHERE email = v_email
     AND (user_id IS NULL OR user_id = new.id);

  IF found THEN RETURN new; END IF;

  -- Row exists but linked to a different auth account
  IF EXISTS (
    SELECT 1 FROM public.users_roles
     WHERE email = v_email
       AND user_id IS DISTINCT FROM new.id
       AND user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'This email is already linked to another login'
      USING errcode = '42501';
  END IF;

  -- Brand-new email: create a pending row (active=false, role=USER)
  PERFORM set_config(
    'oksy.audit_reason',
    'Auto-created on first Google sign-in (pending approval)',
    true
  );
  INSERT INTO public.users_roles (email, user_id, role, display_name, active)
  VALUES (v_email, new.id, 'USER', v_name, false);

  RETURN new;
END;
$$;

-------------------------------------------------------------------------------
-- 6. Updated set_user_role: Owner / Admin hierarchy (requirements v2 §3)
--    • OWNER or ADMIN can call
--    • Only OWNER can set/change ADMIN role
--    • Only OWNER can modify an existing ADMIN's record
--    • Nobody can set OWNER or change the OWNER row
--    • Approving a pending user = calling this (sets active=true)
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_role(
  p_email        text,
  p_role         public.app_role,
  p_display_name text    DEFAULT NULL,
  p_reason       text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text := lower(trim(p_email));
  v_caller public.app_role;
  v_target public.app_role;
BEGIN
  v_caller := private.current_app_role();

  IF v_caller IS NULL OR v_caller NOT IN ('OWNER', 'ADMIN') THEN
    RAISE EXCEPTION 'Only OWNER or ADMIN can manage users' USING errcode = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users_roles WHERE email = v_email AND user_id = v_uid) THEN
    RAISE EXCEPTION 'You cannot change your own role' USING errcode = '42501';
  END IF;

  -- Nobody can create or become OWNER
  IF p_role = 'OWNER' THEN
    RAISE EXCEPTION 'There can be only one Owner' USING errcode = '42501';
  END IF;

  SELECT role INTO v_target FROM public.users_roles WHERE email = v_email;

  -- Cannot change the OWNER row
  IF v_target = 'OWNER' THEN
    RAISE EXCEPTION 'The Owner role cannot be changed' USING errcode = '42501';
  END IF;

  -- Only OWNER may set/change ADMIN
  IF (p_role = 'ADMIN' OR v_target = 'ADMIN') AND v_caller <> 'OWNER' THEN
    RAISE EXCEPTION 'Only the Owner can set or change Admin access' USING errcode = '42501';
  END IF;

  PERFORM set_config('oksy.audit_reason', coalesce(p_reason, 'role set by ' || v_caller), true);

  INSERT INTO public.users_roles AS ur (email, role, display_name, granted_by)
  VALUES (v_email, p_role, p_display_name, v_uid)
  ON CONFLICT (email) DO UPDATE
    SET role         = excluded.role,
        display_name = coalesce(excluded.display_name, ur.display_name),
        active       = true,
        retired_at   = NULL,
        retired_by   = NULL,
        granted_by   = v_uid,
        granted_at   = now();

  -- Ensure an access-ticks row exists (all false by default)
  INSERT INTO public.user_access_ticks (email)
  VALUES (v_email)
  ON CONFLICT (email) DO NOTHING;
END;
$$;

-------------------------------------------------------------------------------
-- 7. Updated retire_user: Owner cannot be retired; works on pending users too
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retire_user(
  p_email  text,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text := lower(trim(p_email));
  v_caller public.app_role;
  v_target public.app_role;
BEGIN
  v_caller := private.current_app_role();

  IF v_caller IS NULL OR v_caller NOT IN ('OWNER', 'ADMIN') THEN
    RAISE EXCEPTION 'Only OWNER or ADMIN can manage users' USING errcode = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users_roles WHERE email = v_email AND user_id = v_uid) THEN
    RAISE EXCEPTION 'You cannot retire yourself' USING errcode = '42501';
  END IF;

  -- Find target (active or pending = retired_at IS NULL)
  SELECT role INTO v_target
    FROM public.users_roles
   WHERE email = v_email AND retired_at IS NULL;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'No active or pending user with that email' USING errcode = 'P0002';
  END IF;

  IF v_target = 'OWNER' THEN
    RAISE EXCEPTION 'The Owner cannot be retired' USING errcode = '42501';
  END IF;

  IF v_target = 'ADMIN' AND v_caller <> 'OWNER' THEN
    RAISE EXCEPTION 'Only the Owner can retire an Admin' USING errcode = '42501';
  END IF;

  PERFORM set_config('oksy.audit_reason', coalesce(p_reason, 'retired by ' || v_caller), true);

  UPDATE public.users_roles
     SET active = false, retired_at = now(), retired_by = v_uid
   WHERE email = v_email AND retired_at IS NULL;
END;
$$;

-------------------------------------------------------------------------------
-- 8. New function: set access ticks (requirements v2 §3)
--    Every change is audited via the protect_table trigger.
-------------------------------------------------------------------------------
CREATE FUNCTION public.set_access_ticks(
  p_email  text,
  p_ticks  jsonb,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text := lower(trim(p_email));
  v_caller public.app_role;
  v_target public.app_role;
BEGIN
  v_caller := private.current_app_role();

  IF v_caller IS NULL OR v_caller NOT IN ('OWNER', 'ADMIN') THEN
    RAISE EXCEPTION 'Only OWNER or ADMIN can set access ticks' USING errcode = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users_roles WHERE email = v_email AND user_id = v_uid) THEN
    RAISE EXCEPTION 'You cannot change your own access' USING errcode = '42501';
  END IF;

  SELECT role INTO v_target FROM public.users_roles WHERE email = v_email AND active;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'No active user with that email' USING errcode = 'P0002';
  END IF;

  IF v_target = 'OWNER' THEN
    RAISE EXCEPTION 'Owner always has full access' USING errcode = '42501';
  END IF;

  IF v_target = 'ADMIN' AND v_caller <> 'OWNER' THEN
    RAISE EXCEPTION 'Only the Owner can change Admin access' USING errcode = '42501';
  END IF;

  PERFORM set_config('oksy.audit_reason', coalesce(p_reason, 'access ticks set by ' || v_caller), true);

  INSERT INTO public.user_access_ticks AS t (
    email,
    dashboard_view, dashboard_copy_reminders,
    hospitals_view, hospitals_add_edit,
    questions_view, questions_mark_answered,
    clean_data_view, clean_data_download,
    rule_library_view, rule_library_add_edit,
    audit_runs_view,
    updated_by, updated_at
  ) VALUES (
    v_email,
    coalesce((p_ticks ->> 'dashboard_view')::boolean,           false),
    coalesce((p_ticks ->> 'dashboard_copy_reminders')::boolean, false),
    coalesce((p_ticks ->> 'hospitals_view')::boolean,           false),
    coalesce((p_ticks ->> 'hospitals_add_edit')::boolean,       false),
    coalesce((p_ticks ->> 'questions_view')::boolean,           false),
    coalesce((p_ticks ->> 'questions_mark_answered')::boolean,  false),
    coalesce((p_ticks ->> 'clean_data_view')::boolean,          false),
    coalesce((p_ticks ->> 'clean_data_download')::boolean,      false),
    coalesce((p_ticks ->> 'rule_library_view')::boolean,        false),
    coalesce((p_ticks ->> 'rule_library_add_edit')::boolean,    false),
    coalesce((p_ticks ->> 'audit_runs_view')::boolean,          false),
    v_uid, now()
  )
  ON CONFLICT (email) DO UPDATE SET
    dashboard_view           = coalesce((p_ticks ->> 'dashboard_view')::boolean,           false),
    dashboard_copy_reminders = coalesce((p_ticks ->> 'dashboard_copy_reminders')::boolean, false),
    hospitals_view           = coalesce((p_ticks ->> 'hospitals_view')::boolean,           false),
    hospitals_add_edit       = coalesce((p_ticks ->> 'hospitals_add_edit')::boolean,       false),
    questions_view           = coalesce((p_ticks ->> 'questions_view')::boolean,           false),
    questions_mark_answered  = coalesce((p_ticks ->> 'questions_mark_answered')::boolean,  false),
    clean_data_view          = coalesce((p_ticks ->> 'clean_data_view')::boolean,          false),
    clean_data_download      = coalesce((p_ticks ->> 'clean_data_download')::boolean,      false),
    rule_library_view        = coalesce((p_ticks ->> 'rule_library_view')::boolean,        false),
    rule_library_add_edit    = coalesce((p_ticks ->> 'rule_library_add_edit')::boolean,    false),
    audit_runs_view          = coalesce((p_ticks ->> 'audit_runs_view')::boolean,          false),
    updated_by               = v_uid,
    updated_at               = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_access_ticks(text, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_access_ticks(text, jsonb, text) TO authenticated;

-------------------------------------------------------------------------------
-- 9. Note: 4 extra tables in the live DB not in the repo migrations
--    are NOT added in this stage; noted for later.
-------------------------------------------------------------------------------
