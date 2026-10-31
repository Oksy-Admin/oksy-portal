// Stage 1e measurement (run by hand, never in CI): run time per pilot sheet, Sheets API calls
// and cells read, for the hosting size. Each sheet is run 3 times with the real sheet job,
// read path and cleaning, against a database wrapper that reads live and WRITES NOTHING
// (inserts, updates and database calls are counted, not sent). Hospital sheets are only read.
// Prints numbers only, never a cell value.
//   node --import ../google/scripts/timing.ts scripts/measure-runs.ts
import { createReadPath, makeLogger, readClientsFromEnv, type GoogleEvent, type SheetsReader } from "@oksy/google";
import { dbFromEnv, type Db } from "../src/db.ts";
import { runSheetJob } from "../src/sheet-run.ts";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const live = dbFromEnv();
const RUNS = 3;

/** Reads go to live; writes are counted and answered locally (fake ids when rows are asked back). */
function noWriteDb(db: Db, counts: { inserts: number; updates: number; rpcs: number }): Db {
  return {
    // Before migration 20261031055948 the worker key could not read mapping_fields: the run then
    // uses the code's field list (same timing).
    async select<T>(path: string) {
      try {
        return await db.select<T>(path);
      } catch (e) {
        if (path.startsWith("mapping_fields")) return [] as T[];
        throw e;
      }
    },
    async insert<T>(_table: string, rows: object[], opts: { returning?: boolean } = {}) {
      counts.inserts += rows.length;
      return (opts.returning ? rows.map((r) => ({ id: crypto.randomUUID(), record_uid: crypto.randomUUID(), ...r })) : []) as T[];
    },
    async update() {
      counts.updates++;
    },
    async rpc<T>() {
      counts.rpcs++;
      return 0 as T;
    },
  };
}

/** Counts the Sheets API calls and the cells they return. */
function countingSheets(inner: SheetsReader, c: { calls: number; cells: number }): SheetsReader {
  return {
    spreadsheets: {
      async get(p) {
        c.calls++;
        const res = await inner.spreadsheets.get(p);
        for (const s of res.data.sheets ?? []) for (const d of s.data ?? []) for (const r of d.rowData ?? []) c.cells += r.values?.length ?? 0;
        return res;
      },
    },
  };
}

const sheets = await live.select<{ sheet_key: string; hospital_code: string }>(
  "hospital_sheets?sync=eq.YES&read_skip_reason=is.null&select=sheet_key,hospital_code&order=hospital_code",
);
const client = readClientsFromEnv().sheets;
console.log("sheet | run | result | tabs | rows | API calls | cells | read ms | discover ms | clean ms | total ms | writes skipped");
for (const s of sheets) {
  for (let i = 1; i <= RUNS; i++) {
    const api = { calls: 0, cells: 0 };
    const w = { inserts: 0, updates: 0, rpcs: 0 };
    const events: Array<GoogleEvent & { at: string }> = [];
    const read = createReadPath(countingSheets(client, api), makeLogger((e) => events.push(e)));
    const t0 = performance.now();
    const r = await runSheetJob({ id: crypto.randomUUID(), sheet_key: s.sheet_key, mode: "DRY_RUN" }, { db: noWriteDb(live, w), read, events });
    const total = Math.round(performance.now() - t0);
    console.log(
      [s.hospital_code, i, r.result, r.tabsRead.length, r.rows?.read ?? 0, api.calls, api.cells, r.ms.read ?? 0, r.ms.discover ?? 0, r.ms.clean ?? 0, total, `${w.inserts} rows / ${w.updates} updates`].join(" | "),
    );
  }
}
