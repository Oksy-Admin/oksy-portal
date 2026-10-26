import { describe, expect, it } from "vitest";
import { toEventRow, type GoogleEvent } from "../src/log.ts";
import {
  accessStatusAfter,
  CHECK_ACCESS_FIELDS,
  createReadPath,
  SheetNotReadableError,
  type SheetsReader,
} from "../src/read.ts";

// FAKE sheet IDs; no real file.
const SHARED_WITH_ROBOT = "FAKEsheetOK000000000000000000001";
const NOT_SHARED = "FAKEsheetNOPE0000000000000000002";

function fake() {
  const calls: Array<{ spreadsheetId: string; fields: string; ranges?: string[] }> = [];
  const client: SheetsReader = {
    spreadsheets: {
      async get(params) {
        calls.push(params);
        if (params.spreadsheetId === NOT_SHARED) {
          throw Object.assign(new Error("The caller does not have permission"), { code: 403, errors: [{ reason: "forbidden" }] });
        }
        return { data: {} };
      },
    },
  };
  const events: GoogleEvent[] = [];
  return { calls, events, read: createReadPath(client, (e) => events.push(e)) };
}

describe("checkAccess", () => {
  it("asks for the spreadsheet ID only: no title, no tabs, no cells", async () => {
    const f = fake();
    expect(await f.read.checkAccess({ spreadsheetId: SHARED_WITH_ROBOT, sync: "YES", readSkipReason: null })).toEqual({ ok: true });
    expect(f.calls).toEqual([{ spreadsheetId: SHARED_WITH_ROBOT, fields: CHECK_ACCESS_FIELDS }]);
    expect(CHECK_ACCESS_FIELDS).toBe("spreadsheetId");
    expect(f.events).toEqual([{ kind: "CHECK_ACCESS", spreadsheetId: SHARED_WITH_ROBOT }]);
  });

  it("reports a sheet not shared with the robot and logs the error code only", async () => {
    const f = fake();
    expect(await f.read.checkAccess({ spreadsheetId: NOT_SHARED, sync: "YES", readSkipReason: null })).toEqual({
      ok: false,
      status: 403,
      reason: "forbidden",
    });
    expect(toEventRow({ ...f.events[0]!, at: "x" })).toMatchObject({ kind: "CHECK_ACCESS", file_id: NOT_SHARED, reason: "403 forbidden" });
  });

  it("never calls Google for a HOLD or NA sheet (hard rule 4, Bathery)", async () => {
    const f = fake();
    for (const sync of ["HOLD", "NA"]) {
      await expect(f.read.checkAccess({ spreadsheetId: SHARED_WITH_ROBOT, sync, readSkipReason: null })).rejects.toThrow(
        SheetNotReadableError,
      );
    }
    expect(f.calls).toHaveLength(0);
    expect(f.events).toHaveLength(0);
  });

  it("never calls Google for a sheet read under another hospital (D-046)", async () => {
    const f = fake();
    await expect(
      f.read.checkAccess({ spreadsheetId: SHARED_WITH_ROBOT, sync: "YES", readSkipReason: "D-046: read under HOSP32P000107 only" }),
    ).rejects.toThrow(/D-046/);
    expect(f.calls).toHaveLength(0);
  });
});

describe("accessStatusAfter", () => {
  it("maps results to OK / ACCESS_PENDING / READ_FAILED", () => {
    expect(accessStatusAfter({ ok: true }, false)).toBe("OK");
    expect(accessStatusAfter({ ok: false, status: 403, reason: "forbidden" }, false)).toBe("ACCESS_PENDING");
    expect(accessStatusAfter({ ok: false, status: 404, reason: "notFound" }, false)).toBe("ACCESS_PENDING");
    expect(accessStatusAfter({ ok: false, status: 403, reason: "forbidden" }, true)).toBe("READ_FAILED");
    expect(accessStatusAfter({ ok: false, status: 429, reason: "rateLimitExceeded" }, false)).toBe("READ_FAILED");
    expect(accessStatusAfter({ ok: false, status: null, reason: "unknown" }, false)).toBe("READ_FAILED");
  });
});
