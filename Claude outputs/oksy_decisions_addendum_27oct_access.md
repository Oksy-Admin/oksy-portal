# Oksy Data Cleanse – Decisions Addendum (27-Oct-2026, access and tests)

Add these to the Confirmed Decisions Log, section 7 (Access and roles). Confirmed by Anoop Das.

## Access model (final)

- **Owner and Admin:** full access to every page and every action. No ticks needed.
- **New sign-in:** sees nothing until an Owner or Admin approves the user.
- **Approval + ticks:** the Owner or Admin approves the user and ticks the pages they may use.
- **Each page has two ticks:** a **view** tick (see the page) and an **action** tick (change, add, edit, download).
  - Example: Hospitals view tick only = can see the page, cannot add or edit hospitals.
  - Example: Clean Data view tick and download tick = can see and download reports.
- **Run now button:** every approved user can press it, whatever ticks they have. *(Anoop's decision, 27-Oct.)*
- **Owner:** can change the access of every user, including Admin. Cannot have their own access changed (Owner always has full access).
- **Admin:** can change the access of Users. Cannot change Owner access. **Cannot change another Admin's access.** *(Anoop's decision, 27-Oct.)*
- **Nobody can change their own access.**
- **Settings > Users and Access:** Owner and Admin only.

## Database rule (live)

- Tick-based policies on `hospital_id_history`, `report_downloads`, `rule_upload_batches`. Live since 27-Oct-2026. Migration file: `20261027000024_tick_based_rls_3_tables.sql` (to be recorded in migration history).
- `private.has_tick(...)` already gives Owner and Admin every tick.

## Tests (approved in principle)

- Write automated tests for: Owner, Admin, approved User with some ticks, approved User with no ticks, unapproved sign-in.
- Expected results: unapproved and no-tick users see nothing on protected pages; Owner and Admin see everything; Admin cannot change another Admin.
