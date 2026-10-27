-- Behaviour checks for migration 20261027000028 (run after the stubs and the migration).
\set QUIET on
create temp table r(check_name text, outcome text);
create function pg_temp.try(name text, sql text) returns void language plpgsql as $$
begin execute sql; insert into r values (name, 'ok');
exception when others then insert into r values (name, 'refused ' || sqlstate || ': ' || sqlerrm); end $$;

insert into r select 'seed count / core / active', count(*) || ' / ' || count(*) filter (where is_core) || ' / ' || count(*) filter (where status='ACTIVE') from mapping_fields;
select set_config('test.role', '', false);
select pg_temp.try('no role: create', $q$select public.create_mapping_field('X Field','text','{}')$q$);
select set_config('test.role', 'USER', false);
select pg_temp.try('USER: create', $q$select public.create_mapping_field('X Field','text','{}')$q$);
select set_config('test.role', 'ADMIN', false);
select pg_temp.try('ADMIN: create Balance Status', $q$select public.create_mapping_field('Balance Status','text',ARRAY['Balance Status',' balance status ','Bal Status'])$q$);
insert into r select 'new field row', key||' | '||label||' | '||data_type||' | '||array_to_string(aliases,',')||' | core='||is_core||' | order='||sort_order from mapping_fields where key='balance_status';
insert into r select 'count after add', count(*)::text from mapping_fields;
select pg_temp.try('duplicate label', $q$select public.create_mapping_field('balance status','text','{}')$q$);
select pg_temp.try('alias of another field', $q$select public.create_mapping_field('Ward','text',ARRAY['Room No'])$q$);
select pg_temp.try('bad type', $q$select public.create_mapping_field('Odd','colour','{}')$q$);
insert into column_mappings (id, canonical_field) values ('00000000-0000-0000-0000-000000000001', null);
select pg_temp.try('approve column -> balance_status', $q$select public.approve_column_mapping('00000000-0000-0000-0000-000000000001','balance_status')$q$);
select pg_temp.try('rename keeps key', $q$select public.update_mapping_field('balance_status','Balance State','text',ARRAY['Balance Status'])$q$);
insert into r select 'after rename', key||' | '||label||' | mapping='||(select canonical_field from column_mappings limit 1) from mapping_fields where key='balance_status';
select pg_temp.try('delete in use', $q$select public.delete_mapping_field('balance_status')$q$);
select pg_temp.try('delete core', $q$select public.delete_mapping_field('claimed_amount')$q$);
select pg_temp.try('core type change', $q$select public.update_mapping_field('bill_amount','Bill Amount','text',ARRAY['Bill'])$q$);
select pg_temp.try('custom type change', $q$select public.update_mapping_field('balance_status','Balance State','number',ARRAY['Balance Status'])$q$);
select pg_temp.try('hide', $q$select public.set_mapping_field_status('balance_status','HIDDEN')$q$);
insert into column_mappings (id, canonical_field) values ('00000000-0000-0000-0000-000000000002', null);
select pg_temp.try('approve new column -> hidden field', $q$select public.approve_column_mapping('00000000-0000-0000-0000-000000000002','balance_status')$q$);
select pg_temp.try('re-approve row already on hidden field', $q$select public.approve_column_mapping('00000000-0000-0000-0000-000000000001','balance_status')$q$);
select pg_temp.try('approve unknown key', $q$select public.approve_column_mapping('00000000-0000-0000-0000-000000000002','no_such_field')$q$);
select pg_temp.try('approve IGNORE', $q$select public.approve_column_mapping('00000000-0000-0000-0000-000000000002','IGNORE')$q$);
select pg_temp.try('create unused + delete', $q$select public.create_mapping_field('Temp Unused','text','{}'); select public.delete_mapping_field('temp_unused')$q$);
insert into claims_staging (extra_fields) values ('{"stored_only":"x"}');
select pg_temp.try('create field', $q$select public.create_mapping_field('Stored Only','text','{}')$q$);
select pg_temp.try('delete when only claims_staging uses it', $q$select public.delete_mapping_field('stored_only')$q$);
select pg_temp.try('label with digits first', $q$select public.create_mapping_field('2nd Phone','text','{}')$q$);
insert into r select 'digit-first key', key from mapping_fields where label='2nd Phone';
insert into r select 'audit rows (insert/update/delete)', string_agg(action||'='||n, ', ') from (select action, count(*) n from audit_log where table_name='mapping_fields' group by action order by action) x;
insert into r select 'anon/auth grants', (select string_agg(grantee||':'||privilege_type, ',') from information_schema.role_table_grants where table_name='mapping_fields' and grantee in ('anon','authenticated'));
insert into r select 'fn exec anon / auth', has_function_privilege('anon','public.create_mapping_field(text,text,text[])','EXECUTE')||' / '||has_function_privilege('authenticated','public.create_mapping_field(text,text,text[])','EXECUTE');
\set QUIET off
select * from r;
