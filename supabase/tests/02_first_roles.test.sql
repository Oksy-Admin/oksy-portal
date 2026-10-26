-- First roles (D-037, D-058): at first Google sign-in, anoop@oksy.in becomes ADMIN and
-- admin@oksy.in becomes APPROVER (seeded by email in migration 0002). Any other account,
-- also another @oksy.in one, is refused and gets no login. Runs only on a throwaway database.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'anoop@oksy.in', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'Admin@Oksy.in', 'authenticated', 'authenticated');

select is((select role::text from public.users_roles where user_id = '00000000-0000-0000-0000-0000000000c1'),
  'ADMIN', 'anoop@oksy.in gets ADMIN at first sign-in');
select is((select role::text from public.users_roles where user_id = '00000000-0000-0000-0000-0000000000c2'),
  'APPROVER', 'admin@oksy.in gets APPROVER at first sign-in (email case ignored)');
select ok(exists (
    select 1 from public.audit_log
    where table_name = 'users_roles' and action = 'UPDATE' and record_id = 'anoop@oksy.in'
      and after ->> 'user_id' = '00000000-0000-0000-0000-0000000000c1'),
  'the role binding is written to audit_log');

select throws_ok(
  $$insert into auth.users (id, email, aud, role) values
    ('00000000-0000-0000-0000-0000000000c3', 'someone.else@oksy.in', 'authenticated', 'authenticated')$$,
  '42501', 'This account is not registered for the Oksy portal',
  'another @oksy.in account is refused at sign-in');
select is((select count(*)::int from auth.users where email = 'someone.else@oksy.in'), 0,
  'the refused account gets no login');
select is((select count(*)::int from public.users_roles where email = 'someone.else@oksy.in'), 0,
  'the refused account gets no role');

select * from finish();
rollback;
