import { describe, expect, it } from "vitest";
import { resolveTdsRate, selectRules, type RuleContext, type RuleVersion } from "../src/index.ts";

// File 04 section 10.2, file 12 A6, D-014, D-015, D-034, D-043, D-050.
const HMS = "HOSP32P000107";
const OTHER = "HOSP32P000001";

function rule(over: Partial<RuleVersion> & Pick<RuleVersion, "ruleId">): RuleVersion {
  return { version: 1, type: "CHECK", status: "ACTIVE", ...over };
}

const tds = (ruleId: string, value: string, over: Partial<RuleVersion> = {}): RuleVersion =>
  rule({ ruleId, type: "PARAMETER", parameterName: "tds_rate", parameterValue: value, dateBasis: "SETTLEMENT", ...over });

const R_T01 = tds("R-T01", "0.10");

function ctx(over: Partial<RuleContext> = {}): RuleContext {
  return {
    hospital: HMS,
    scheme: "PRIVATE",
    insurer: "Star Health",
    tpa: null,
    dates: { admission: "2026-08-01", discharge: "2026-08-05", settlement: "2026-08-20" },
    ...over,
  };
}

const ids = (rs: RuleVersion[]) => rs.map((r) => r.ruleId).sort();

describe("selectRules: filters (empty filter = all)", () => {
  const rules = [
    rule({ ruleId: "R-D01" }),
    rule({ ruleId: "R-K01", schemeFilter: "KASP" }),
    rule({ ruleId: "R-K02", schemeFilter: "PRIVATE" }),
    rule({ ruleId: "R-I01", insurerFilter: "Star Health" }),
    rule({ ruleId: "R-I02", insurerFilter: "New India Assurance" }),
    rule({ ruleId: "R-H10", hospitalFilter: HMS, insurerFilter: "Star Health" }),
    rule({ ruleId: "R-H11", hospitalFilter: OTHER, insurerFilter: "Star Health" }),
    rule({ ruleId: "R-H12", hospitalFilter: HMS, schemeFilter: "PRIVATE", insurerFilter: "Star Health" }),
    rule({ ruleId: "R-H13", hospitalFilter: HMS, schemeFilter: "KASP", insurerFilter: "Star Health" }),
  ];

  it("a global rule matches every row", () => {
    expect(ids(selectRules([rule({ ruleId: "R-D01" })], ctx({ hospital: OTHER, scheme: "KASP", insurer: null })).checks)).toEqual(["R-D01"]);
  });

  it("scheme, insurer, hospital+insurer and three filters each match only their rows", () => {
    expect(ids(selectRules(rules, ctx()).checks)).toEqual(["R-D01", "R-H10", "R-H12", "R-I01", "R-K02"]);
  });

  it("the insurer filter also matches the TPA of the row", () => {
    const r = [rule({ ruleId: "R-I03", insurerFilter: "Vidal Health TPA" })];
    expect(ids(selectRules(r, ctx({ insurer: "New India Assurance", tpa: "Vidal Health TPA" })).checks)).toEqual(["R-I03"]);
  });

  it("names are compared without case or extra spaces", () => {
    const r = [rule({ ruleId: "R-I01", insurerFilter: "Star Health" })];
    expect(ids(selectRules(r, ctx({ insurer: "  STAR   health " })).checks)).toEqual(["R-I01"]);
  });

  it("a row with no insurer does not match an insurer rule", () => {
    expect(ids(selectRules(rules, ctx({ insurer: null })).checks)).toEqual(["R-D01", "R-K02"]);
  });
});

describe("selectRules: status (D-043 shadow mode, never deleted)", () => {
  const rules = [
    rule({ ruleId: "R-D01" }),
    rule({ ruleId: "R-D02", version: 2, status: "PROPOSED" }),
    rule({ ruleId: "R-D03", status: "PREVIEWED" }),
    rule({ ruleId: "R-A04", status: "RETIRED" }),
  ];
  const s = selectRules(rules, ctx());

  it("only ACTIVE rules run normally", () => {
    expect(ids(s.checks)).toEqual(["R-D01"]);
  });

  it("PROPOSED and PREVIEWED rules run in shadow mode only", () => {
    expect(ids(s.shadowChecks)).toEqual(["R-D02", "R-D03"]);
  });

  it("RETIRED rules never run", () => {
    expect([...s.checks, ...s.shadowChecks].some((r) => r.ruleId === "R-A04")).toBe(false);
  });

  it("two ACTIVE versions of one rule are a configuration error", () => {
    const e = selectRules([rule({ ruleId: "R-D01" }), rule({ ruleId: "R-D01", version: 2 })], ctx());
    expect(e.configErrors.map((c) => c.kind)).toContain("TWO_ACTIVE_VERSIONS");
  });
});

describe("selectRules: date windows (D-034)", () => {
  // Star Health 2% settlement discount: paid = approved x 0.98 x 0.90, payments 07-Jul to 28-Sep-2026.
  const star = rule({
    ruleId: "R-H02",
    type: "PARAMETER",
    insurerFilter: "Star Health",
    parameterName: "expected_discount2_pct",
    parameterValue: "2",
    dateBasis: "SETTLEMENT",
    validFrom: "2026-07-07",
    validTo: "2026-09-28",
  });

  it("applies inside the window, both end days included", () => {
    for (const d of ["2026-07-07", "2026-08-20", "2026-09-28"]) {
      const s = selectRules([star], ctx({ dates: { settlement: d } }));
      expect(s.parameters.get("expected_discount2_pct")?.value).toBe("2");
    }
  });

  it("does not apply outside the window", () => {
    for (const d of ["2026-07-06", "2026-09-29"]) {
      const s = selectRules([star], ctx({ dates: { settlement: d } }));
      expect(s.parameters.has("expected_discount2_pct")).toBe(false);
    }
  });

  it("uses the row's own date basis: no settlement date means the dated rule cannot apply", () => {
    const s = selectRules([star], ctx({ dates: { admission: "2026-08-01" } }));
    expect(s.parameters.has("expected_discount2_pct")).toBe(false);
    expect(s.skippedNoDate.map((r) => r.ruleId)).toEqual(["R-H02"]);
  });
});

describe("selectRules: parameters, more specific wins (D-015)", () => {
  it("global R-T01 alone gives 10%", () => {
    const p = selectRules([R_T01], ctx()).parameters.get("tds_rate");
    expect(p).toMatchObject({ value: "0.10", ruleId: "R-T01", specificity: 0 });
  });

  it("TDS 0% for an insurer beats the default", () => {
    const s = selectRules([R_T01, tds("R-T02", "0", { insurerFilter: "Star Health" })], ctx());
    expect(s.parameters.get("tds_rate")).toMatchObject({ value: "0", ruleId: "R-T02", specificity: 1 });
    expect(s.configErrors).toEqual([]);
  });

  it("two TDS rates: the more specific one wins", () => {
    const s = selectRules(
      [R_T01, tds("R-T02", "0.05", { insurerFilter: "Star Health" }), tds("R-T03", "0.02", { schemeFilter: "PRIVATE", insurerFilter: "Star Health" })],
      ctx(),
    );
    expect(s.parameters.get("tds_rate")).toMatchObject({ value: "0.02", ruleId: "R-T03", specificity: 2 });
  });

  it("equal specificity with different values is a configuration error, no value picked", () => {
    const s = selectRules([R_T01, tds("R-T02", "0.05", { insurerFilter: "Star Health" }), tds("R-T03", "0.02", { schemeFilter: "PRIVATE" })], ctx());
    expect(s.parameters.has("tds_rate")).toBe(false);
    expect(s.configErrors).toEqual([
      expect.objectContaining({ kind: "EQUAL_SPECIFICITY_CONFLICT", parameterName: "tds_rate", ruleIds: ["R-T02", "R-T03"] }),
    ]);
  });

  it("equal specificity with the same value is not an error", () => {
    const s = selectRules([tds("R-T02", "0.05", { insurerFilter: "Star Health" }), tds("R-T03", "0.050", { schemeFilter: "PRIVATE" })], ctx());
    expect(s.configErrors).toEqual([]);
    expect(s.parameters.get("tds_rate")?.value).toBe("0.05");
  });

  it("overlapping date windows with different values at equal specificity are a configuration error", () => {
    const s = selectRules(
      [
        tds("R-T04", "0.01", { hospitalFilter: HMS, validFrom: "2026-04-01", validTo: "2027-03-31" }),
        tds("R-T05", "0", { hospitalFilter: HMS, validFrom: "2026-08-01", validTo: "2026-08-31" }),
      ],
      ctx(),
    );
    expect(s.configErrors.map((c) => c.kind)).toEqual(["EQUAL_SPECIFICITY_CONFLICT"]);
  });

  it("a PROPOSED parameter goes to shadow parameters only", () => {
    const s = selectRules([R_T01, tds("R-T02", "0", { insurerFilter: "Star Health", status: "PROPOSED" })], ctx());
    expect(s.parameters.get("tds_rate")?.value).toBe("0.10");
    expect(s.shadowParameters.get("tds_rate")).toMatchObject({ value: "0", ruleId: "R-T02" });
  });
});

describe("hospital Lower TDS Certificate with a financial-year window (D-050)", () => {
  // Certificate: 1% for FY 2026-27 (01-Apr-2026 to 31-Mar-2027) for the HMS hospital only.
  const ltc = tds("R-T06", "0.01", { hospitalFilter: HMS, validFrom: "2026-04-01", validTo: "2027-03-31" });

  it("inside the year: 1%, source RULE", () => {
    const r = resolveTdsRate(selectRules([R_T01, ltc], ctx()));
    expect(r).toEqual({ rate: "0.01", source: "RULE", ruleId: "R-T06" });
  });

  it("outside the year: back to the default 10%, source DEFAULT", () => {
    const r = resolveTdsRate(selectRules([R_T01, ltc], ctx({ dates: { settlement: "2026-03-31" } })));
    expect(r).toEqual({ rate: "0.10", source: "DEFAULT", ruleId: "R-T01" });
  });

  it("another hospital: the default", () => {
    const r = resolveTdsRate(selectRules([R_T01, ltc], ctx({ hospital: OTHER })));
    expect(r).toMatchObject({ rate: "0.10", source: "DEFAULT" });
  });

  it("a confirmed rate for the row beats every rule, source CONFIRMED", () => {
    const r = resolveTdsRate(selectRules([R_T01, ltc], ctx()), "0");
    expect(r).toEqual({ rate: "0", source: "CONFIRMED", ruleId: null });
  });

  it("no ACTIVE TDS rule (e.g. R-T01 still PROPOSED): no rate, never a guess", () => {
    expect(resolveTdsRate(selectRules([{ ...R_T01, status: "PROPOSED" }], ctx()))).toBeNull();
  });
});
