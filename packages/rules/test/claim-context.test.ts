import { describe, expect, it } from "vitest";
import { contextFromStoredClaim, evaluateRule, type EngineRule, type StoredClaimRow } from "../src/index.ts";

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
    settlement_date: null,
    bill_amount: "50000",
    claimed_amount: "48000",
    approved_amount: "45000",
    discount_amount: null,
    deduction_amount: "5000",
    settled_amount: null,
    tds_amount: null,
    expected_tds_amount: null,
    expected_settlement_amount: null,
    balance_amount: null,
    los_days: 4,
    claim_status: "APPROVED",
    patient_name: "A Patient",
    preauth_or_claim_no: "CL1",
    department: "Cardiology",
    treatment_or_surgery: "Angioplasty",
    doctor_name: "Dr X",
    utr_no: [],
    rejection_reason: null,
    cancellation_reason: null,
    source_tab: "OCT 2026",
    source_row: 12,
    ...over,
  };
}

describe("contextFromStoredClaim: the stored claim's flags are reconstructed, not re-read", () => {
  it("derives is_approved / is_settled and has_utr from the stored status and UTR array", () => {
    const ctx = contextFromStoredClaim(row(), "2026-11-01");
    expect(ctx.values.is_approved).toBe(true);
    expect(ctx.values.is_settled).toBe(false);
    expect(ctx.values.has_utr).toBe(false);
    expect(ctx.values.approved_amount).toBe("45000");
  });

  it("a rule on a derived flag (R-A05-like) fires against the reconstructed context", () => {
    const rule: EngineRule = {
      ruleId: "R-TEST",
      version: 1,
      severity: "E",
      action: "ASK_STAFF",
      staffMessage: "Approved claim missing approved amount.",
      checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "is_approved_or_settled", operator: "FLAG_TRUE" }, { field: "approved_amount", operator: "EMPTY" }], issueField: "approved_amount" },
    };
    const missing = contextFromStoredClaim(row({ approved_amount: null }), "2026-11-01");
    expect(evaluateRule(rule, missing)).toHaveLength(1);
    const present = contextFromStoredClaim(row(), "2026-11-01");
    expect(evaluateRule(rule, present)).toHaveLength(0);
  });

  it("read-time-only flags (colour, status disagreement, date swap) are always false", () => {
    const ctx = contextFromStoredClaim(row(), "2026-11-01");
    expect(ctx.values.status_colour_unconfirmed).toBe(false);
    expect(ctx.values.status_sources_disagree).toBe(false);
    expect(ctx.values.date_swap_unresolved).toBe(false);
  });

  it("a UTR that is too short is flagged invalid, same shape rule as clean.ts", () => {
    const ctx = contextFromStoredClaim(row({ utr_no: ["AB1"] }), "2026-11-01");
    expect(ctx.values.utr_shape_invalid).toBe(true);
    expect(ctx.values.has_utr).toBe(true);
  });

  it("reason_missing_for_rejected_or_cancelled only fires when both reasons are blank", () => {
    const noReason = contextFromStoredClaim(row({ claim_status: "REJECTED" }), "2026-11-01");
    expect(noReason.values.reason_missing_for_rejected_or_cancelled).toBe(true);
    const withReason = contextFromStoredClaim(row({ claim_status: "REJECTED", rejection_reason: "duplicate" }), "2026-11-01");
    expect(withReason.values.reason_missing_for_rejected_or_cancelled).toBe(false);
  });
});
