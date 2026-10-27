-- Applied to live on 27-Oct-2026 (recorded in migration history after the fact).
-- Replaces role-only policies on 3 tables with tick-based policies.
-- Rule (Anoop, 27-Oct-2026): no approval or no tick = nothing visible here.
-- Owner and Admin pass every tick check (private.has_tick already does this).
--   hospital_id_history -> Hospitals page     (hospitals_view / hospitals_add_edit)
--   report_downloads    -> Clean Data page    (clean_data_view / clean_data_download)
--   rule_upload_batches -> Rule Library page  (rule_library_view / rule_library_add_edit)

drop policy if exists hospital_id_history_manage on public.hospital_id_history;
drop policy if exists hospital_id_history_read   on public.hospital_id_history;
create policy hospital_id_history_read on public.hospital_id_history
  for select to authenticated using ((select private.has_tick('hospitals_view')));
create policy hospital_id_history_write on public.hospital_id_history
  for all to authenticated
  using ((select private.has_tick('hospitals_add_edit')))
  with check ((select private.has_tick('hospitals_add_edit')));

drop policy if exists report_downloads_manage on public.report_downloads;
drop policy if exists report_downloads_read   on public.report_downloads;
create policy report_downloads_read on public.report_downloads
  for select to authenticated using ((select private.has_tick('clean_data_view')));
create policy report_downloads_write on public.report_downloads
  for all to authenticated
  using ((select private.has_tick('clean_data_download')))
  with check ((select private.has_tick('clean_data_download')));

drop policy if exists rule_upload_batches_manage on public.rule_upload_batches;
drop policy if exists rule_upload_batches_read   on public.rule_upload_batches;
create policy rule_upload_batches_read on public.rule_upload_batches
  for select to authenticated using ((select private.has_tick('rule_library_view')));
create policy rule_upload_batches_write on public.rule_upload_batches
  for all to authenticated
  using ((select private.has_tick('rule_library_add_edit')))
  with check ((select private.has_tick('rule_library_add_edit')));
