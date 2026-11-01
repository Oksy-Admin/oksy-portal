-- TDS rate vs amount headers, final (Anoop, 1-Nov-2026; decisions.md section 5). Data change
-- only (mapping_fields.aliases/label) -- no schema change -- written as a migration at
-- Anoop's request so it is reviewed and tracked the same way as a schema change. NOT applied
-- to live; shown to him for his OK (same backup-first pattern as every earlier migration).
--
-- In every hospital, including HMS: a header literally "TDS", "TDS %", "TDS Percent", "TDS
-- Percentage" or "TDS Rate" always holds the TDS RATE and maps to the extra field `tds`
-- (lets Anoop see whether an insurer deducts a wrong rate).
-- A header literally "TDS Amount" or "TDS Amt" always holds a RUPEE AMOUNT and maps to the
-- core field `tds_amount_stated` (used for settlement comparison and the balance calculation).
-- Plain "TDS" is removed as an alias of `tds_amount_stated` -- it is no longer ambiguous.
-- packages/rules/src/fields.ts CORE_FIELDS is updated to match (test:
-- packages/worker/test/field-seed.test.ts, FIELDS_CHANGED_1_NOV).

SELECT set_config('oksy.audit_reason', 'TDS rate vs amount header aliases (decisions.md section 5, 1-Nov)', true);

UPDATE public.mapping_fields SET aliases = ARRAY['TDS', 'TDS %', 'TDS Percent', 'TDS Percentage', 'TDS Rate'], updated_at = now() WHERE key = 'tds';
UPDATE public.mapping_fields SET label = 'TDS Amount', aliases = ARRAY['TDS Amount', 'TDS Amt'], updated_at = now() WHERE key = 'tds_amount_stated';
