import { createReadPath, makeLogger, type CellData, type GoogleEvent, type SheetsReader } from "@oksy/google";
import { describe, expect, it } from "vitest";
import { IGNORE_FIELD } from "@oksy/rules";
import { applyConfirmed, confirmedLayouts, proposalChanges, refreshBase, type MappingRow } from "../src/discovery.ts";
import { layoutOf, sourceRows, type RawTab } from "../src/sheet-data.ts";
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

async function run(db: ReturnType<typeof fakeDb>, data = tabs(), requested: string[][] = [], suggest?: Parameters<typeof runSheetJob>[1]["suggest"], refreshProposals = false) {
  const events: Array<GoogleEvent & { at: string }> = [];
  const read = createReadPath(fakeSheets(data, requested), makeLogger((e) => events.push(e)));
  return runSheetJob(
    { id: crypto.randomUUID(), sheet_key: `${CODE}|PRIVATE`, mode: "DRY_RUN" },
    { db, read, events, suggest, refreshProposals, now: () => new Date("2026-10-27T06:00:00Z") },
  );
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

// Decisions 27-Oct-2026: "Ignore (not needed)" and re-proposing with the grown field list.
describe("Ignore choice and proposal refresh", () => {
  const cell = (t: string): [string, null, null] => [t, null, null];
  const raw: RawTab = {
    name: "OCT 2026",
    rows: [
      ["Sl No", "PATIENT NAME", "CLAIM NO", "DOA", "WARD NOTE", "STAFF CODE"].map(cell),
      ["1", "Fake Patient One", "FAKEOCT001", "01/10/2026", "fake note", "FAKE-STAFF-1"].map(cell),
    ],
  };
  const rowFor = (column: number, canonical_field: string | null, status = "APPROVED"): MappingRow => ({
    id: `m${column}`, tab_name: "OCT 2026", header_fp: layoutOf(raw).fingerprint, source_column: column, canonical_field, status, approved_by: "fake-user-1", approved_at: "2026-10-27T05:00:00Z",
  });
  const decided = () => [rowFor(0, "serial_no"), rowFor(1, "patient_name"), rowFor(2, "preauth_or_claim_no"), rowFor(3, "admission_date"), rowFor(4, null), rowFor(5, IGNORE_FIELD)];

  it("an ignored column is never read into extra_fields; an undecided one still is", () => {
    const l = applyConfirmed(layoutOf(raw), decided());
    expect(l.map[5]).toMatchObject({ field: null, ignored: true });
    const [row] = sourceRows(raw, l);
    expect(row!.extra).toEqual({ "WARD NOTE": "fake note" });
    expect(Object.values(row!.extra)).not.toContain("FAKE-STAFF-1");
    expect(Object.keys(row!.cells)).not.toContain("STAFF CODE");
  });

  it("Ignore counts as decided: the layout is confirmed only when no column is PROPOSED", () => {
    expect(confirmedLayouts(decided()).size).toBe(1);
    const half = decided();
    half[4] = rowFor(4, null, "PROPOSED");
    expect(confirmedLayouts(half).size).toBe(0);
  });

  it("refresh keeps a person's APPROVED columns and never proposes their field again", () => {
    const l = layoutOf({ ...raw, rows: [["Sl No", "PATIENT NAME", "PHONE NO", "MOBILE"].map(cell)] });
    // A person mapped column 3 (MOBILE) to phone_number; the alias list would give it to column 2.
    const stored: MappingRow[] = [
      { ...rowFor(0, "serial_no", "PROPOSED"), method: "ALIAS", confidence: 0.95 },
      { ...rowFor(1, null, "PROPOSED"), method: "UNMATCHED", confidence: 0 },
      { ...rowFor(2, null, "PROPOSED"), method: "UNMATCHED", confidence: 0 },
      rowFor(3, "phone_number"),
    ];
    const base = refreshBase(l, stored);
    expect(base.map((m) => [m.field, m.method])).toEqual([["serial_no", "ALIAS"], ["patient_name", "ALIAS"], [null, "UNMATCHED"], ["phone_number", "MANUAL"]]);
    const changes = proposalChanges(stored, base);
    expect(changes).toEqual([{ id: "m1", patch: { canonical_field: "patient_name", method: "ALIAS", confidence: 0.95 } }]);
  });

  it("REFRESH_PROPOSALS: an old proposal is re-proposed with the new field list; approved rows stay", async () => {
    const db = fakeDb(seed());
    const data = tabs();
    for (const t of ["OCT 2026", "SEP 2026"]) data[t]![1]!.push(v("ROOM TYPE"), v("NEXT FOLLOW UP"));
    await run(db, data);
    const rows = db.tables.column_mappings!;
    const room = rows.find((m) => m.source_header === "ROOM TYPE")!;
    const next = rows.find((m) => m.source_header === "NEXT FOLLOW UP")!;
    // As proposed before the field list grew, and one column already decided by a person.
    Object.assign(room, { canonical_field: null, method: "UNMATCHED", confidence: 0 });
    Object.assign(next, { canonical_field: IGNORE_FIELD, method: "MANUAL", confidence: 1, status: "APPROVED", approved_by: "fake-user-1" });
    const plain = await run(db, data);
    expect(plain.discovery!.refreshedLayouts).toBeUndefined();
    expect(room.canonical_field).toBeNull();

    const s = await run(db, data, [], undefined, true);
    expect(s.discovery!.refreshedLayouts).toEqual([expect.objectContaining({ tab: "OCT 2026", changed: 1 })]);
    expect(room).toMatchObject({ canonical_field: "room_category", method: "ALIAS" });
    expect(room.status ?? "PROPOSED").toBe("PROPOSED");
    expect(next).toMatchObject({ canonical_field: IGNORE_FIELD, status: "APPROVED" });
    expect(s.tabsRead).toEqual([]); // still not confirmed: nothing is read
  });
});
