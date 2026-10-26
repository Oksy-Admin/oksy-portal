-- Grant insert on public.jobs and execute on request_sheet_run to service_role
grant insert on public.jobs to service_role;
grant execute on function public.request_sheet_run(text, text) to service_role;
