import { describe, expect, it } from "vitest";
import { toEventRow, toEventRows } from "../src/log.ts";

describe("google_events rows", () => {
  it("maps each event to the database columns, never with cell content", () => {
    expect(toEventRow({ kind: "LIST_TABS", spreadsheetId: "fake-sheet-0001", tabCount: 6 })).toMatchObject({
      kind: "LIST_TABS", file_id: "fake-sheet-0001", tab_count: 6,
    });
    expect(toEventRow({ kind: "SKIP_TAB", spreadsheetId: "fake-sheet-0001", tab: "PORTAL LIST", policy: "DENY" })).toMatchObject({
      kind: "SKIP_TAB", tab_name: "PORTAL LIST", skipped_policy: "DENY",
    });
    expect(toEventRow({ kind: "PROTECT_RANGE", fileId: "f", sheetId: 0, startColumnIndex: 0, endColumnIndex: 3 })).toMatchObject({
      grid_sheet_id: 0, start_column_index: 0, end_column_index: 3,
    });
    const row = toEventRow({ kind: "READ_TAB", spreadsheetId: "s", tab: "PAID", rowCount: 2 }, "run-1");
    expect(row).toMatchObject({ run_id: "run-1", tab_name: "PAID", row_count: 2 });
    expect(Object.keys(row)).not.toContain("values");
  });

  it("gives every row of a batch the same columns (the database API needs it)", () => {
    const rows = toEventRows([
      { kind: "LIST_TABS", spreadsheetId: "s", tabCount: 2 },
      { kind: "READ_TAB", spreadsheetId: "s", tab: "PAID", rowCount: 2 },
    ]);
    expect(Object.keys(rows[0]!).sort()).toEqual(Object.keys(rows[1]!).sort());
    expect(rows[0]).toMatchObject({ tab_count: 2, tab_name: null, row_count: null });
  });
});
