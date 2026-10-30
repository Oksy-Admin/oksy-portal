import { describe, expect, it } from "vitest";
import { coreFieldDefs, headerKey, resolveLayout, valueShape, VALUE_SHAPES, type HeaderDecision, type ValueShape } from "../src/index.ts";
import badagara from "./fixtures/pilots/HOSPPVTP0001.json" with { type: "json" };
import treeG from "./fixtures/pilots/HOSPPVTP0002.json" with { type: "json" };
import hms from "./fixtures/pilots/HOSPPVTP0003.json" with { type: "json" };

// Golden fixtures of the 3 pilot sheets (decision 31-Oct): headers and value-shape counts per
// column, plus each hospital's header decisions. No cell value is stored. Regenerate with
//   node packages/worker/scripts/golden-fixtures.ts
interface Fixture {
  hospital_code: string;
  scheme: string;
  tabs: Array<{ tab: string; header_row: number | null; columns: Array<{ column: number; header: string; shapes: Record<ValueShape, number> }> }>;
  decisions: HeaderDecision[];
}
const fixtures = [badagara, treeG, hms] as Fixture[];
const pilot = (code: string) => fixtures.find((f) => f.hospital_code === code)!;

/** One made-up value per shape, so the value-shape check sees the same mix as the sheet. */
const SAMPLE: Record<ValueShape, string> = { blank: "", percent: "10%", date: "12/10/2026", small_number: "10", number: "12500", amount: "₹12,500", text: "Fake text" };
const valuesOf = (shapes: Record<ValueShape, number>) => VALUE_SHAPES.flatMap((s) => Array<string>(shapes[s] ?? 0).fill(SAMPLE[s]));

/** What the decision core says for every tab: "header|reason" -> tabs. */
function needsOf(fx: Fixture): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of fx.tabs) {
    const r = resolveLayout(
      { map: t.columns.map((c) => ({ column: c.column, header: c.header })) },
      { scheme: fx.scheme, decisions: fx.decisions, fields: coreFieldDefs(), values: (col) => valuesOf(t.columns[col]!.shapes) },
    );
    for (const n of r.needs) (out[`${n.header}|${n.reason}`] ??= []).push(t.tab);
  }
  return out;
}

describe("golden fixtures of the pilot sheets", () => {
  it("the 3 pilots are there, with no cell value (only tab names, headers and counts)", () => {
    expect(fixtures.map((f) => f.hospital_code)).toEqual(["HOSPPVTP0001", "HOSPPVTP0002", "HOSPPVTP0003"]);
    for (const fx of fixtures) {
      for (const t of fx.tabs) {
        for (const c of t.columns) {
          expect(Object.keys(c).sort()).toEqual(["column", "header", "shapes"]);
          expect(Object.keys(c.shapes).sort()).toEqual([...VALUE_SHAPES].sort());
          expect(c.header.length).toBeLessThan(40);
        }
      }
    }
  });

  it("each hospital decides each distinct header once (one decision covers every tab)", () => {
    const distinct = (fx: Fixture) => new Set(fx.tabs.flatMap((t) => t.columns.map((c) => headerKey(c.header)).filter(Boolean))).size;
    expect(fixtures.map((fx) => [fx.hospital_code, fx.tabs.length, distinct(fx), fx.decisions.length])).toEqual([
      ["HOSPPVTP0001", 8, 37, 33],
      ["HOSPPVTP0002", 2, 35, 31],
      ["HOSPPVTP0003", 6, 45, 39],
    ]);
  });

  it("the 7 header decisions of 30-Oct hold; TDS next to TDS AMOUNT has no stored decision", () => {
    for (const fx of fixtures) {
      const d = Object.fromEntries(fx.decisions.map((x) => [x.header_key, x.canonical_field]));
      expect(d.tdsamount).toBe("tds_amount_stated");
      expect("tds" in d).toBe(false);
      expect(d.roomcategory).toBe("room_category");
      expect(d.uhid).toBe("uhid");
      expect(d.remark).toBe("remarks");
      expect(d.followupremarks).toBe("remarks");
      expect(d.discount).toBe("discount_amount");
      expect(d.paymentfollowupdate).toBe("followup_date");
    }
  });

  it("Badagara: TDS waits for a decision; DISCOUNT with text and MEMBER NUMBER as policy holder are stopped", () => {
    expect(needsOf(pilot("HOSPPVTP0001"))).toEqual({
      "TDS|NOT_DECIDED": ["AUG PENDING", "CANCELLED", "NOV 2026", "OCT 2026", "PAID", "PVT DAILYSIS", "SEP 2026", "ULCC"],
      "DISCOUNT|SHAPE": ["PAID", "PVT DAILYSIS", "ULCC"],
      "MEMBER  NUMBER|FIELD_TWICE_IN_TAB": ["PVT DAILYSIS"],
      "POLICY HOLDER NAME|FIELD_TWICE_IN_TAB": ["PVT DAILYSIS"],
    });
  });

  it("Tree G: only TDS waits", () => {
    expect(needsOf(pilot("HOSPPVTP0002"))).toEqual({ "TDS|NOT_DECIDED": ["OCT 2026", "SEP 2026"] });
  });

  it("HMS: TDS holding rates is ignored by its values; date columns with plain numbers are stopped", () => {
    expect(needsOf(pilot("HOSPPVTP0003"))).toEqual({
      "DOD|SHAPE": ["CANCELLED"],
      "HARDCOPY SENT Date|SHAPE": ["CANCELLED"],
      "PAYMENT FOLLOW UP DATE|SHAPE": ["CANCELLED", "PAID", "TILL AUG 2023"],
      "TDS|NOT_DECIDED": ["PENDING"],
      "MAIL SUBJECT|NOT_DECIDED": ["TILL AUG 2023"],
      "MAIL SENT DATE|NOT_DECIDED": ["TILL AUG 2023"],
    });
  });

  it("value shapes", () => {
    expect(["", "-", "10%", "12/10/2026", "12 Oct 2026", "7", "30", "31", "12,500", "₹12,500", "Rs. 500/-", "Fake text"].map(valueShape)).toEqual([
      "blank", "blank", "percent", "date", "date", "small_number", "small_number", "number", "number", "amount", "amount", "text",
    ]);
  });
});
