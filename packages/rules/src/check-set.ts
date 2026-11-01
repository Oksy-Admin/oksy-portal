// Check sets (stage-plan 2e, decisions.md section 9 "Rule trial before questions go out"):
// Anoop picks a handful of claims per pilot that he knows are correct; after any mapping,
// rule or dictionary change the next run re-checks them against the snapshot taken when
// picked. Pure code: the caller reads the picked snapshot, the current stored row and the
// claim's current open issues, and passes all three in -- no database here.
import type { StoredClaimRow } from "./claim-context.ts";

/** The fields a picked claim is checked against on every later run ("same key values"):
 * money, status and the dates/identifiers that decide them -- not operational text fields
 * (courier number, remarks) that can change without the claim itself having changed. */
export const KEY_VALUE_FIELDS = [
  "claim_status",
  "bill_amount",
  "claimed_amount",
  "approved_amount",
  "discount_amount",
  "deduction_amount",
  "settled_amount",
  "tds_amount",
  "expected_tds_amount",
  "expected_settlement_amount",
  "balance_amount",
  "admission_date",
  "discharge_date",
  "settlement_date",
  "utr_no",
  "rejection_reason",
  "cancellation_reason",
] as const satisfies readonly (keyof StoredClaimRow)[];

export type KeyValueField = (typeof KEY_VALUE_FIELDS)[number];
export type KeyValues = { [K in KeyValueField]: StoredClaimRow[K] };

/** The snapshot stored in `check_set_claims.key_values` when a claim is picked. */
export function keyValuesOf(row: StoredClaimRow): KeyValues {
  return Object.fromEntries(KEY_VALUE_FIELDS.map((f) => [f, row[f]])) as KeyValues;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export interface OpenIssueRef {
  ruleId: string;
  severity: "E" | "W";
}

export interface CheckSetResult {
  pass: boolean;
  /** Key-value fields that differ from the picked snapshot (empty when nothing changed). */
  changedFields: KeyValueField[];
  /** Open Errors/Warnings on the claim right now (Confirmed Warnings never appear here --
   * decisions.md section 9, "confirmed Warnings count as cleared"). */
  openIssues: OpenIssueRef[];
}

/**
 * pass = zero Errors/Warnings open on the claim right now AND every key value still matches
 * what was picked (stage-plan 2e). Everything else is a fail, with enough detail ("the rule
 * or value that changed") to show on the trial page.
 */
export function checkCheckSetClaim(picked: KeyValues, current: KeyValues, openIssues: OpenIssueRef[]): CheckSetResult {
  const changedFields = KEY_VALUE_FIELDS.filter((f) => !sameValue(picked[f], current[f]));
  return { pass: changedFields.length === 0 && openIssues.length === 0, changedFields, openIssues };
}
