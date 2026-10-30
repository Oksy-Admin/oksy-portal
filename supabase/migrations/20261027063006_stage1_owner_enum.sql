-- Stage 1: add OWNER to the app_role enum.
-- Separate file because Postgres cannot use a new enum value in the same
-- transaction that adds it (same pattern as migration 0006).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'OWNER' BEFORE 'ADMIN';
