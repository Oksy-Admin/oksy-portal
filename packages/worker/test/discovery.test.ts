import { createReadPath, makeLogger, type CellData, type GoogleEvent, type SheetsReader } from "@oksy/google";
import { describe, expect, it } from "vitest";
import { runSheetJob } from "../src/sheet-run.ts";
import { fakeDb } from "./fake-db.ts";

// Stage 3 (requirements v2 section 5): a fake sheet in the pilots' month-tab template.
// Invented names and numbers only; no real sheet is read.
const FILE = "fake-month-sheet-000000001";
const CODE = "HOSPPVTPTEST";
const v = (text: string): CellData => ({
  formattedValue: text,
  effectiveValue: /^\d+(\.\d+)?$/.test(text) ? { numberValue: Number(text) } : { stringValue: text },
});
const r = (vals: string[]) => vals.map(v);
const HEAD = ["Sl No", "PATIENT NAME", "CLAIM NO", "DOA", "DOD", "INSURANCE COMPANY", "TPA", "BILL AMOUNT", "FINAL APPROVED AMOUNT", "LOS"];

function tabs(): Record<string, CellData[][]> {
  return {
    "OCT 2026": [
      r(["OKSY CLAIMS OCT 2026"]),
      r(HEAD),
      r(["1", "Fake Patient One", "FAKEOCT001", "01/10/2026", "04/10/2026", "Fake Insurer", "Fake TPA", "50000", "45000", "3"]),
      r(["2", "", "", "", "", "", "", "", "", "0"]), // serial number and a formula 0 only
      r(["3"]), // serial number only
    ],
    "SEP 2026": [r(["OKSY CLAIMS SEP 2026"]), r(HEAD), r(["1", "Fake Patient Two", "FAKESEP001", "02/09/2026", "05/09/2026", "Fake Insurer", "Fake TPA", "30000", "27000", "3"])],
    "NOV 2026": [r(HEAD), r(["1"]), r(["2"])], // pre-made for next month
    "TPA LIST": [r(["Fake TPA"]), r(["Other Fake TPA"])],
    "PORTAL LIST": [r(["FAKE-SECRET-123"])],
  };
}

function fakeSheets(data: Record<string, CellData[][]>, requested: string[][]): SheetsReader {
  return {
    spreadsheets: {
      async get(p) {
        if (!p.includeGridData) return { data: { sheets: Object.keys(data).map((title, index) => ({ properties: { title, index } })) } };
        requested.push(p.ranges ?? []);
        const asked = (p.ranges ?? []).map((x) => {
          const [, quoted = "", rows] = x.match(/^'(.*)'(?:!1:(\d+))?$/) ?? [];
          return { title: quoted.replace(/''/g, "'"), rows: rows ? Number(rows) : undefined };
        });
        return { data: { sheets: asked.map(({ title, rows }) => ({ properties: { title }, data: [{ rowData: (data[title] ?? []).slice(0, rows).map((values) => ({ values })) }] })) } };
      },
    },
  };
}

function seed() {
  return {
    hospital_sheets: [{ sheet_key: `${CODE}|PRIVATE`, hospital_code: CODE, scheme: "PRIVATE", spreadsheet_id: FILE, sync: "YES", read_skip_reason: null, missing_from_register_since: null }],
  };
}

async function run(db: ReturnType<typeof fakeDb>, data = tabs(), requested: string[][] = [], suggest?: Parameters<typeof runSheetJob>[1]["suggest"]) {
  const events: Array<GoogleEvent & { at: string }> = [];
  const read = createReadPath(fakeSheets(data, requested), makeLogger((e) => events.push(e)));
  return runSheetJob({ id: crypto.randomUUID(), sheet_key: `${CODE}|PRIVATE`, mode: "DRY_RUN" }, { db, read, events, suggest, now: () => new Date("2026-10-27T06:00:00Z") });
}

const tab = (db: ReturnType<typeof fakeDb>, name: string) => db.tables.sheet_tabs!.find((t) => t.tab_name === name)!;
const confirm = (db: ReturnType<typeof fakeDb>) => {
  for (const m of db.tables.column_mappings ?? []) Object.assign(m, { status: "APPROVED", approved_by: "fake-user-1", approved_at: "2026-10-27T05:00:00Z" });
};

describe("tab discovery and one-time mapping (Stage 3)", () => {
  it("first run: finds month tabs, ignores helper and future tabs, proposes one mapping, reads no data", async () => {
    const db = fakeDb(seed());
    const requested: string[][] = [];
    const s = await run(db, tabs(), requested);
    expect(s.discovery).toMatchObject({
      tabsFound: 5,
      monthTabs: ["OCT 2026", "SEP 2026"],
      helperTabs: ["TPA LIST", "PORTAL LIST"],
      futureTabs: ["NOV 2026"],
      autoAllowed: [],
    });
    expect(s.discovery!.waiting.map((w) => w.reason)).toEqual(["waiting for the column mapping to be confirmed", "waiting for the column mapping to be confirmed"]);
    expect(s.discovery!.proposedLayouts).toHaveLength(1);
    expect(s.discovery!.proposedLayouts[0]).toMatchObject({ tab: "OCT 2026", columns: HEAD.length });
    // Only a header probe of the two month tabs; never TPA LIST or PORTAL LIST, never a full read.
    expect(requested).toEqual([["'OCT 2026'!1:10", "'SEP 2026'!1:10"]]);
    expect(tab(db, "TPA LIST")).toMatchObject({ policy: "DENY", kind: "EXCLUDED" });
    expect(tab(db, "PORTAL LIST").policy).not.toBe("ALLOW");
    expect(tab(db, "NOV 2026").policy).toBe("REVIEW");
    expect(s.tabsRead).toEqual([]);
  });

  it("after one confirmation every month tab with that header is read; serial-only rows are skipped", async () => {
    const db = fakeDb(seed());
    await run(db);
    confirm(db);
    const s = await run(db);
    expect(s.discovery!.autoAllowed).toEqual(["OCT 2026", "SEP 2026"]);
    expect(tab(db, "OCT 2026")).toMatchObject({ policy: "ALLOW", kind: "DATA", decided_by: "fake-user-1" });
    expect(s.tabsRead.sort()).toEqual(["OCT 2026", "SEP 2026"]);
    expect(s.layoutProblems).toEqual([]);
    expect(s.result).toBe("DRY_RUN");
    expect(s.rows).toEqual({ read: 4, nonData: 2, data: 2 }); // 2 claims; the 2 serial-only rows are skipped
    expect(s.reconciliation.result).toBe("PASS");
    expect(new Set(db.tables.column_mappings!.map((m) => m.tab_name))).toEqual(new Set(["OCT 2026"])); // confirmed once
  });

  it("a new month tab with the same header is included on its own; a different header waits", async () => {
    const db = fakeDb(seed());
    await run(db);
    confirm(db);
    const data = tabs();
    data["AUG 2026"] = [r(HEAD), r(["1", "Fake Patient Three", "FAKEAUG001", "02/08/2026", "05/08/2026", "Fake Insurer", "Fake TPA", "10000", "9000", "3"])];
    data["JUL 2026"] = [r([...HEAD.slice(0, 7), "PRE-AUTH APPROVAL AMOUNT", ...HEAD.slice(7)]), r(["1", "Fake Patient Four"])];
    const s = await run(db, data);
    expect(s.discovery!.autoAllowed).toContain("AUG 2026");
    expect(s.discovery!.waiting).toEqual([{ tab: "JUL 2026", reason: "header differs from the confirmed column mapping" }]);
    expect(s.tabsRead).not.toContain("JUL 2026");
    expect(s.discovery!.proposedLayouts.map((p) => p.tab)).toEqual(["JUL 2026"]);
  });

  it("a half-confirmed mapping is not a confirmation", async () => {
    const db = fakeDb(seed());
    await run(db);
    Object.assign(db.tables.column_mappings![0]!, { status: "APPROVED", approved_by: "fake-user-1", approved_at: "2026-10-27T05:00:00Z" });
    const s = await run(db);
    expect(s.discovery!.autoAllowed).toEqual([]);
    expect(s.tabsRead).toEqual([]);
  });

  it("a person's decision on a tab is never changed by discovery", async () => {
    const db = fakeDb(seed());
    await run(db);
    Object.assign(tab(db, "SEP 2026"), { policy: "DENY", decided_by: "fake-user-2", decided_at: "2026-10-27T05:30:00Z", decision_note: "set in portal: DENY" });
    confirm(db);
    const s = await run(db);
    expect(tab(db, "SEP 2026").policy).toBe("DENY");
    expect(s.tabsRead).toEqual(["OCT 2026"]);
  });

  it("AI suggestions are stored as proposals for a person to confirm", async () => {
    const db = fakeDb(seed());
    const data = tabs();
    // A damaged header: the TPA header cell holds a TPA name.
    for (const t of ["OCT 2026", "SEP 2026"]) data[t]![1]![6] = v("Fake TPA");
    await run(db, data, [], async (l) => l.map.map((m) => (m.column === 6 ? { ...m, field: "tpa_name", confidence: 0.7, method: "AI" } : m)));
    const tpa = db.tables.column_mappings!.find((m) => m.source_column === 6)!;
    expect(tpa).toMatchObject({ canonical_field: "tpa_name", method: "AI" });
    expect(tpa.status ?? "PROPOSED").toBe("PROPOSED"); // database default; never APPROVED by the AI
    expect(tpa.confidence).toBeLessThan(1);
  });
});
