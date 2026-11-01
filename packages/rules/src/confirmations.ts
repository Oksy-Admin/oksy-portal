// "Value is correct" (Stage 2c, decisions.md section 9): a confirmation's fingerprint is made
// from the cleaned values of only the fields the rule reads, so a format fix (spaces, date
// format) never clears it, and a real value change always does. Pure code: no database.
import { createHash } from "node:crypto";
import type { CheckDefinition } from "./engine.ts";
import type { CleanClaim } from "./clean.ts";

/**
 * The cross-row rules (decisions.md section 7) have no check_definition - the comparison is
 * in code (packages/worker/src/identity.ts, packages/rules/src/two-part.ts), the same allowed
 * exception as the reading-level REFERENCE rules. Their confirmable fields are listed once
 * here, by hand, same as a structural rule's message is by hand - not a business condition
 * read generically from data, because there is no CheckDefinition to read it from.
 */
const STRUCTURAL_CONFIRMATION_FIELDS: Record<string, string[]> = {
  "R-Y03": ["patient_name", "admission_date", "preauth_or_claim_no"],
  "R-K01": ["utr_no"],
  "R-K02": ["preauth_or_claim_no", "admission_date", "discharge_date"],
};

/** ctx field name -> CleanClaim field name, for the handful that differ. */
const CTX_TO_CLAIM_FIELD: Record<string, keyof CleanClaim> = {
  total_settled: "settled_amount",
  total_tds: "tds_amount",
  expected_settlement: "expected_settlement_amount",
};

export function claimFieldValue(claim: CleanClaim, field: string): unknown {
  const key = (CTX_TO_CLAIM_FIELD[field] ?? field) as keyof CleanClaim;
  return claim[key] ?? null;
}

/**
 * Which fields a confirmation of this rule+row should fingerprint. Generic for an
 * engine-driven rule (fieldsReadBy, exported by engine.ts); the fixed, hand-kept list above
 * for the few structural rules that have no CheckDefinition at all.
 */
export function fieldsForConfirmation(ruleId: string, checkDefinition: CheckDefinition | null, fieldsReadBy: (def: CheckDefinition) => string[]): string[] {
  if (checkDefinition) return fieldsReadBy(checkDefinition);
  return STRUCTURAL_CONFIRMATION_FIELDS[ruleId] ?? [];
}

/** Stable sha256 of the named fields' current cleaned values, sorted so field order never matters. */
export function computeFingerprint(fields: string[], claim: CleanClaim): string {
  const sorted = [...new Set(fields)].sort();
  const payload = sorted.map((f) => [f, claimFieldValue(claim, f)]);
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
