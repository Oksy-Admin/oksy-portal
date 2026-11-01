import { describe, expect, it } from "vitest";
import { computeFingerprint, fieldsForConfirmation, fieldsReadBy, type CheckDefinition, type CleanClaim } from "../src/index.ts";

// Stage 2c, decisions.md section 9, "value is correct": the fingerprint covers only the
// fields a rule reads, so a format fix never clears a confirmation but a real value change
// always does.
const claim = (over: Partial<CleanClaim> = {}): CleanClaim =>
  ({
    patient_name: "Fake Patient",
    admission_date: "2026-10-01",
    discharge_date: "2026-10-05",
    preauth_or_claim_no: "CLM010",
    approved_amount: "40000",
    settled_amount: "35000.00",
    tds_amount: "0.00",
    expected_settlement_amount: "40000.00",
    balance_amount: "5000.00",
    utr_no: ["FAKEUTR00010", "FAKEUTR00011"],
    remarks: null,
    ...over,
  }) as CleanClaim;

describe("fieldsForConfirmation", () => {
  it("an engine-driven rule: fieldsReadBy of its own check definition", () => {
    const def: CheckDefinition = { kind: "SIMPLE", logic: "AND", conditions: [{ field: "discount_amount", operator: "DIFFERS_BY_MORE_THAN", compareField: "deduction_amount", toleranceAmount: 1 }], issueField: "discount_amount" };
    expect(fieldsForConfirmation("R-F01", def, fieldsReadBy).sort()).toEqual(["deduction_amount", "discount_amount"]);
  });
  it("a structural rule with no check definition: the hand-kept list for that rule", () => {
    expect(fieldsForConfirmation("R-Y03", null, fieldsReadBy).sort()).toEqual(["admission_date", "patient_name", "preauth_or_claim_no"]);
    expect(fieldsForConfirmation("R-K01", null, fieldsReadBy)).toEqual(["utr_no"]);
    expect(fieldsForConfirmation("R-K02", null, fieldsReadBy).sort()).toEqual(["admission_date", "discharge_date", "preauth_or_claim_no"]);
  });
  it("an unknown structural rule (never confirmable): an empty list", () => {
    expect(fieldsForConfirmation("R-UNKNOWN", null, fieldsReadBy)).toEqual([]);
  });
});

describe("computeFingerprint", () => {
  it("is stable for the same values regardless of field order", () => {
    const a = computeFingerprint(["utr_no", "approved_amount"], claim());
    const b = computeFingerprint(["approved_amount", "utr_no"], claim());
    expect(a).toBe(b);
  });
  it("maps the ctx-only field names (total_settled, total_tds, expected_settlement) onto the CleanClaim's own names", () => {
    const a = computeFingerprint(["total_settled"], claim({ settled_amount: "35000.00" }));
    const b = computeFingerprint(["total_settled"], claim({ settled_amount: "35000.00" }));
    const c = computeFingerprint(["total_settled"], claim({ settled_amount: "47000.00" }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("changes when a fingerprinted field's value changes", () => {
    const a = computeFingerprint(["approved_amount"], claim({ approved_amount: "40000" }));
    const b = computeFingerprint(["approved_amount"], claim({ approved_amount: "41000" }));
    expect(a).not.toBe(b);
  });
  it("never changes when a field outside the list changes (a format fix elsewhere never clears a confirmation)", () => {
    const a = computeFingerprint(["approved_amount"], claim({ remarks: "old remark" }));
    const b = computeFingerprint(["approved_amount"], claim({ remarks: "a totally different remark" }));
    expect(a).toBe(b);
  });
  it("is a 64-character hex sha256", () => {
    expect(computeFingerprint(["approved_amount"], claim())).toMatch(/^[0-9a-f]{64}$/);
  });
});
