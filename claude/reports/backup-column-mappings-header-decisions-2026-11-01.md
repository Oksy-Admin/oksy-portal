# Backup before migration 20261101160000 (1-Nov-2026, read live via Supabase MCP, read-only)

**Re-taken**: the first version of this backup (same day, a few minutes earlier) is superseded —
live data moved under it (two Badagara DISCOUNT rows' `review_reason` cleared between reads,
most likely a worker run in progress) and the row count changed from 55 to the correct 54. This
version matches live as of the query below being run.

## header_decisions — full table, 108 rows, all 3 pilots, `withdrawn_at` null on all. Unaffected by
this migration's data (only the governing functions change); kept for reference per Anoop's
request. Re-run on request: `select hospital_code, scheme, header_key, canonical_field,
accept_any_shape, method, decided_at from header_decisions order by hospital_code, header_key;`

## column_mappings — the 54 rows the migration's one-time backfill will change. Every other row
of the table is untouched. Query used (also ties each row to its hospital + scheme + header_key,
same match the migration itself uses):

```sql
select cm.id, cm.hospital_code, cm.tab_name, cm.source_header, cm.header_key,
       cm.canonical_field as old_canonical_field, hd.canonical_field as decided_field,
       cm.status, cm.review_reason as old_review_reason
from column_mappings cm
join header_decisions hd
  on hd.hospital_code = cm.hospital_code and hd.scheme = cm.scheme and hd.header_key = cm.header_key
where hd.withdrawn_at is null and cm.status <> 'RETIRED'
  and (cm.canonical_field is distinct from hd.canonical_field or cm.review_reason is not null)
order by cm.id;
```

Confirmed count at this backup: 54 total (HOSPPVTP0001 Badagara 26, HOSPPVTP0002 Tree G 4,
HOSPPVTP0003 HMS 24). All 54 now have `old_review_reason = null` (the two DISCOUNT rows that had
a review reason moments ago no longer do — see note above); the change is still needed for every
one of them because `canonical_field` still disagrees with the decision.

### Restore (only if needed — sets canonical_field and review_reason back to their old values)

```sql
SELECT set_config('oksy.header_decision_sync', 'on', true);  -- same bypass the migration adds
UPDATE public.column_mappings AS cm
   SET canonical_field = v.canonical_field, review_reason = NULL
  FROM (VALUES
    ('004ea8f4-e114-4b18-ab47-8e4e5875ccaa'::uuid, NULL::text),
    ('02204eeb-6c81-4a7b-ae0f-b16284f04c93'::uuid, NULL),
    ('100e5519-9b0f-4231-9faf-f824eeb9c58f'::uuid, 'IGNORE'),
    ('10a7945e-08f4-4a35-95b6-7f8a2ec1e0ef'::uuid, 'patient_ip_no'),
    ('17c1c448-226a-4786-a897-e8cdea647311'::uuid, 'tds_amount_stated'),
    ('1898002b-bae0-4e82-802f-749fdbe682e1'::uuid, 'IGNORE'),
    ('1b435abd-d355-470b-a5da-a18c8e32c6e1'::uuid, 'followup_log'),
    ('2162e0ca-a32e-4054-8288-6ca372f76bd4'::uuid, 'tds_amount_stated'),
    ('285fe4af-b179-4482-88c9-fbe0c85eb824'::uuid, 'followup_log'),
    ('29225f20-30cd-4ab2-a88c-228ade5e7d29'::uuid, 'followup_log'),
    ('2a6dc99c-dcc4-4dc0-8601-e7480e35267f'::uuid, 'tds_amount_stated'),
    ('2eae21b7-33d6-4815-9f1b-341843279f08'::uuid, 'IGNORE'),
    ('357b2439-8fee-4ce2-8c96-0fce55b72962'::uuid, 'followup_log'),
    ('3a2e66c4-3dae-4e2b-98c8-b794057e2d3f'::uuid, 'IGNORE'),
    ('411dd6a8-0209-427d-bc9b-e5b8e370b832'::uuid, 'IGNORE'),
    ('44beb781-bd77-4bc3-814e-20910a2f96c3'::uuid, 'followup_log'),
    ('47908654-81e8-4741-b4d2-06926efc4c73'::uuid, 'followup_log'),
    ('4bd36e90-ead4-45c8-9c87-56624762fc6f'::uuid, NULL),
    ('55459dd9-1a8d-4896-8e86-448b95ac86f6'::uuid, NULL),
    ('567a5df4-37ee-45e9-8207-ebe2acfe6790'::uuid, 'followup_log'),
    ('57567193-8816-4d79-b2e7-939b894c8554'::uuid, NULL),
    ('6057c10e-04d3-4488-8eb9-279f7381641d'::uuid, 'IGNORE'),
    ('697d4308-a8c9-4e0d-acb8-d884dfb62beb'::uuid, 'followup_log'),
    ('6cea272b-e452-40b2-94e8-53d650e2bc6d'::uuid, NULL),
    ('714e4073-7ace-4473-abec-3062b7171114'::uuid, 'patient_ip_no'),
    ('72a67454-b1e6-45e9-962d-e70fa16faa7e'::uuid, NULL),
    ('750858aa-d4d7-464e-b3e3-ec49c440139f'::uuid, NULL),
    ('75a0f1a5-0c3c-4225-b6d7-53fdbae46643'::uuid, NULL),
    ('7750a59e-606d-45b4-8b0c-0b92275695fc'::uuid, 'IGNORE'),
    ('7819bb19-c734-4382-926b-7be8b83e2e24'::uuid, NULL),
    ('7a1c7de8-487f-4a01-9bf9-e23e23a33021'::uuid, 'IGNORE'),
    ('7e5196af-8cd3-4928-8f81-59df82c333a0'::uuid, 'followup_log'),
    ('8a5b9615-5d01-42ba-97fd-235af059c2a7'::uuid, 'followup_log'),
    ('8da5abb9-b5c0-4c46-8361-090c397ad0ab'::uuid, 'tds_amount_stated'),
    ('90cecc7c-5311-4223-9077-3a3cb68e9dd3'::uuid, 'IGNORE'),
    ('92e9b68c-98d3-4ce0-82fe-2a4e50cce5a3'::uuid, 'IGNORE'),
    ('96263472-fad5-4b7d-8f2f-b42de5940ee1'::uuid, 'followup_log'),
    ('98ff1e92-7119-4890-b4b9-5f8a43110d0f'::uuid, NULL),
    ('a57b1b7c-c2ad-407c-b8db-be5999f6a3ae'::uuid, NULL),
    ('a635c330-ac3a-4da5-b30c-32fd981006f9'::uuid, 'IGNORE'),
    ('a6d3adc9-3e48-47da-a6a3-8e54563aea11'::uuid, NULL),
    ('ac1c9ba1-1745-49e2-b86f-349b79d4cf77'::uuid, NULL),
    ('b785f50a-d1c3-4b96-99e6-4af67d2d0d0a'::uuid, 'followup_log'),
    ('b9d1214c-7326-483f-b2e7-abfbbc558723'::uuid, NULL),
    ('bbebd90a-c2b1-4604-8acc-8adeba2b7ebd'::uuid, NULL),
    ('cc98baff-3237-46a5-bb84-31f69cf311a2'::uuid, 'followup_log'),
    ('ccf84f20-d182-4e23-8065-4846f50241d9'::uuid, NULL),
    ('d429507e-425f-4fdf-8ed3-a19729f4f560'::uuid, 'policy_holder_name'),
    ('e4ccb502-ad73-49cd-8f39-5e15c9e1cb77'::uuid, 'followup_log'),
    ('e66aa38c-4f6d-4f8d-bcbc-cce272b4251f'::uuid, 'room_no'),
    ('f0d6dc87-71b1-4470-a32c-90429e42e6e8'::uuid, 'IGNORE'),
    ('f13403bd-0dad-4ff5-9eae-28d2df32740b'::uuid, 'patient_ip_no'),
    ('f5f3c7e8-3354-4dc9-ac4b-643d258bfdc1'::uuid, 'followup_log'),
    ('f98a6166-ac70-4f22-a9cb-d71baa6b7199'::uuid, 'tds_amount_stated')
  ) AS v(id, canonical_field)
 WHERE cm.id = v.id;
SELECT set_config('oksy.header_decision_sync', 'off', true);
```

All 54 rows had `review_reason = null` at this backup, so the restore sets it back to `NULL` in
every case too (no row here needs a non-null `review_reason` restored).

Also restorable by redeploying `decide_header()` and `guard_mapping_update()` exactly as they
were in `supabase/migrations/20261030200918_mapping_bulk_confirm.sql` section 5 and
`supabase/migrations/20261026000009_mapping_correction.sql`, if the function change itself needs
undoing.
