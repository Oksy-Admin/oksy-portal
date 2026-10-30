import { joinColumnValues, mapHeaders, MULTI_COLUMN_FIELDS } from "@oksy/rules";
import { describe, expect, it } from "vitest";
import { applyConfirmed, refreshBase, type MappingRow } from "../src/discovery.ts";
import { layoutOf, sourceRows, type RawCell, type RawTab } from "../src/sheet-data.ts";

// Item 2 (decision 27-Oct-2026): two REMARK columns feed one field "remarks", joined with " | ".
const cell = (v: string): RawCell => [v === "" ? null : v, null, null];
const tab = (r1: string, r2: string): RawTab => ({
  name: "OCT 2026",
  rows: [
    ["Sl No", "PATIENT NAME", "CLAIM NO", "REMARK", "DOA", "REMARK"].map(cell),
    ["1", "Fake Patient One", "FAKEOCT001", r1, "01/10/2026", r2].map(cell),
  ],
});

describe("several columns to one remarks field (Item 2)", () => {
  it("only remarks takes several columns", () => {
    expect(MULTI_COLUMN_FIELDS).toEqual(["remarks"]);
  });

  it("both REMARK columns map to remarks, not DUPLICATE_HEADER; other repeats stay duplicates", () => {
    const m = mapHeaders(["REMARK", "DOA", "REMARK", "DOA", "Claim Remark"]);
    expect(m.map((x) => [x.field, x.method])).toEqual([
      ["remarks", "ALIAS"],
      ["admission_date", "ALIAS"],
      ["remarks", "ALIAS"],
      [null, "DUPLICATE_HEADER"],
      ["remarks", "ALIAS"],
    ]);
  });

  it("two columns with values: joined with ' | ' in column order", () => {
    const [row] = sourceRows(tab("first fake note", "second fake note"), layoutOf(tab("", "")));
    expect(row!.cells.remarks?.text).toBe("REMARK: first fake note | REMARK: second fake note");
    expect(row!.extra).toEqual({}); // no "REMARK (column 6)" left over: one remark column in the report
  });

  it("one empty: only the other value, no separator", () => {
    const l = layoutOf(tab("", ""));
    expect(sourceRows(tab("", "second fake note"), l)[0]!.cells.remarks?.text).toBe("REMARK: second fake note");
    expect(sourceRows(tab("first fake note", "  "), l)[0]!.cells.remarks?.text).toBe("REMARK: first fake note");
  });

  it("both empty: no value", () => {
    const [row] = sourceRows(tab("", ""), layoutOf(tab("", "")));
    expect(row!.cells.remarks?.text).toBeNull();
  });

  it("joinColumnValues", () => {
    expect(joinColumnValues(["a", null, "", " b ", "c"])).toBe("a | b | c");
    expect(joinColumnValues([null, " "])).toBeNull();
  });

  it("a confirmed layout with both columns approved as remarks (Badagara OCT 2026) joins them", () => {
    const raw = tab("first fake note", "second fake note");
    const fp = layoutOf(raw).fingerprint;
    const fields = ["serial_no", "patient_name", "preauth_or_claim_no", "remarks", "admission_date", "remarks"];
    const confirmed: MappingRow[] = fields.map((f, i) => ({
      id: `m${i}`, tab_name: "OCT 2026", header_fp: fp, source_column: i, canonical_field: f, status: "APPROVED", approved_by: "fake-user-1", approved_at: "2026-10-27T05:00:00Z",
    }));
    const [row] = sourceRows(raw, applyConfirmed(layoutOf(raw), confirmed));
    expect(row!.cells.remarks?.text).toBe("REMARK: first fake note | REMARK: second fake note");
    // Re-proposing: an approved remarks column does not take remarks off the other REMARK column.
    const base = refreshBase(layoutOf(raw), [confirmed[3]!]);
    expect(base[5]?.field).toBe("remarks");
  });
});
