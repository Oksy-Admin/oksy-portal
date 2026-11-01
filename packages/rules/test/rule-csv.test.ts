import { describe, expect, it } from "vitest";
import { parseCondition, parseConditionGroup, parseRuleUploadCsv, parseRuleUploadRow, splitCsvLine } from "../src/index.ts";

describe("parseCondition", () => {
  it("reads a field-compares-field condition", () => {
    expect(parseCondition("approved_amount GREATER_THAN claimed_amount")).toEqual({ field: "approved_amount", operator: "GREATER_THAN", compareField: "claimed_amount" });
  });
  it("reads a literal number", () => {
    expect(parseCondition("los_days GREATER_THAN 30")).toEqual({ field: "los_days", operator: "GREATER_THAN", compareValue: 30 });
  });
  it("reads TODAY with an offset", () => {
    expect(parseCondition("discharge_date BEFORE TODAY-60")).toEqual({ field: "discharge_date", operator: "BEFORE", compareValue: "TODAY", offsetDays: -60 });
  });
  it("reads a tolerance for DIFFERS_BY_MORE_THAN", () => {
    expect(parseCondition("discount_amount DIFFERS_BY_MORE_THAN:1 deduction_amount")).toEqual({
      field: "discount_amount",
      operator: "DIFFERS_BY_MORE_THAN",
      toleranceAmount: 1,
      compareField: "deduction_amount",
    });
  });
  it("EMPTY takes no compared value", () => {
    expect(parseCondition("patient_name EMPTY")).toEqual({ field: "patient_name", operator: "EMPTY" });
  });
  it("rejects an unknown field", () => {
    expect(parseCondition("not_a_field EMPTY")).toEqual({ error: expect.stringContaining("unknown field") });
  });
  it("rejects EMPTY given a compared value", () => {
    expect(parseCondition("patient_name EMPTY 5")).toEqual({ error: expect.stringContaining("no compared value") });
  });
});

describe("parseConditionGroup", () => {
  it("splits on && as AND", () => {
    const g = parseConditionGroup("los_days GREATER_THAN 30 && approved_amount NOT_EMPTY");
    expect(g).toEqual({ logic: "AND", conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 30 }, { field: "approved_amount", operator: "NOT_EMPTY" }] });
  });
  it("splits on || as OR", () => {
    const g = parseConditionGroup("patient_name EMPTY || preauth_or_claim_no EMPTY");
    expect((g as { logic: string }).logic).toBe("OR");
  });
  it("refuses to mix && and ||", () => {
    expect(parseConditionGroup("a EMPTY && b EMPTY || c EMPTY")).toEqual({ error: expect.stringContaining("cannot mix") });
  });
  it("refuses more than 5 conditions", () => {
    const expr = Array(6).fill("patient_name EMPTY").join(" && ");
    expect(parseConditionGroup(expr)).toEqual({ error: expect.stringContaining("at most 5") });
  });
});

describe("splitCsvLine", () => {
  it("splits plain comma-separated cells", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("keeps a comma inside a quoted cell", () => {
    expect(splitCsvLine('a,"b, with comma",c')).toEqual(["a", "b, with comma", "c"]);
  });
  it("unescapes a doubled quote inside a quoted cell", () => {
    expect(splitCsvLine('"she said ""hi"""')).toEqual(['she said "hi"']);
  });
});

const VALID_CELLS = ["R-W02", "Stay over 45 days", "W", "ASK_STAFF", "", "", "", "", "", "los_days GREATER_THAN 45", "", "Length of stay is over 45 days."];

describe("parseRuleUploadRow", () => {
  it("accepts a well-formed row", () => {
    const r = parseRuleUploadRow(VALID_CELLS, 2);
    expect(r.ok).toBe(true);
    expect(r.draft?.ruleId).toBe("R-W02");
    expect(r.draft?.checkDefinition.issueField).toBe("los_days");
  });
  it("rejects a badly shaped rule ID", () => {
    const cells = [...VALID_CELLS];
    cells[0] = "W02";
    const r = parseRuleUploadRow(cells, 3);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Rule ID");
  });
  it("rejects a bad severity", () => {
    const cells = [...VALID_CELLS];
    cells[2] = "X";
    expect(parseRuleUploadRow(cells, 4).error).toContain("Severity");
  });
  it("rejects a condition with an unreadable term", () => {
    const cells = [...VALID_CELLS];
    cells[9] = "los_days WORSE_THAN 45";
    expect(parseRuleUploadRow(cells, 5).ok).toBe(false);
  });
});

describe("parseRuleUploadCsv", () => {
  it("parses a header row plus two data rows", () => {
    const csv = [
      "rule_id,title,severity,action,hospital_filter,scheme_filter,insurer_filter,valid_from,valid_to,condition,issue_field,staff_message",
      VALID_CELLS.join(","),
      "R-W03,Bad row,Z,ASK_STAFF,,,,,,,,oops",
    ].join("\n");
    const rows = parseRuleUploadCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.ok).toBe(true);
    expect(rows[1]!.ok).toBe(false);
    expect(rows[1]!.row).toBe(3);
  });
});
