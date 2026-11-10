import { describe, expect, it } from "vitest";
import type { CleanRow } from "@oksy/rules";
import { reconcile } from "../src/reconcile.ts";
import type { RawTab, TabLayout } from "../src/sheet-data.ts";

// Decisions.md section 8 (10-Nov): every amount is rounded to 2dp half-up at read, both in the
// cleaner and here on the source side, so the two compare like with like.

const baseRow = (over: Partial<CleanRow> = {}): CleanRow => ({
  tab: "SEP 2026",
  row: 2,
  rowClass: "CLEAN",
  recordKey: "CLM001",
  keyType: "CLAIM_NO",
  claim: null,
  payments: [],
  nullReasons: {},
  flags: [],
  issues: [],
  changes: [],
  extra: {},
  sourceAmounts: { bill: null, claimed: null, approved: null, copay: null, settled: null },
  ...over,
});

describe("reconcile", () => {
  it("passes when a sheet's numeric cell is float noise around the cleaned, rounded value (Badagara, claude/reports/last-report.md: CIR/2027/181321/1066065, SEP 2026 row 92)", () => {
    const tabs: RawTab[] = [
      {
        name: "SEP 2026",
        rows: [
          [["APPROVED", null, null]],
          [["21833.1", 21833.100000000002, null]],
        ],
      },
    ];
    const layouts: TabLayout[] = [
      { tab: "SEP 2026", headerRow: 0, headers: ["APPROVED"], fingerprint: "x", map: [{ column: 0, header: "APPROVED", field: "approved_amount", confidence: 1, method: "ALIAS" }] },
    ];
    const rows = [baseRow({ sourceAmounts: { bill: null, claimed: null, approved: "21833.10", copay: null, settled: null } })];

    const result = reconcile(tabs, layouts, rows);

    expect(result.result).toBe("PASS");
    expect(result.differences).toEqual([]);
    expect(result.sums.approved).toEqual({ source: "21833.10", cleaned: "21833.10", explained: "0.00", unexplained: "0.00" });
  });

  it("still fails when source and cleaned really differ", () => {
    const tabs: RawTab[] = [
      {
        name: "SEP 2026",
        rows: [
          [["APPROVED", null, null]],
          [["21833.1", 21833.1, null]],
        ],
      },
    ];
    const layouts: TabLayout[] = [
      { tab: "SEP 2026", headerRow: 0, headers: ["APPROVED"], fingerprint: "x", map: [{ column: 0, header: "APPROVED", field: "approved_amount", confidence: 1, method: "ALIAS" }] },
    ];
    const rows = [baseRow({ sourceAmounts: { bill: null, claimed: null, approved: "21000.00", copay: null, settled: null } })];

    const result = reconcile(tabs, layouts, rows);

    expect(result.result).toBe("FAIL");
    expect(result.differences.some((d) => d.check === "SUM_APPROVED")).toBe(true);
  });
});
