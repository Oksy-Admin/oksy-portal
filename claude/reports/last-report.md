# Last report – 31-Oct-2026: 1b-i applied to live, 1b-ii closed

**Status: 1b-i is live. 1b-ii is done. One decision needed: OK to apply the 1b-ii migration.**

## Done
- **1b-i on live.** I took a backup first (`supabase/.temp/backup_before_1b_i_20261031.sql`), then applied the migration. A read-only check matched the preview exactly: 103 header decisions (HOSPPVTP0001 33, HOSPPVTP0002 31, HOSPPVTP0003 39), no stored TDS decision, all 452 column rows filled in. The file is renamed to the version live recorded: `20261030194846`.
- **1b-ii built:**
  - Suggestions: an undecided header is pre-filled with the decision other hospitals of the same scheme made ("Same as ...").
  - "Confirm all": Owner/Admin see the list and count first; at most 50 per action; each bulk confirm has an Undo.
  - Golden fixtures of the 3 pilot sheets: tab names, headers and value-shape counts only, no cell values.
  - Playwright check passes. It runs on a dev-only page fed by the fixtures, because the live page needs a Google login.
  - HMS as if it were a new hospital: 30 of its 42 headers would be confirmed with one click.
- **Checks:** typecheck, lint and build pass; 244 tests pass. Database tests 12 and 13 (31 checks) pass on a scratch copy that runs the migrations in their original order.
- **Save speed:** each save makes one database call less. Measured without a login: about 120–150 ms per round trip. A timed save on live with a login was not done.

## Found by the fixtures
After the next run, the worker will put these on the decision list:
- Badagara: the DISCOUNT column has some text values.
- Badagara: "MEMBER NUMBER" was approved as Policy Holder Name (wrong).
- HMS: the date columns DOD, HARDCOPY SENT Date and PAYMENT FOLLOW UP DATE hold plain numbers in some tabs.

## Commits
- `e5caa5a` 1b-i applied to live; file renamed to `20261030194846`
- `610b95e` migration-order fix added to 1c
- `0ad74fd` bulk-confirm migration + database test 13 (not applied)
- `8c2eded` worker skips undone (withdrawn) decisions
- `2b4ebbb` page: suggestions, Confirm all, Undo, faster save
- `02fae59`, `036a406` golden fixtures + their test
- `48ac37b` Confirm all test on the fixtures
- `4ad9bea`, `acbcdb3` Playwright, and the Playwright check
- `0ba496e` close 1b-ii

## Decision needed
**Apply migration `20261031100000_mapping_bulk_confirm.sql` to live? Recommended: yes.**
- It adds `withdrawn_at` to `header_decisions` and a new table for bulk confirms.
- It must be on live before the end-of-stage push. Otherwise the new worker and page will not run on live.

## Next
1c.
