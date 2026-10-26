-- S1: the worker may correct its own PROPOSED column mappings (file 03 section 3) when the
-- code's header dictionary improves, so the stored mapping always matches what the run used.
-- APPROVED and RETIRED mappings never change this way (G1 decides those). Every change is in
-- audit_log (protect_table trigger of migration 0008). DRAFT; applied with `supabase db push --linked`.

create function private.guard_mapping_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status <> 'PROPOSED' and (new.canonical_field, new.confidence, new.method)
                                 is distinct from (old.canonical_field, old.confidence, old.method) then
    raise exception 'Only a PROPOSED mapping can be corrected; an approved mapping changes through G1'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_mapping_update() from public, anon, authenticated;
create trigger guard_mapping_update before update on public.column_mappings
  for each row execute function private.guard_mapping_update();

grant update (canonical_field, confidence, method) on public.column_mappings to service_role;

notify pgrst, 'reload schema';
