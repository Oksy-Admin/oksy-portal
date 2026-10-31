import { createReadPath, makeLogger, type CellData, type GoogleEvent, type SheetsReader } from "@oksy/google";
import { describe, expect, it } from "vitest";
import { HMS_CODE, HMS_SHEET } from "../src/hms-profile.ts";
import { colourHex, legendFrom } from "../src/sheet-data.ts";
import { runSheetJob } from "../src/sheet-run.ts";
import { decideAll, fakeDb } from "./fake-db.ts";

// A fake sheet with the HMS layout: invented patients, invented numbers. The real HMS sheet
// is never read by tests.
const ORANGE = { red: 1, green: 0.6 };
const GREEN = { green: 1 };
const v = (text: string, bg?: Record<string, number>): CellData => ({
  formattedValue: text,
  effectiveValue: /^\d+(\.\d+)?$/.test(text) ? { numberValue: Number(text) } : { stringValue: text },
  effectiveFormat: { backgroundColor: bg ?? { red: 1, green: 1, blue: 1 } },
});
const HEAD = ["Sl No", "PATIENT NAME", "CLAIM NO", "DOA", "DOD", "INSURANCE COMPANY", "DEPARTMENT", "TREATMENT", "DOCTOR", "BILL AMOUNT", "FINAL APPROVED AMOUNT", "CO-PAY", "PAID AMOUNT", "UTR", "SETTLED DATE", "STATUS", "REMARK"];
const row = (vals: string[], bg?: Record<string, number>) => vals.map((x) => v(x, bg));

const TABS: Record<string, CellData[][]> = {
  PAID: [
    row(HEAD),
    row(["1", "Fake Patient One", "FAKECLM001", "01/08/2026", "05/08/2026", "Fake Insurance", "Ortho", "Fake procedure", "Dr Fake", "120000", "100000", "5000", "85500", "FAKEUTR00001", "10/09/2026", "PAID", ""], ORANGE),
    row(["2", "Fake Patient Two", "FAKECLM002", "02/08/2026", "04/08/2026", "Fake Insurance", "Gen", "Fake procedure", "Dr Fake", "50000", "40000", "10000", "36000", "FAKEUTR00002, FAKEUTR00003", "12/09/2026", "PAID", ""], ORANGE),
    row(["", "", "", "", "", "", "", "", "", "170000", "140000", "15000", "121500", "", "", "", "TOTAL"]),
  ],
  PENDING: [
    row(HEAD),
    row(["1", "Fake Patient Three", "FAKECLM003", "03/09/2026", "06/09/2026", "Fake Insurance", "Ortho", "Fake procedure", "Dr Fake", "60000", "45000", "", "", "", "", "", ""], GREEN),
  ],
  COLOURS: [[v("PAID", ORANGE)], [v("CLAIM SUBMITTED / HARD COPY SENT", GREEN)]],
  "PORTAL LIST": [[v("FAKE-SECRET-123")]],
};

function fakeSheets(requested: string[][]): SheetsReader {
  return {
    spreadsheets: {
      async get(p) {
        if (!p.includeGridData) return { data: { sheets: Object.keys(TABS).map((title, index) => ({ properties: { title, index } })) } };
        requested.push(p.ranges ?? []);
        // A header probe asks for 'TAB'!1:10; a full read for 'TAB'.
        const asked = (p.ranges ?? []).map((r) => {
          const [, quoted = "", rows] = r.match(/^'(.*)'(?:!1:(\d+))?$/) ?? [];
          return { title: quoted.replace(/''/g, "'"), rows: rows ? Number(rows) : undefined };
        });
        return { data: { sheets: asked.map(({ title, rows }) => ({ properties: { title }, data: [{ rowData: (TABS[title] ?? []).slice(0, rows).map((values) => ({ values })) }] })) } };
      },
    },
  };
}

function seed() {
  return {
    hospital_sheets: [{ sheet_key: `${HMS_CODE}|PRIVATE`, hospital_code: HMS_CODE, scheme: "PRIVATE", spreadsheet_id: HMS_SHEET, sync: "YES", read_skip_reason: null, missing_from_register_since: null }],
    sheet_tabs: [
      { spreadsheet_id: HMS_SHEET, tab_name: "PAID", policy: "ALLOW", kind: "DATA" },
      { spreadsheet_id: HMS_SHEET, tab_name: "PENDING", policy: "ALLOW", kind: "DATA" },
      { spreadsheet_id: HMS_SHEET, tab_name: "COLOURS", policy: "ALLOW", kind: "LEGEND" },
      { spreadsheet_id: HMS_SHEET, tab_name: "PORTAL LIST", policy: "DENY", kind: null },
    ],
    questions: [{ id: "q1", hospital_code: HMS_CODE, question_type: "M", scope: "HOSPITAL", status: "ANSWERED", question_text: 'Doctor name "Dr. Fake Std" for the spellings: Dr Fake; DR FAKE' }],
    answers: [{ question_id: "q1", outcome: "CONFIRMED" }],
  };
}

async function run(db: ReturnType<typeof fakeDb>, requested: string[][], mode: "WRITE" | "DRY_RUN" = "WRITE") {
  const events: Array<GoogleEvent & { at: string }> = [];
  const read = createReadPath(fakeSheets(requested), makeLogger((e) => events.push(e)));
  return runSheetJob({ id: crypto.randomUUID(), sheet_key: `${HMS_CODE}|PRIVATE`, mode }, { db, read, events, now: () => new Date("2026-10-26T06:00:00Z") });
}

/** A sheet whose column mapping was proposed by a first run and then confirmed once by a person. */
async function confirmedDb() {
  const db = fakeDb(seed());
  const first = await run(db, []);
  expect(first.result).toBe("STOPPED_LAYOUT");
  decideAll(db);
  db.tables.snapshots = [];
  db.tables.reconciliations = [];
  return db;
}

describe("one HMS-shaped sheet run (fake data)", () => {
  it("PORTAL LIST is never requested; the read is logged", async () => {
    const db = fakeDb(seed());
    const requested: string[][] = [];
    await run(db, requested);
    expect(requested).toHaveLength(1); // one request for values and colours
    expect(requested.flat().some((r) => /portal/i.test(r))).toBe(false);
    expect(db.tables.google_events?.some((e) => e.kind === "READ_TAB" && /portal/i.test(String(e.tab_name)))).toBe(false);
    expect(db.tables.google_events?.some((e) => e.kind === "SKIP_TAB" && e.tab_name === "PORTAL LIST")).toBe(true);
  });

  it("reconciles, writes claims and payments, stores the worked example values", async () => {
    const db = await confirmedDb();
    const s = await run(db, []);
    expect(s.result).toBe("WRITTEN");
    expect(s.reconciliation.result).toBe("PASS");
    expect(s.reconciliation.counts).toMatchObject({ sourceRows: 4, byClass: { NON_DATA_ROW: 1 } });
    expect(s.rows).toEqual({ read: 4, nonData: 1, data: 3 });
    expect(s.reconciliation.sums.bill).toMatchObject({ source: "230000.00", cleaned: "230000.00", unexplained: "0.00" });
    const claims = db.tables.claims_staging ?? [];
    expect(claims).toHaveLength(3);
    const one = claims.find((c) => c.preauth_or_claim_no === "FAKECLM001")!;
    expect(one).toMatchObject({
      discount_1_amount: "15000.00", gross_amount: "95000.00", tds_amount: "9500.00", discount_2_amount: "5000.00",
      tds_rate_source: "DEFAULT", claim_status: "SETTLED", doctor_name: "Dr. Fake Std", row_class: "AUTO_FIXED",
    });
    const pending = claims.find((c) => c.preauth_or_claim_no === "FAKECLM003")!;
    expect(pending).toMatchObject({ claim_status: "APPROVED", status_source: "colour" }); // green + approved (confirmed legend)
    const two = db.tables.payments?.filter((p) => p.record_key === claims.find((c) => c.preauth_or_claim_no === "FAKECLM002")!.record_key);
    expect(two).toHaveLength(1);
    expect(two?.[0]).toMatchObject({ amount_received: "36000", flags: ["AMOUNT_SPLIT_UNKNOWN"] });
    expect(db.tables.snapshots).toHaveLength(1);
    expect(db.tables.reconciliations?.[0]).toMatchObject({ result: "PASS" });
  });

  it("a second run creates no duplicates and no changes", async () => {
    const db = await confirmedDb();
    await run(db, []);
    const second = await run(db, []);
    expect(second.sync).toEqual({ new: 0, changed: 0, unchanged: 3, missing: 0 });
    expect(db.tables.claims_staging).toHaveLength(3);
    expect(db.tables.payments).toHaveLength(2);
    expect(db.tables.snapshots).toHaveLength(1); // unchanged sheet: the first copy is reused (decision 31-Oct)
    expect(db.tables.reconciliations?.map((r) => r.snapshot_id)).toEqual([db.tables.snapshots![0]!.id, db.tables.snapshots![0]!.id]);
  });

  it("a copy older than 12 months is deleted; a changed sheet gets a new copy", async () => {
    const db = await confirmedDb();
    await run(db, []);
    db.tables.snapshots![0]!.taken_at = "2025-01-01T00:00:00Z";
    db.tables.snapshots![0]!.raw_sha256 = "0".repeat(64); // as if the sheet changed since
    await run(db, []);
    expect(db.tables.snapshots).toHaveLength(1);
    expect(db.tables.snapshots![0]!.taken_at).not.toBe("2025-01-01T00:00:00Z");
  });

  it("stops until the mapping is confirmed; one confirmation covers both tabs with that header", async () => {
    const db = fakeDb(seed());
    const s = await run(db, []);
    expect(s.result).toBe("STOPPED_LAYOUT");
    expect(s.layoutProblems).toEqual([expect.stringMatching(/^PAID: \d+ headers need a decision: .* \(R-Y01\)$/), expect.stringMatching(/^PENDING: \d+ headers need a decision/)]);
    expect(db.tables.claims_staging ?? []).toHaveLength(0);
    // Proposed once for the sheet and header, not once per tab.
    expect(new Set(db.tables.column_mappings!.map((m) => m.tab_name))).toEqual(new Set(["PAID"]));
  });

  it("the run uses the confirmed field, not the alias list", async () => {
    const db = await confirmedDb();
    const d = db.tables.header_decisions!.find((x) => x.header_key === "department")!;
    d.canonical_field = null; // a person decided: keep DEPARTMENT as an extra column only
    await run(db, []);
    const one = (db.tables.claims_staging ?? []).find((c) => c.preauth_or_claim_no === "FAKECLM001")!;
    expect(one.department ?? null).toBeNull();
    expect(one.extra_fields).toMatchObject({ DEPARTMENT: "Ortho" });
  });

  it("DRY_RUN reads and reconciles but writes no claim", async () => {
    const db = await confirmedDb();
    const s = await run(db, [], "DRY_RUN");
    expect(s.result).toBe("DRY_RUN");
    expect(db.tables.claims_staging ?? []).toHaveLength(0);
  });

  it("a HOLD sheet is refused before any Google call", async () => {
    const sd = seed();
    sd.hospital_sheets[0]!.sync = "HOLD";
    const requested: string[][] = [];
    await expect(run(fakeDb(sd), requested)).rejects.toThrow(/SYNC = HOLD/);
    expect(requested).toHaveLength(0);
  });
});

describe("colour legend", () => {
  it("white is no colour; a label's fill becomes the legend; one fill for two meanings is left out", () => {
    expect(colourHex({ red: 1, green: 1, blue: 1 })).toBeNull();
    expect(colourHex({ red: 1, green: 0.6 })).toBe("#ff9900");
    expect(legendFrom({ name: "COLOURS", rows: [[["PAID", null, "#ff9900"]], [["DISCHARGED", null, "#ff9900"]], [["CLAIM SUBMITTED", null, "#00ff00"]]] })).toEqual({
      "#00ff00": "CLAIM_SUBMITTED",
    });
  });
});
