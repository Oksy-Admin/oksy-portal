-- First roles (Stage 1 access model, 27-Oct): at first Google sign-in, anoop@oksy.in is
-- OWNER and admin@oksy.in is ADMIN (seeded by email). Any other account, also another
-- @oksy.in one, gets an inactive USER row and sees nothing until approved. Throwaway DB only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'anoop@oksy.in', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'Admin@Oksy.in', 'authenticated', 'authenticated');

select is((select role::text from public.users_roles where user_id = '00000000-0000-0000-0000-0000000000c1'),
  'OWNER', 'anoop@oksy.in is OWNER at first sign-in');
select is((select role::text from public.users_roles where user_id = '00000000-0000-0000-0000-0000000000c2'),
  'ADMIN', 'admin@oksy.in is ADMIN at first sign-in (email case ignored)');
select ok(exists (
    select 1 from public.audit_log
    where table_name = 'users_roles' and action = 'UPDATE' and record_id = 'anoop@oksy.in'
      and after ->> 'user_id' = '00000000-0000-0000-0000-0000000000c1'),
  'the role binding is written to audit_log');

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c3', 'someone.else@oksy.in', 'authenticated', 'authenticated');
select is((select role::text || '|' || active::text from public.users_roles where email = 'someone.else@oksy.in'), 'USER|false',
  'another @oksy.in account waits for approval (inactive USER)');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c3', 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', true);
set local role authenticated;
select is((select private.current_app_role()::text), null, 'the waiting account has no role yet');
select ok(not (select private.has_tick('hospitals_view')), 'the waiting account passes no tick');
reset role;
select * from finish();
rollback;
