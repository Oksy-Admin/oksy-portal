import { describe, expect, it } from "vitest";
import type { StoredClaimRow } from "@oksy/rules";
import { claimNextRuleTrial, runOneRuleTrial, runRuleTrial } from "../src/rule-trial-runner.ts";
import { fakeDb } from "./fake-db.ts";

function claim(over: Partial<StoredClaimRow> = {}): Record<string, unknown> {
  return {
    record_uid: "u1",
    hospital_code: "HOSPPVTP0001",
    scheme: "PRIVATE",
    insurer_name: "Star Health",
    tpa_name: null,
    admission_date: "2026-10-01",
    discharge_date: "2026-10-05",
    casesheet_sent_date: null,
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

const staySince = (days: number, over: Partial<StoredClaimRow> = {}): Record<string, unknown> => claim({ los_days: days, ...over });

const ruleVersion = (over: Record<string, unknown> = {}) => ({
  rule_id: "R-W01",
  version: 1,
  status: "ACTIVE",
  hospital_filter: null,
  scheme_filter: null,
  insurer_filter: null,
  valid_from: null,
  valid_to: null,
  date_basis: null,
  severity: "W",
  check_definition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 30 }], issueField: "los_days" },
  action: "ASK_STAFF",
  staff_message: "Stay is {los_days} days.",
  ...over,
});

describe("runRuleTrial", () => {
  it("runs every ACTIVE rule, counts hits per rule, keeps 5 examples and counts clean claims", async () => {
    const db = fakeDb({
      rules: [{ rule_id: "R-W01", rule_type: "CHECK" }],
      rule_versions: [ruleVersion()],
      claims_staging: [staySince(45, { source_row: 1 }), staySince(10, { source_row: 2 }), staySince(50, { source_row: 3 })],
    });
    const summary = await runRuleTrial(db, "HOSPPVTP0001");
    expect(summary.totalClaims).toBe(3);
    expect(summary.cleanClaims).toBe(1);
    expect(summary.byRule["R-W01"]).toEqual({
      severity: "W",
      hits: 2,
      examples: [{ tab: "OCT 2026", row: 1 }, { tab: "OCT 2026", row: 3 }],
    });
  });

  it("never returns more than 5 examples for one rule even with many hits", async () => {
    const db = fakeDb({
      rules: [{ rule_id: "R-W01", rule_type: "CHECK" }],
      rule_versions: [ruleVersion()],
      claims_staging: Array.from({ length: 8 }, (_, i) => staySince(40, { source_row: i + 1 })),
    });
    const summary = await runRuleTrial(db, "HOSPPVTP0001");
    expect(summary.byRule["R-W01"]!.hits).toBe(8);
    expect(summary.byRule["R-W01"]!.examples).toHaveLength(5);
  });

  it("a RETIRED rule version never fires in a trial, same as a real run", async () => {
    const db = fakeDb({
      rules: [{ rule_id: "R-W01", rule_type: "CHECK" }],
      rule_versions: [ruleVersion({ status: "RETIRED" })],
      claims_staging: [staySince(45)],
    });
    const summary = await runRuleTrial(db, "HOSPPVTP0001");
    expect(summary.byRule).toEqual({});
    expect(summary.cleanClaims).toBe(1);
  });

  it("writes no questions: the summary never touches hospital_sheets, jobs or any question table", async () => {
    const db = fakeDb({
      rules: [{ rule_id: "R-W01", rule_type: "CHECK" }],
      rule_versions: [ruleVersion()],
      claims_staging: [staySince(45)],
    });
    await runRuleTrial(db, "HOSPPVTP0001");
    expect(db.tables.jobs).toBeUndefined();
    expect(db.tables.questions).toBeUndefined();
  });
});

describe("claimNextRuleTrial / runOneRuleTrial: the worker's own job loop", () => {
  it("claims a QUEUED trial, marks it RUNNING, then SUCCEEDED with its summary", async () => {
    const db = fakeDb({
      rule_trials: [{ id: "t1", status: "QUEUED", hospital_code: "HOSPPVTP0001" }],
      rules: [{ rule_id: "R-W01", rule_type: "CHECK" }],
      rule_versions: [ruleVersion()],
      claims_staging: [staySince(45)],
    });
    const claimed = await claimNextRuleTrial(db);
    expect(claimed).toEqual({ id: "t1", hospitalCode: "HOSPPVTP0001" });
    expect(db.tables.rule_trials![0]!.status).toBe("RUNNING");

    const outcome = await runOneRuleTrial(db, claimed!);
    expect(outcome).toBe("SUCCEEDED");
    const row = db.tables.rule_trials![0]!;
    expect(row.status).toBe("SUCCEEDED");
    expect((row.summary as { totalClaims: number }).totalClaims).toBe(1);
  });

  it("no QUEUED trial: claims nothing", async () => {
    const db = fakeDb({ rule_trials: [{ id: "t1", status: "RUNNING", hospital_code: "HOSPPVTP0001" }] });
    expect(await claimNextRuleTrial(db)).toBeNull();
  });
});
