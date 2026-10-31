-- Stage 1e: two rights the worker (service_role) needs and never had (found 31-Oct while
-- measuring run times: every sheet run stopped at "read the field list").
-- NOT APPLIED. Waiting for Anoop's OK on this SQL. Take a backup first.
--
-- 1. Read mapping_fields: the field list (Fields page) the worker maps headers with.
-- 2. Read and add version_groups: the worker records each new header layout there.
-- Nothing else; no delete, no update.

GRANT SELECT ON public.mapping_fields TO service_role;
GRANT SELECT, INSERT ON public.version_groups TO service_role;

NOTIFY pgrst, 'reload schema';
