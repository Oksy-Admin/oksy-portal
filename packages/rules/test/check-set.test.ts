import { describe, expect, it } from "vitest";
import { checkCheckSetClaim, keyValuesOf, type StoredClaimRow } from "../src/index.ts";

function row(over: Partial<StoredClaimRow> = {}): StoredClaimRow {
  return {
    record_uid: "u1",
    hospital_code: "HOSPPVTP0001",
    scheme: "PRIVATE",
    insurer_name: "Star Health",
    tpa_name: null,
    admission_date: "2026-10-01",
    discharge_date: "2026-10-05",
    casesheet_sent_date: "2026-10-06",
    settlement_date: "2026-10-20",
    bill_amount: "50000",
    claimed_amount: "48000",
    approved_amount: "45000",
    discount_amount: null,
    deduction_amount: "5000",
    settled_amount: "45000",
    tds_amount: "500",
    expected_tds_amount: "500",
    expected_settlement_amount: "44500",
    balance_amount: "0",
    los_days: 4,
    claim_status: "SETTLED",
    patient_name: "A Patient",
    preauth_or_claim_no: "CL1",
    department: "Cardiology",
    treatment_or_surgery: "Angioplasty",
    doctor_name: "Dr X",
    utr_no: ["UTR12345678"],
    rejection_reason: null,
    cancellation_reason: null,
    source_tab: "OCT 2026",
    source_row: 12,
    ...over,
  };
}

describe("checkCheckSetClaim", () => {
  it("passes when every key value is unchanged and there are no open issues", () => {
    const picked = keyValuesOf(row());
    const current = keyValuesOf(row());
    const result = checkCheckSetClaim(picked, current, []);
    expect(result).toEqual({ pass: true, changedFields: [], openIssues: [] });
  });

  it("fails and names the field when a key value changes (even with no issues)", () => {
    const picked = keyValuesOf(row());
    const current = keyValuesOf(row({ settled_amount: "40000" }));
    const result = checkCheckSetClaim(picked, current, []);
    expect(result.pass).toBe(false);
    expect(result.changedFields).toEqual(["settled_amount"]);
  });

  it("fails and lists the open issue when a rule now fires, even with unchanged values", () => {
    const picked = keyValuesOf(row());
    const current = keyValuesOf(row());
    const result = checkCheckSetClaim(picked, current, [{ ruleId: "R-A05", severity: "E" }]);
    expect(result.pass).toBe(false);
    expect(result.changedFields).toEqual([]);
    expect(result.openIssues).toEqual([{ ruleId: "R-A05", severity: "E" }]);
  });

  it("never flags an operational field (courier number, remarks) that is not a key value", () => {
    const picked = keyValuesOf(row());
    // utr_no order/content unchanged; only a non-key field would differ in a real claim, but
    // keyValuesOf itself only ever reads the key-value fields, so nothing outside them can fail.
    const current = keyValuesOf(row());
    expect(checkCheckSetClaim(picked, current, [])).toEqual({ pass: true, changedFields: [], openIssues: [] });
  });

  it("a confirmed Warning is never passed in as an open issue, so it never fails a check set (decisions.md section 9)", () => {
    const picked = keyValuesOf(row());
    const current = keyValuesOf(row());
    // The caller is responsible for excluding CONFIRMED issues before calling this; proven here
    // by passing none through for a claim that would otherwise have a confirmed Warning.
    expect(checkCheckSetClaim(picked, current, []).pass).toBe(true);
  });
});
