# Pilot fixes: DISCOUNT check, MEMBER NUMBER, duplicate key

Done. C: claims/page.tsx issue-pill key is now rule_id + index (was duplicate rule_id).

A + B share one root cause. Column Mappings' "Check again" state and "Accept anyway"
checkbox already exist and already work (checked against Badagara's live rows) -- tick
it under DISCOUNT and Save; the worker already honors accept_any_shape. The real bug:
decide_header() only ever cleared column_mappings.review_reason, never corrected
canonical_field, so DISCOUNT kept 2 stale per-tab IGNORE rows and MEMBER NUMBER kept its
old policy_holder_name guess after being decided policy_or_card_no. No claim data was
wrong -- the worker cleans from header_decisions, not column_mappings; this was display
only. Migration `20261101160000_column_mappings_sync_decision.sql`: decide_header() now
re-syncs canonical_field everywhere that header is used, bypassing the old G1 guard
trigger only for itself; a one-time backfill fixes both live rows. Not applied yet.

typecheck, lint, test (2 new pgTAP cases), build all pass. 2 commits on
`stage-2-rule-library`, not pushed: 65e690e, c9e181c.

Decision needed: OK the migration (backup `column_mappings` + `header_decisions`
first, same as every schema change) so Anoop can apply it to live.
