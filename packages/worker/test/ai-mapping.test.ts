import { describe, expect, it } from "vitest";
import { AI_MAX_CONFIDENCE, buildPrompt, columnShapes, mergeSuggestions } from "../src/ai-mapping.ts";
import { layoutOf, type RawTab } from "../src/sheet-data.ts";

// Fake values only. The AI is never called in tests.
const tab: RawTab = {
  name: "OCT 2026",
  rows: [
    [["Sl No", null, null], ["PATIENT NAME", null, null], ["Fake TPA", null, null], ["DOA", null, null], ["#VALUE!", null, null], ["UTR", null, null]],
    [["1", 1, null], ["Fake Patient Secret", null, null], ["Fake TPA", null, null], ["01/10/2026", null, null], ["#VALUE!", null, null], ["FAKEUTR123456", null, null]],
    [["2", 2, null], ["Fake Patient Other", null, null], ["Other Fake TPA", null, null], ["02/10/2026", null, null], ["4500", 4500, null], ["", null, null]],
  ],
};

describe("AI column mapping", () => {
  const layout = layoutOf(tab);

  it("the alias list maps the usual headers and leaves damaged ones open", () => {
    expect(layout.map.map((m) => [m.header, m.field, m.method])).toEqual([
      ["Sl No", "serial_no", "ALIAS"],
      ["PATIENT NAME", "patient_name", "ALIAS"],
      ["Fake TPA", null, "UNMATCHED"],
      ["DOA", "admission_date", "ALIAS"],
      ["#VALUE!", null, "UNMATCHED"],
      ["UTR", "payment_utr", "ALIAS"],
    ]);
  });

  it("column shapes are counts only", () => {
    const s = columnShapes(layout, tab);
    expect(s[2]).toMatchObject({ header: "Fake TPA", left: "PATIENT NAME", right: "DOA", filled: 2, text: 2 });
    expect(s[4]).toMatchObject({ filled: 2, errors: 1, numbers: 1 });
  });

  it("the prompt carries headers and counts, never a cell value", () => {
    const p = buildPrompt(layout, columnShapes(layout, tab));
    expect(p).toContain('header "Fake TPA"');
    expect(p).not.toContain("Fake Patient Secret");
    expect(p).not.toContain("FAKEUTR123456");
    expect(p).not.toContain("Other Fake TPA");
    expect(p).not.toContain("01/10/2026");
    expect(p).not.toContain("4500");
  });

  it("keeps only safe suggestions: open columns, known and unused fields, capped confidence", () => {
    const out = mergeSuggestions(layout.map, [
      { column: 2, field: "tpa_name", confidence: 0.99, reason: "TPA names under a TPA-name header" },
      { column: 4, field: "patient_name", confidence: 0.9, reason: "already mapped" },
      { column: 1, field: "doctor_name", confidence: 0.9, reason: "column already mapped by alias" },
      { column: 4, field: "not_a_field", confidence: 0.9, reason: "unknown" },
    ]);
    expect(out[2]).toMatchObject({ field: "tpa_name", method: "AI", confidence: AI_MAX_CONFIDENCE });
    expect(out[1]).toMatchObject({ field: "patient_name", method: "ALIAS" });
    expect(out[4]).toMatchObject({ field: null, method: "UNMATCHED" });
  });

  it("a later suggestion cannot take a field an earlier one took", () => {
    const out = mergeSuggestions(layout.map, [
      { column: 2, field: "tds_amount_stated", confidence: 0.6, reason: "" },
      { column: 4, field: "tds_amount_stated", confidence: 0.7, reason: "" },
    ]);
    expect(out.filter((m) => m.field === "tds_amount_stated")).toHaveLength(1);
  });
});
