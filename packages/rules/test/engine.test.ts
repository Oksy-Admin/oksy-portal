import { describe, expect, it } from "vitest";
import { evaluateRule, evaluateRules, fieldsReadBy, type CheckDefinition, type EngineContext, type EngineRule } from "../src/index.ts";

// Stage 2a: the engine is fixed code (operators, SIMPLE / SIMPLE_FOR_EACH); every threshold,
// field, scope, severity, action and message a rule uses comes from the rule itself.
const ctx = (values: EngineContext["values"], today = "2026-10-26"): EngineContext => ({ today, values });

function simpleRule(over: Partial<EngineRule> = {}): EngineRule {
  return {
    ruleId: "R-X",
    version: 1,
    severity: "E",
    action: "ASK_STAFF",
    staffMessage: "{field} failed.",
    checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "approved_amount", operator: "GREATER_THAN", compareField: "bill_amount" }], issueField: "approved_amount" },
    ...over,
  };
}

describe("engine: field comparisons never guess on missing data", () => {
  it("GREATER_THAN with a missing field never fires", () => {
    expect(evaluateRule(simpleRule(), ctx({ approved_amount: "100", bill_amount: null }))).toEqual([]);
  });
  it("GREATER_THAN fires when both sides are readable amounts", () => {
    const hits = evaluateRule(simpleRule(), ctx({ approved_amount: "120", bill_amount: "100" }));
    expect(hits).toEqual([{ ruleId: "R-X", version: 1, severity: "E", field: "approved_amount", action: "ASK_STAFF", message: "approved_amount failed." }]);
  });
  it("EQUALS with a tolerance treats a 1-rupee difference as equal", () => {
    const r = simpleRule({
      checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "total_settled", operator: "EQUALS", compareField: "approved_amount", toleranceAmount: 1 }], issueField: "settled_amount" },
    });
    expect(evaluateRule(r, ctx({ total_settled: "99999.50", approved_amount: "100000" }))).toHaveLength(1);
    expect(evaluateRule(r, ctx({ total_settled: "99990", approved_amount: "100000" }))).toEqual([]);
  });
  it("DIFFERS_BY_MORE_THAN only fires past the tolerance", () => {
    const r = simpleRule({
      checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "total_tds", operator: "DIFFERS_BY_MORE_THAN", compareField: "expected_tds_amount", toleranceAmount: 1 }], issueField: "tds_amount_stated" },
    });
    expect(evaluateRule(r, ctx({ total_tds: "9999.50", expected_tds_amount: "10000" }))).toEqual([]);
    expect(evaluateRule(r, ctx({ total_tds: "8000", expected_tds_amount: "10000" }))).toHaveLength(1);
  });
});

describe("engine: EMPTY / NOT_EMPTY / FLAG", () => {
  const r = simpleRule({ checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "patient_name", operator: "EMPTY" }], issueField: "patient_name" } });
  it("EMPTY matches null, undefined and an empty string", () => {
    expect(evaluateRule(r, ctx({ patient_name: null }))).toHaveLength(1);
    expect(evaluateRule(r, ctx({}))).toHaveLength(1);
    expect(evaluateRule(r, ctx({ patient_name: "" }))).toHaveLength(1);
    expect(evaluateRule(r, ctx({ patient_name: "Jane" }))).toEqual([]);
  });
  it("FLAG_TRUE / FLAG_FALSE read only booleans", () => {
    const flagRule = simpleRule({ checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "is_settled", operator: "FLAG_TRUE" }], issueField: "claim_status" } });
    expect(evaluateRule(flagRule, ctx({ is_settled: true }))).toHaveLength(1);
    expect(evaluateRule(flagRule, ctx({ is_settled: false }))).toEqual([]);
  });
});

describe("engine: AND vs OR, up to 5 conditions", () => {
  const def = (logic: "AND" | "OR") => simpleRule({
    checkDefinition: {
      kind: "SIMPLE",
      logic,
      conditions: [{ field: "a", operator: "FLAG_TRUE" }, { field: "b", operator: "FLAG_TRUE" }],
      issueField: "claim_status",
    },
  });
  it("AND needs every condition", () => {
    expect(evaluateRule(def("AND"), ctx({ a: true, b: false }))).toEqual([]);
    expect(evaluateRule(def("AND"), ctx({ a: true, b: true }))).toHaveLength(1);
  });
  it("OR needs only one", () => {
    expect(evaluateRule(def("OR"), ctx({ a: true, b: false }))).toHaveLength(1);
    expect(evaluateRule(def("OR"), ctx({ a: false, b: false }))).toEqual([]);
  });
});

describe("engine: BEFORE / AFTER, including TODAY with an offset", () => {
  it("compares two date fields", () => {
    const r = simpleRule({ checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "discharge_date", operator: "BEFORE", compareField: "admission_date" }], issueField: "discharge_date" } });
    expect(evaluateRule(r, ctx({ discharge_date: "2026-08-01", admission_date: "2026-08-05" }))).toHaveLength(1);
    expect(evaluateRule(r, ctx({ discharge_date: "2026-08-05", admission_date: "2026-08-01" }))).toEqual([]);
  });
  it("TODAY - 60 days (R-S09: approved and overdue)", () => {
    const r = simpleRule({
      checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "discharge_date", operator: "BEFORE", compareValue: "TODAY", offsetDays: -60 }], issueField: "approved_amount" },
    });
    expect(evaluateRule(r, ctx({ discharge_date: "2026-08-01" }, "2026-10-26"))).toHaveLength(1); // 86 days ago
    expect(evaluateRule(r, ctx({ discharge_date: "2026-10-20" }, "2026-10-26"))).toEqual([]); // 6 days ago
  });
});

describe("engine: SIMPLE_FOR_EACH (R-N04 shape)", () => {
  const r = simpleRule({
    checkDefinition: { kind: "SIMPLE_FOR_EACH", fieldList: ["department", "treatment_or_surgery", "doctor_name"], operator: "EMPTY" },
    staffMessage: "{field} is empty.",
  });
  it("one issue per empty field in the list, none for a filled one", () => {
    const hits = evaluateRule(r, ctx({ department: null, treatment_or_surgery: "Ortho", doctor_name: "" }));
    expect(hits.map((h) => h.field)).toEqual(["department", "doctor_name"]);
    expect(hits[0]?.message).toBe("department is empty.");
  });
  it("no issues when every field in the list is filled", () => {
    expect(evaluateRule(r, ctx({ department: "Ortho", treatment_or_surgery: "Surgery", doctor_name: "Dr. X" }))).toEqual([]);
  });
});

describe("engine: evaluateRules runs the whole active list", () => {
  it("collects issues from several rules, skips the ones that do not match", () => {
    const rules: EngineRule[] = [
      simpleRule({ ruleId: "R-1", checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "a", operator: "FLAG_TRUE" }], issueField: "f1" } }),
      simpleRule({ ruleId: "R-2", checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "b", operator: "FLAG_TRUE" }], issueField: "f2" } }),
    ];
    expect(evaluateRules(rules, ctx({ a: true, b: false })).map((h) => h.ruleId)).toEqual(["R-1"]);
  });
  it("a rule with no check_definition (REFERENCE / PARAMETER rows) never fires", () => {
    expect(evaluateRule(simpleRule({ checkDefinition: null }), ctx({ approved_amount: "9999999" }))).toEqual([]);
  });
});

// Stage 2c, decisions.md section 9: a "value is correct" confirmation is fingerprinted from
// exactly these fields, never the issueField by itself (issueField is only where the issue is
// attached - see R-F04, whose issueField "settled_amount" is never a condition field at all).
describe("engine: fieldsReadBy", () => {
  it("SIMPLE: every condition's field and compareField, never the issueField, no duplicates", () => {
    const def: CheckDefinition = {
      kind: "SIMPLE",
      logic: "AND",
      conditions: [
        { field: "total_settled", operator: "NOT_EMPTY" },
        { field: "total_settled", operator: "DIFFERS_BY_MORE_THAN", compareField: "expected_settlement", toleranceAmount: 1 },
      ],
      issueField: "settled_amount",
    };
    expect(fieldsReadBy(def).sort()).toEqual(["expected_settlement", "total_settled"]);
  });
  it("SIMPLE: a literal compareValue (not a field) contributes nothing", () => {
    const def: CheckDefinition = { kind: "SIMPLE", logic: "AND", conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 30 }], issueField: "discharge_date" };
    expect(fieldsReadBy(def)).toEqual(["los_days"]);
  });
  it("SIMPLE_FOR_EACH: the whole field list plus compareField", () => {
    const def: CheckDefinition = { kind: "SIMPLE_FOR_EACH", fieldList: ["department", "treatment_or_surgery", "doctor_name"], operator: "EMPTY" };
    expect(fieldsReadBy(def).sort()).toEqual(["department", "doctor_name", "treatment_or_surgery"]);
  });
});
