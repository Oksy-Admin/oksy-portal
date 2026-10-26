-- Migration 0017: add DRAFT and REFERENCE to rule_status.
-- Kept alone on purpose: Postgres only lets a new enum value be used after the
-- transaction that added it has committed, and `supabase db push` runs each
-- migration file in one transaction. Migration 0018 uses the new values.

alter type public.rule_status add value if not exists 'DRAFT' before 'PROPOSED';
alter type public.rule_status add value if not exists 'REFERENCE';
