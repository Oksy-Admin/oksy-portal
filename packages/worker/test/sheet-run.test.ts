import { createReadPath, makeLogger, type CellData, type GoogleEvent, type SheetsReader } from "@oksy/google";
import { describe, expect, it } from "vitest";
import { HMS_CODE, HMS_SHEET } from "../src/hospital-headers.ts";
import { colourHex, legendLabelsFrom } from "../src/sheet-data.ts";
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

function fakeSheets(requested: string[][], tabs: Record<string, CellData[][]> = TABS): SheetsReader {
  return {
    spreadsheets: {
      async get(p) {
        if (!p.includeGridData) return { data: { sheets: Object.keys(tabs).map((title, index) => ({ properties: { title, index } })) } };
        requested.push(p.ranges ?? []);
        // A header probe asks for 'TAB'!1:10; a full read for 'TAB'.
        const asked = (p.ranges ?? []).map((r) => {
          const [, quoted = "", rows] = r.match(/^'(.*)'(?:!1:(\d+))?$/) ?? [];
          return { title: quoted.replace(/''/g, "'"), rows: rows ? Number(rows) : undefined };
        });
        return { data: { sheets: asked.map(({ title, rows }) => ({ properties: { title }, data: [{ rowData: (tabs[title] ?? []).slice(0, rows).map((values) => ({ values })) }] })) } };
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
    // Stage 2b: confirmed facts and dictionary come from hospital_profile_facts /
    // dictionary_entries, not hard-coded profile code or the old questions/answers path.
    hospital_profile_facts: [{ hospital_code: HMS_CODE, tab_stage_facts: { PAID: "SETTLED" }, tpa_cell_may_hold_insurer: false, paid_meaning_open_tabs: [], pod_start_date: null }],
    dictionary_entries: [
      { kind: "DOCTOR", scheme: "PRIVATE", hospital_code: HMS_CODE, spelling_key: "drfake", standard_value: "Dr. Fake Std", status: "CONFIRMED" },
      { kind: "COLOUR", scheme: "PRIVATE", hospital_code: HMS_CODE, spelling_key: "#ff9900", standard_value: "PAID", status: "CONFIRMED" },
      { kind: "COLOUR", scheme: "PRIVATE", hospital_code: HMS_CODE, spelling_key: "#00ff00", standard_value: "CLAIM_SUBMITTED", status: "CONFIRMED" },
    ],
  };
}

async function run(db: ReturnType<typeof fakeDb>, requested: string[][], mode: "WRITE" | "DRY_RUN" = "WRITE", tabs?: Record<string, CellData[][]>, at = "2026-10-26T06:00:00Z") {
  const events: Array<GoogleEvent & { at: string }> = [];
  const read = createReadPath(fakeSheets(requested, tabs), makeLogger((e) => events.push(e)));
  return runSheetJob({ id: crypto.randomUUID(), sheet_key: `${HMS_CODE}|PRIVATE`, mode }, { db, read, events, now: () => new Date(at) });
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
      // No TDS column in this fixture: Total TDS is unknown, never derived (decisions.md section 8).
      deduction_amount: "15000.00", tds_amount: null,
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

  it("a claim stored while the patient was in hospital keeps its record when the discharge date comes", async () => {
    const pending = TABS.PENDING![1]!;
    const dod = pending[4]!;
    pending[4] = v("", GREEN); // no discharge date yet
    try {
      const db = await confirmedDb();
      await run(db, []);
      const before = db.tables.claims_staging!.find((c) => c.preauth_or_claim_no === "FAKECLM003")!;
      expect(before.record_key).toMatch(/\|C:FAKECLM003\|2026-09-03\|-$/);
      pending[4] = dod;
      const s = await run(db, []);
      expect(s.result).toBe("WRITTEN");
      expect(db.tables.claims_staging).toHaveLength(3); // the same claim, not a new one
      const after = db.tables.claims_staging!.find((c) => c.preauth_or_claim_no === "FAKECLM003")!;
      expect(after.record_uid).toBe(before.record_uid);
      expect(after.record_key).toMatch(/\|C:FAKECLM003\|2026-09-03\|2026-09-06$/);
      expect(after.sync_status).toBe("CHANGED");
      expect(after.missing_since).toBeNull();
      const keys = db.tables.record_keys!.filter((k) => k.record_uid === before.record_uid).map((k) => String(k.record_key));
      expect(keys).toHaveLength(2); // the old key still points to the same claim
      expect(keys.some((k) => k.endsWith("|2026-09-03|-")) && keys.some((k) => k.endsWith("|2026-09-03|2026-09-06"))).toBe(true);
      expect(db.tables.change_log!.some((c) => c.record_uid === before.record_uid && c.field === "discharge_date" && c.old_value === null && c.new_value === "2026-09-06" && c.actor === "SHEET")).toBe(true);
    } finally {
      pending[4] = dod;
    }
  });

  it("a row repeated exactly is stored once; the cleaning engine's own changes are tagged AUTO", async () => {
    const paid = TABS.PAID!;
    paid.splice(3, 0, paid[1]!); // FAKECLM001 twice, same values
    try {
      const db = await confirmedDb();
      const s = await run(db, []);
      expect(s.identity).toEqual({ duplicates: 1, conflicting: 0, sameUtr: 0, samePatientSameDay: 0 });
      expect(db.tables.claims_staging!.filter((c) => c.preauth_or_claim_no === "FAKECLM001")).toHaveLength(1);
      expect(new Set(db.tables.change_log!.map((c) => c.actor))).toEqual(new Set(["AUTO"]));
    } finally {
      paid.splice(3, 1);
    }
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

describe("two-part approval (Stage 2c, decisions.md section 7, 1-Nov)", () => {
  const FAKECLM010_KEY = `${HMS_CODE}|PRIVATE|C:FAKECLM010|2026-10-01|2026-10-05`;
  // A separate tab (not "PAID", so tab_stage_facts does not force SETTLED): two rows, same
  // claim identity, both Approved, same approved amount, different UTR and paid amount.
  function twoPartTabs(): Record<string, CellData[][]> {
    return {
      ...TABS,
      PAID2: [
        row(HEAD),
        row(["1", "Fake Patient Ten", "FAKECLM010", "01/10/2026", "05/10/2026", "Fake Insurance", "Ortho", "Fake procedure", "Dr Fake", "60000", "40000", "5000", "20000", "FAKEUTR00010", "10/11/2026", "APPROVED", ""]),
        row(["2", "Fake Patient Ten", "FAKECLM010", "01/10/2026", "05/10/2026", "Fake Insurance", "Ortho", "Fake procedure", "Dr Fake", "60000", "40000", "5000", "15000", "FAKEUTR00011", "20/11/2026", "APPROVED", ""]),
      ],
    };
  }

  async function twoPartDb() {
    const sd = seed();
    sd.sheet_tabs.push({ spreadsheet_id: HMS_SHEET, tab_name: "PAID2", policy: "ALLOW", kind: "DATA" });
    sd.dictionary_entries.push({ kind: "STATUS_WORD", scheme: "PRIVATE", hospital_code: HMS_CODE, spelling_key: "approved", standard_value: "APPROVED", status: "CONFIRMED" });
    const db = fakeDb(sd);
    const tabs = twoPartTabs();
    const first = await run(db, [], "WRITE", tabs, "2026-12-05T06:00:00Z");
    expect(first.result).toBe("STOPPED_LAYOUT");
    // "STATUS" has no alias match to status_text (fields.ts: "Claim Status" / "Status of
    // Claim" / "Current Status" only) and is otherwise read into extra_fields unmapped, same
    // as in the other fixtures here (they rely on tab_stage_facts instead); this test's rows
    // need the column itself, since neither PAID2 nor its PAID/PENDING siblings are a forced-stage tab.
    decideAll(db, { status: "status_text" });
    db.tables.snapshots = [];
    db.tables.reconciliations = [];
    return { db, tabs };
  }

  it("a candidate match is suggested once; both rows are stored under different keys, never flagged as a conflict", async () => {
    const { db, tabs } = await twoPartDb();
    const s = await run(db, [], "WRITE", tabs, "2026-12-05T06:00:00Z");
    expect(s.twoPart).toEqual({ confirmed: 0, pending: 1, newSuggestions: 1 });
    const rows = (db.tables.claims_staging ?? []).filter((c) => c.preauth_or_claim_no === "FAKECLM010");
    expect(rows.map((r) => r.record_key).sort()).toEqual([FAKECLM010_KEY, `${FAKECLM010_KEY}#2`]);
    expect((db.tables.issues ?? []).filter((i) => i.rule_id === "R-K02" && rows.some((r) => r.record_uid === i.record_uid))).toHaveLength(0);
    expect(db.tables.claim_links ?? []).toHaveLength(1);
    expect((db.tables.claim_links ?? [])[0]).toMatchObject({ primary_record_key: FAKECLM010_KEY, secondary_record_key: `${FAKECLM010_KEY}#2`, status: "SUGGESTED" });

    // A second run with no decision yet never inserts a second SUGGESTED row for the same pair.
    const s2 = await run(db, [], "WRITE", tabs, "2026-12-05T06:00:00Z");
    expect(s2.twoPart).toEqual({ confirmed: 0, pending: 1, newSuggestions: 0 });
    expect(db.tables.claim_links ?? []).toHaveLength(1);
  });

  it("confirming the match combines the two rows on the next run (decide_claim_link, then re-run)", async () => {
    const { db, tabs } = await twoPartDb();
    await run(db, [], "WRITE", tabs, "2026-12-05T06:00:00Z");
    const link = (db.tables.claim_links ?? [])[0]!;
    link.status = "CONFIRMED"; // stands in for decide_claim_link(), applied by the worker on the next run
    const s = await run(db, [], "WRITE", tabs, "2026-12-05T06:00:00Z");
    expect(s.twoPart).toEqual({ confirmed: 1, pending: 0, newSuggestions: 0 });

    const primary = (db.tables.claims_staging ?? []).find((c) => c.record_key === FAKECLM010_KEY)!;
    const secondary = (db.tables.claims_staging ?? []).find((c) => c.record_key === `${FAKECLM010_KEY}#2`)!;
    expect(primary.settled_amount).toBe("35000.00");
    expect(primary.utr_no).toEqual(["FAKEUTR00010", "FAKEUTR00011"]);
    expect(String(primary.remarks)).toContain("Two-part payment");
    expect(String(primary.remarks)).toContain("20000.00");
    expect(String(primary.remarks)).toContain("15000.00");
    expect(secondary.combined_into_record_uid).toBe(primary.record_uid);

    // Re-running again (same CONFIRMED link) keeps combining the same way, not twice over.
    await run(db, [], "WRITE", tabs, "2026-12-05T06:00:00Z");
    const primaryAgain = (db.tables.claims_staging ?? []).find((c) => c.record_key === FAKECLM010_KEY)!;
    expect(primaryAgain.settled_amount).toBe("35000.00");
  });

  it("a rejected match falls back to the normal conflicting-values flag (R-K02)", async () => {
    const { db, tabs } = await twoPartDb();
    await run(db, [], "WRITE", tabs, "2026-12-05T06:00:00Z");
    const link = (db.tables.claim_links ?? [])[0]!;
    link.status = "REJECTED";
    await run(db, [], "WRITE", tabs, "2026-12-05T06:00:00Z");
    const rows = (db.tables.claims_staging ?? []).filter((c) => c.preauth_or_claim_no === "FAKECLM010");
    const issues = (db.tables.issues ?? []).filter((i) => rows.some((r) => r.record_uid === i.record_uid) && i.status !== "RESOLVED");
    expect(issues.map((i) => i.rule_id)).toEqual(["R-K02", "R-K02"]);
  });
});

describe("colour legend", () => {
  it("white is no colour; a label's fill becomes the legend label; two labels for one fill is left out", () => {
    expect(colourHex({ red: 1, green: 1, blue: 1 })).toBeNull();
    expect(colourHex({ red: 1, green: 0.6 })).toBe("#ff9900");
    expect(legendLabelsFrom({ name: "COLOURS", rows: [[["PAID", null, "#ff9900"]], [["DISCHARGED", null, "#ff9900"]], [["CLAIM SUBMITTED", null, "#00ff00"]]] })).toEqual({
      "#00ff00": "CLAIM SUBMITTED",
    });
  });
});
