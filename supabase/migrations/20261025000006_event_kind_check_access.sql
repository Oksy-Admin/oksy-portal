-- M4: a new Google log kind for the sheet access check (brief A7.5).
-- Its own file because Postgres cannot use a new enum value in the same transaction
-- that adds it; migration 0007 uses it.
-- CHECK_ACCESS = one metadata call (spreadsheet title only, no tab names, no cells).
alter type public.google_event_kind add value if not exists 'CHECK_ACCESS';
