-- M3: table rights for the background worker (service_role), least privilege.
-- The live project does not grant service_role anything on new public tables (found
-- 25-Oct: 403 / 42501 on google_events), so every right the worker has is written here.
-- Approved by Anoop 25-Oct. Applied by Anoop with `supabase db push --linked`.
--
-- No audit_log grant: the audit trigger (private.audit_row) and set_tab_policy are
-- SECURITY DEFINER and write audit_log with the owner's rights.
-- No anon or authenticated grants change here.

-- Start from nothing, on every public table, so live and local are the same.
revoke all on all tables in schema public from service_role;

-- Tab allow-list: the worker adds tabs it finds and updates last_seen_at / missing_since.
-- It cannot make a tab ALLOW: the table checks need a person in decided_by.
grant select, insert, update on public.sheet_tabs to service_role;

-- Google read and write log: append only (no update, delete or truncate).
grant select, insert on public.google_events to service_role;
