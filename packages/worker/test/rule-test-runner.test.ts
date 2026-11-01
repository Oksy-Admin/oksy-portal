import { describe, expect, it } from "vitest";
import type { StoredClaimRow } from "@oksy/rules";
import { claimNextRuleTest, runOneRuleTest, runRuleTest, type RuleTestDraft } from "../src/rule-test-runner.ts";
import { fakeDb } from "./fake-db.ts";

// Returned as Record<string, unknown>, not StoredClaimRow: fakeDb's seed rows need an index
// signature (PostgREST rows are untyped JSON), which a named interface does not structurally
// satisfy even when every field matches.
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

const draft = (over: Partial<RuleTestDraft> = {}): RuleTestDraft => ({
  ruleId: "R-W01",
  type: "CHECK",
  severity: "W",
  action: "ASK_STAFF",
  staffMessage: "Stay is {los_days} days.",
  checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 30 }], issueField: "los_days" },
  hospitalFilter: null,
  schemeFilter: null,
  insurerFilter: null,
  validFrom: null,
  validTo: null,
  dateBasis: null,
  ...over,
});

describe("runRuleTest", () => {
  it("counts hits per hospital and keeps up to 5 example row references", async () => {
    const db = fakeDb({
      claims_staging: [
        staySince(45, { hospital_code: "HOSPPVTP0001", source_row: 1 }),
        staySince(10, { hospital_code: "HOSPPVTP0001", source_row: 2 }),
        staySince(50, { hospital_code: "HOSPPVTP0002", source_row: 3 }),
      ],
    });
    const result = await runRuleTest(db, draft());
    expect(result.claimsScanned).toBe(3);
    expect(result.hitsByHospital).toEqual({ HOSPPVTP0001: 1, HOSPPVTP0002: 1 });
    expect(result.examples).toHaveLength(2);
    expect(result.examples[0]).toEqual({ hospitalCode: "HOSPPVTP0001", tab: "OCT 2026", row: 1 });
  });

  it("never returns more than 5 examples even with many hits", async () => {
    const db = fakeDb({ claims_staging: Array.from({ length: 8 }, (_, i) => staySince(40, { source_row: i + 1 })) });
    const result = await runRuleTest(db, draft());
    expect(result.examples).toHaveLength(5);
    expect(result.hitsByHospital.HOSPPVTP0001).toBe(8);
  });

  it("respects the draft's own scope (hospital filter), same logic as a real run", async () => {
    const db = fakeDb({
      claims_staging: [staySince(45, { hospital_code: "HOSPPVTP0001" }), staySince(45, { hospital_code: "HOSPPVTP0002" })],
    });
    const result = await runRuleTest(db, draft({ hospitalFilter: "HOSPPVTP0001" }));
    expect(result.hitsByHospital).toEqual({ HOSPPVTP0001: 1 });
  });

  it("never fires on a field only known at sheet-read time (documented limit, not a bug)", async () => {
    const db = fakeDb({ claims_staging: [claim()] });
    const result = await runRuleTest(
      db,
      draft({
        checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "status_colour_unconfirmed", operator: "FLAG_TRUE" }], issueField: "claim_status" },
      }),
    );
    expect(result.hitsByHospital).toEqual({});
  });

  it("a PARAMETER draft is not a check: an empty result, never an error", async () => {
    const db = fakeDb({ claims_staging: [claim()] });
    const result = await runRuleTest(db, draft({ type: "PARAMETER", checkDefinition: null }));
    expect(result).toEqual({ claimsScanned: 0, hitsByHospital: {}, examples: [] });
  });
});

describe("claimNextRuleTest / runOneRuleTest: the worker's own job loop", () => {
  it("claims a QUEUED run, marks it RUNNING, then SUCCEEDED with its result", async () => {
    const db = fakeDb({
      rule_test_runs: [{ id: "t1", status: "QUEUED", draft: draft() }],
      claims_staging: [staySince(45)],
    });
    const claimed = await claimNextRuleTest(db);
    expect(claimed?.id).toBe("t1");
    expect(db.tables.rule_test_runs![0]!.status).toBe("RUNNING");

    const outcome = await runOneRuleTest(db, claimed!);
    expect(outcome).toBe("SUCCEEDED");
    const row = db.tables.rule_test_runs![0]!;
    expect(row.status).toBe("SUCCEEDED");
    expect((row.result as { hitsByHospital: Record<string, number> }).hitsByHospital).toEqual({ HOSPPVTP0001: 1 });
  });

  it("no QUEUED run: claims nothing", async () => {
    const db = fakeDb({ rule_test_runs: [{ id: "t1", status: "RUNNING", draft: draft() }] });
    expect(await claimNextRuleTest(db)).toBeNull();
  });
});
