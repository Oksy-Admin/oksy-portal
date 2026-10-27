-- Seed 3 confirmed pilot hospitals (v2 requirements)
INSERT INTO public.hospitals (hospital_code, hospital_name, district, status, other_names, updated_at)
VALUES
  ('HOSPPVTP0001', 'The Badagara Sahakarana Asupathri Ltd, Vadakara', 'KOZHIKODE', 'ACTIVE', ARRAY['Vadakara Co-operative Hospital', 'Badagara Sahakarana Asupathri'], now()),
  ('HOSPPVTP0002', 'Tree G Eye Care Hospital, Manjeri', 'MALAPPURAM', 'ACTIVE', ARRAY['Tree G Eye Hospital', 'Tree G Manjeri'], now()),
  ('HOSPPVTP0003', 'HMS: Hearts Malabar Clinical Solutions Hospital, Kottakkal', 'MALAPPURAM', 'ACTIVE', ARRAY['HMS Hospital', 'Hearts Malabar Kottakkal'], now())
ON CONFLICT (hospital_code) DO UPDATE
  SET hospital_name = EXCLUDED.hospital_name,
      district = EXCLUDED.district,
      status = EXCLUDED.status,
      other_names = EXCLUDED.other_names,
      updated_at = now();

INSERT INTO public.hospital_sheets (
  sheet_key, hospital_code, scheme, reg_no, sheet_status,
  spreadsheet_id, sheet_url, sync, access_status, updated_at
)
VALUES
  ('HOSPPVTP0001|PRIVATE', 'HOSPPVTP0001', 'PRIVATE', 1, 'LINKED',
   '1-_vGLhW2hptEPDAVBnjN5tgZjJLHFWDq3d3zZobM-5g',
   'https://docs.google.com/spreadsheets/d/1-_vGLhW2hptEPDAVBnjN5tgZjJLHFWDq3d3zZobM-5g/edit',
   'YES', 'NOT_CHECKED', now()),
  ('HOSPPVTP0002|PRIVATE', 'HOSPPVTP0002', 'PRIVATE', 2, 'LINKED',
   '1LvE15UQa1QjUPcT76ymrpBslvvEs-baHAEE33GEv-dI',
   'https://docs.google.com/spreadsheets/d/1LvE15UQa1QjUPcT76ymrpBslvvEs-baHAEE33GEv-dI/edit',
   'YES', 'NOT_CHECKED', now()),
  ('HOSPPVTP0003|PRIVATE', 'HOSPPVTP0003', 'PRIVATE', 3, 'LINKED',
   '1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ',
   'https://docs.google.com/spreadsheets/d/1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ/edit',
   'YES', 'NOT_CHECKED', now())
ON CONFLICT (sheet_key) DO UPDATE
  SET sheet_url = EXCLUDED.sheet_url,
      spreadsheet_id = EXCLUDED.spreadsheet_id,
      sync = EXCLUDED.sync,
      updated_at = now();
