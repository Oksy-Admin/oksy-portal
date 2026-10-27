import { describe, expect, it } from "vitest";
import { classifyTabs, isNonDataRow, monthOfTab, newestFirst, type SourceRow } from "../src/index.ts";

// Requirements v2 section 5. Tab names as seen in the three pilot sheets; no cell values.
const TODAY = "2026-10-27";

describe("month tabs", () => {
  it("reads the month and year from the usual tab names", () => {
    expect(monthOfTab("OCT 2026")).toEqual({ year: 2026, month: 10 });
    expect(monthOfTab("SEP 2026")).toEqual({ year: 2026, month: 9 });
    expect(monthOfTab("Sept-2026")).toEqual({ year: 2026, month: 9 });
    expect(monthOfTab("October 2026")).toEqual({ year: 2026, month: 10 });
    expect(monthOfTab("OCT'26")).toEqual({ year: 2026, month: 10 });
    expect(monthOfTab(" jun 2025 ")).toEqual({ year: 2025, month: 6 });
  });

  it("helper tabs are not month tabs", () => {
    for (const t of ["TPA LIST", "COLOURS", "Sheet1", "PORTAL LIST", "OCT", "2026", "OCT 2026 old", "Summary 2026"]) {
      expect(monthOfTab(t)).toBeNull();
    }
  });

  it("classifies month, future month and helper tabs", () => {
    const c = classifyTabs(["OCT 2026", "SEP 2026", "NOV 2026", "TPA LIST"], TODAY);
    expect(c.map((x) => [x.tab, x.type])).toEqual([
      ["OCT 2026", "MONTH"],
      ["SEP 2026", "MONTH"],
      ["NOV 2026", "FUTURE_MONTH"],
      ["TPA LIST", "HELPER"],
    ]);
  });

  it("orders month tabs newest first", () => {
    const months = classifyTabs(["AUG 2026", "OCT 2026", "DEC 2025"], TODAY).filter((x) => x.type === "MONTH");
    expect(newestFirst(months).map((x) => x.tab)).toEqual(["OCT 2026", "AUG 2026", "DEC 2025"]);
  });
});

describe("non-data rows", () => {
  const row = (cells: SourceRow["cells"], extra: Record<string, string> = {}): SourceRow => ({ tab: "OCT 2026", row: 5, cells, extra, rowColour: null });

  it("a row with only a serial number is not data", () => {
    expect(isNonDataRow(row({ serial_no: { text: "17", number: 17 } }))).toBe(true);
  });

  it("a row with a serial number and a formula 0 in LOS is not data", () => {
    expect(isNonDataRow(row({ serial_no: { text: "18", number: 18 } }, { LOS: "0" }))).toBe(true);
  });

  it("a row with a patient name is data", () => {
    expect(isNonDataRow(row({ serial_no: { text: "19", number: 19 }, patient_name: { text: "Test Patient" } }))).toBe(false);
  });
});
