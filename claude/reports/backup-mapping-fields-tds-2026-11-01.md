# Backup before migration 20261101150000 (1-Nov-2026, 16:05 IST)
Rows of public.mapping_fields before the TDS rate/amount header migration.

| key | label | aliases | updated_at |
|---|---|---|---|
| tds | TDS % | {"Tds"} | 2026-10-31 17:19:59+00 |
| tds_amount_stated | TDS Amount | {"TDS Amount"} | 2026-10-31 17:25:44+00 |

Restore (only if needed):
UPDATE public.mapping_fields SET aliases = ARRAY['Tds'] WHERE key = 'tds';
UPDATE public.mapping_fields SET aliases = ARRAY['TDS Amount'] WHERE key = 'tds_amount_stated';
