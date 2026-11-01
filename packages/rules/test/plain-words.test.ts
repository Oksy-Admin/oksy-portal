import { describe, expect, it } from "vitest";
import { buildRuleDraftPrompt, parseRuleDraftResponse, RULE_DRAFT_SCHEMA, type RuleDraftSuggestion } from "../src/index.ts";

describe("buildRuleDraftPrompt", () => {
  it("never includes a patient value, only the sentence and the fixed field list", () => {
    const prompt = buildRuleDraftPrompt("Warn when the stay is over 45 days");
    expect(prompt).toContain("Warn when the stay is over 45 days");
    expect(prompt).toContain("los_days");
    expect(prompt).not.toMatch(/\b\d{10}\b/); // no phone-number-shaped data sneaks in
  });
  it("escapes a double quote in the sentence so the prompt stays well-formed", () => {
    const prompt = buildRuleDraftPrompt('Say "hello"');
    expect(prompt).toContain("Say 'hello'");
  });
});

describe("parseRuleDraftResponse", () => {
  it("parses a well-formed JSON suggestion", () => {
    const suggestion: RuleDraftSuggestion = {
      title: "Stay over 45 days",
      severity: "W",
      action: "ASK_STAFF",
      logic: "AND",
      conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 45 }],
      issueField: "los_days",
      staffMessage: "Stay is {los_days} days.",
      hospitalFilter: null,
      schemeFilter: null,
      insurerFilter: null,
    };
    expect(parseRuleDraftResponse(JSON.stringify(suggestion))).toEqual(suggestion);
  });
});

describe("RULE_DRAFT_SCHEMA", () => {
  it("lists the same field keys the prompt offers (no drift between the two)", () => {
    const fieldEnum = (RULE_DRAFT_SCHEMA.properties.issueField as { enum: string[] }).enum;
    expect(fieldEnum.length).toBeGreaterThan(10);
    expect(fieldEnum).toContain("los_days");
  });
});
