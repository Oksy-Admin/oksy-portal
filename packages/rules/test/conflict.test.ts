import { describe, expect, it } from "vitest";
import { findCheckConflicts, findParameterConflicts, scopesOverlap, type ExistingCheckVersion } from "../src/index.ts";

describe("scopesOverlap", () => {
  it("an unset filter means 'all', so it always overlaps", () => {
    expect(scopesOverlap({}, { hospitalFilter: "HOSPPVTP0001" })).toBe(true);
  });
  it("two different hospital filters never overlap", () => {
    expect(scopesOverlap({ hospitalFilter: "HOSPPVTP0001" }, { hospitalFilter: "HOSPPVTP0002" })).toBe(false);
  });
  it("scheme names are compared case- and space-insensitively", () => {
    expect(scopesOverlap({ schemeFilter: "private health insurance" }, { schemeFilter: "PRIVATE  HEALTH INSURANCE" })).toBe(true);
  });
});

describe("findParameterConflicts: two TDS rates for the same scope (the plan's own example)", () => {
  const existing: ExistingCheckVersion[] = [
    { ruleId: "R-T01", version: 1, type: "PARAMETER", status: "ACTIVE", parameterName: "tds_rate", parameterValue: "0.10" },
    { ruleId: "R-T02", version: 1, type: "PARAMETER", status: "ACTIVE", parameterName: "tds_rate", parameterValue: "0.05", insurerFilter: "Star Health" },
  ];

  it("flags a different rate for an overlapping scope", () => {
    const conflicts = findParameterConflicts({ ruleId: "R-T03", type: "PARAMETER", parameterName: "tds_rate", parameterValue: "0.07", insurerFilter: "Star Health" }, existing);
    expect(conflicts.map((c) => c.otherRuleId).sort()).toEqual(["R-T01", "R-T02"]);
  });

  it("does not flag the same rate", () => {
    const conflicts = findParameterConflicts({ ruleId: "R-T03", type: "PARAMETER", parameterName: "tds_rate", parameterValue: "0.10" }, existing.filter((r) => r.ruleId === "R-T01"));
    expect(conflicts).toHaveLength(0);
  });

  it("does not flag a different parameter name", () => {
    const conflicts = findParameterConflicts({ ruleId: "R-T03", type: "PARAMETER", parameterName: "other_rate", parameterValue: "0.07" }, existing);
    expect(conflicts).toHaveLength(0);
  });

  it("ignores a RETIRED rule's old value", () => {
    const retired: ExistingCheckVersion[] = [{ ruleId: "R-T01", version: 1, type: "PARAMETER", status: "RETIRED", parameterName: "tds_rate", parameterValue: "0.20" }];
    expect(findParameterConflicts({ ruleId: "R-T03", type: "PARAMETER", parameterName: "tds_rate", parameterValue: "0.10" }, retired)).toHaveLength(0);
  });
});

describe("findCheckConflicts: same field, opposite direction or a different number", () => {
  it("flags the opposite operator on the same field and overlapping scope", () => {
    const existing: ExistingCheckVersion[] = [
      { ruleId: "R-W02", version: 1, type: "CHECK", status: "ACTIVE", checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "los_days", operator: "LESS_THAN", compareValue: 3 }], issueField: "discharge_date" } },
    ];
    const conflicts = findCheckConflicts(
      { ruleId: "R-W01", type: "CHECK", checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 30 }], issueField: "discharge_date" } },
      existing,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.otherRuleId).toBe("R-W02");
  });

  it("flags the same operator with a different literal number", () => {
    const existing: ExistingCheckVersion[] = [
      { ruleId: "R-W02", version: 2, type: "CHECK", status: "PROPOSED", checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 45 }], issueField: "discharge_date" } },
    ];
    const conflicts = findCheckConflicts(
      { ruleId: "R-W01", type: "CHECK", checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 30 }], issueField: "discharge_date" } },
      existing,
    );
    expect(conflicts).toHaveLength(1);
  });

  it("never flags a condition that compares against another field, only literal numbers", () => {
    const existing: ExistingCheckVersion[] = [
      { ruleId: "R-A01", version: 1, type: "CHECK", status: "ACTIVE", checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "approved_amount", operator: "GREATER_THAN", compareField: "claimed_amount" }], issueField: "approved_amount" } },
    ];
    const conflicts = findCheckConflicts(
      { ruleId: "R-A09", type: "CHECK", checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "approved_amount", operator: "GREATER_THAN", compareField: "bill_amount" }], issueField: "approved_amount" } },
      existing,
    );
    expect(conflicts).toHaveLength(0);
  });

  it("never flags a non-overlapping scope (different hospitals)", () => {
    const existing: ExistingCheckVersion[] = [
      {
        ruleId: "R-W02",
        version: 1,
        type: "CHECK",
        status: "ACTIVE",
        hospitalFilter: "HOSPPVTP0002",
        checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 45 }], issueField: "discharge_date" },
      },
    ];
    const conflicts = findCheckConflicts(
      {
        ruleId: "R-W01",
        type: "CHECK",
        hospitalFilter: "HOSPPVTP0001",
        checkDefinition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 30 }], issueField: "discharge_date" },
      },
      existing,
    );
    expect(conflicts).toHaveLength(0);
  });
});
