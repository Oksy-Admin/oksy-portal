import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GoogleEvent } from "../src/log.ts";
import {
  createWritePath,
  SPREADSHEET_MIME,
  WriteOutsideFolderError,
  type DriveWriter,
  type ProtectedRange,
  type SheetsWriter,
} from "../src/write.ts";

const QUESTION_FOLDER = "fake-question-folder";
const HOSPITAL_FOLDER = "fake-hospital-folder";
const SHARED_DRIVE = QUESTION_FOLDER; // the folder ID is the Shared Drive root (D-059)

function fakes() {
  type F = { parents: string[]; mimeType: string; trashed: boolean; driveId?: string; name?: string };
  const files = new Map<string, F>([
    ["hospital-sheet", { parents: [HOSPITAL_FOLDER], mimeType: SPREADSHEET_MIME, trashed: false }],
    ["question-sheet", { parents: [QUESTION_FOLDER], mimeType: SPREADSHEET_MIME, trashed: false, driveId: SHARED_DRIVE }],
    ["question-doc", { parents: [QUESTION_FOLDER], mimeType: "application/vnd.google-apps.document", trashed: false, driveId: SHARED_DRIVE }],
    // a My Drive file that claims the same parent ID: must still be refused
    ["my-drive-sheet", { parents: [QUESTION_FOLDER], mimeType: SPREADSHEET_MIME, trashed: false }],
  ]);
  const calls: Array<{ op: string; supportsAllDrives?: boolean; includeItemsFromAllDrives?: boolean; corpora?: string; driveId?: string }> = [];
  const valueWrites: string[] = [];
  const trashed: string[] = [];
  let n = 0;
  const drive: DriveWriter = {
    files: {
      async create(p) {
        calls.push({ op: "create", supportsAllDrives: p.supportsAllDrives });
        const id = `new-${++n}`;
        files.set(id, { parents: p.requestBody.parents, mimeType: p.requestBody.mimeType, trashed: false, driveId: SHARED_DRIVE, name: p.requestBody.name });
        return { data: { id, parents: p.requestBody.parents } };
      },
      async get(p) {
        calls.push({ op: "get", supportsAllDrives: p.supportsAllDrives });
        if (p.fileId === "google-404") throw new Error("File not found");
        const f = files.get(p.fileId);
        return { data: { id: p.fileId, parents: f?.parents ?? [], mimeType: f?.mimeType, trashed: f?.trashed, driveId: f?.driveId } };
      },
      async list(p) {
        calls.push({ op: "list", supportsAllDrives: p.supportsAllDrives, includeItemsFromAllDrives: p.includeItemsFromAllDrives, corpora: p.corpora, driveId: p.driveId });
        const out = [...files].filter(([, f]) => f.parents.includes(QUESTION_FOLDER) && f.driveId === p.driveId && f.mimeType === SPREADSHEET_MIME && !f.trashed);
        return { data: { files: out.map(([id, f]) => ({ id, name: f.name ?? id })) } };
      },
      async update(p) {
        calls.push({ op: "update", supportsAllDrives: p.supportsAllDrives });
        trashed.push(p.fileId);
        const f = files.get(p.fileId);
        if (f) f.trashed = p.requestBody.trashed;
        return {};
      },
    },
  };
  const protections = new Map<string, ProtectedRange[]>();
  const sheets: SheetsWriter = {
    spreadsheets: {
      async batchUpdate(p) {
        for (const r of p.requestBody.requests as Array<{ addProtectedRange?: { protectedRange: ProtectedRange } }>) {
          if (r.addProtectedRange) protections.set(p.spreadsheetId, [...(protections.get(p.spreadsheetId) ?? []), r.addProtectedRange.protectedRange]);
        }
        return {};
      },
      async get(p) {
        return { data: { sheets: [{ protectedRanges: protections.get(p.spreadsheetId) ?? [] }] } };
      },
      values: {
        async update(p) {
          valueWrites.push(p.spreadsheetId);
          return {};
        },
      },
    },
  };
  const events: GoogleEvent[] = [];
  const path = createWritePath({ drive, sheets, questionSheetsFolderId: QUESTION_FOLDER, log: (e) => events.push(e) });
  return { path, files, valueWrites, trashed, events, calls, protections };
}

describe("write path: Oksy Question Sheets folder only", () => {
  it("creates a sheet inside the Question Sheets folder", async () => {
    const { path, files } = fakes();
    const id = await path.createSheet("TEST - Oksy write check");
    expect(files.get(id)?.parents).toEqual([QUESTION_FOLDER]);
  });

  it("writes to a sheet in the folder", async () => {
    const { path, valueWrites } = fakes();
    await path.writeValues("question-sheet", "A1", [["ok"]]);
    expect(valueWrites).toEqual(["question-sheet"]);
  });

  it("blocks writing to a hospital sheet (outside the folder) and never calls Sheets", async () => {
    const { path, valueWrites, events } = fakes();
    await expect(path.writeValues("hospital-sheet", "A1", [["x"]])).rejects.toBeInstanceOf(WriteOutsideFolderError);
    expect(valueWrites).toEqual([]);
    expect(events).toContainEqual({ kind: "WRITE_BLOCKED", fileId: "hospital-sheet", reason: "file is not in the Oksy Question Sheets folder" });
  });

  it("blocks writing to an unknown file", async () => {
    const { path, valueWrites } = fakes();
    await expect(path.writeValues("does-not-exist", "A1", [["x"]])).rejects.toBeInstanceOf(WriteOutsideFolderError);
    expect(valueWrites).toEqual([]);
  });

  it("blocks trashing a hospital sheet", async () => {
    const { path, trashed } = fakes();
    await expect(path.trashSheet("hospital-sheet")).rejects.toBeInstanceOf(WriteOutsideFolderError);
    expect(trashed).toEqual([]);
  });

  it("blocks writing to a non-sheet file and to a trashed sheet", async () => {
    const { path, files } = fakes();
    await expect(path.writeValues("question-doc", "A1", [["x"]])).rejects.toBeInstanceOf(WriteOutsideFolderError);
    files.get("question-sheet")!.trashed = true;
    await expect(path.writeValues("question-sheet", "A1", [["x"]])).rejects.toBeInstanceOf(WriteOutsideFolderError);
  });

  it("blocks a file outside any Shared Drive even if its parent ID matches", async () => {
    const { path, valueWrites, events } = fakes();
    await expect(path.writeValues("my-drive-sheet", "A1", [["x"]])).rejects.toBeInstanceOf(WriteOutsideFolderError);
    expect(valueWrites).toEqual([]);
    expect(events).toContainEqual({ kind: "WRITE_BLOCKED", fileId: "my-drive-sheet", reason: "file is not in a Shared Drive" });
  });

  it("blocks when Google cannot find the file, without echoing the Google error", async () => {
    const { path, valueWrites } = fakes();
    await expect(path.writeValues("google-404", "A1", [["x"]])).rejects.toThrow(/not in the Oksy Question Sheets folder/);
    expect(valueWrites).toEqual([]);
  });

  it("passes supportsAllDrives on every Drive call, and all-drives options when listing", async () => {
    const { path, calls } = fakes();
    const id = await path.createSheet("TEST - Oksy write check");
    await path.writeValues(id, "A1", [["ok"]]);
    const listed = await path.listSheets();
    await path.trashSheet(id);
    expect(listed.map((f) => f.id)).toEqual(["question-sheet", id]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.supportsAllDrives).toBe(true);
    const list = calls.find((c) => c.op === "list")!;
    expect(list).toMatchObject({ includeItemsFromAllDrives: true, corpora: "drive", driveId: SHARED_DRIVE });
  });

  it("protects question columns for the robot only and leaves the staff column free", async () => {
    const { path, protections } = fakes();
    await path.protectColumns("question-sheet", { sheetId: 0, startColumnIndex: 0, endColumnIndex: 3, robotEmail: "robot@example", description: "Question columns" });
    const [p] = await path.listProtections("question-sheet");
    expect(p).toMatchObject({ warningOnly: false, editors: { users: ["robot@example"] }, range: { startColumnIndex: 0, endColumnIndex: 3 } });
    const staffCol = 3; // column D
    const covered = (protections.get("question-sheet") ?? []).some((r) => staffCol >= (r.range?.startColumnIndex ?? 0) && staffCol < (r.range?.endColumnIndex ?? Infinity));
    expect(covered).toBe(false);
  });

  it("blocks protecting a hospital sheet", async () => {
    const { path, protections } = fakes();
    await expect(
      path.protectColumns("hospital-sheet", { sheetId: 0, startColumnIndex: 0, endColumnIndex: 1, robotEmail: "r", description: "x" }),
    ).rejects.toBeInstanceOf(WriteOutsideFolderError);
    expect(protections.size).toBe(0);
  });

  it("refuses to start without the folder ID", () => {
    expect(() =>
      createWritePath({ drive: {} as DriveWriter, sheets: {} as SheetsWriter, questionSheetsFolderId: "", log: () => {} }),
    ).toThrow(/GOOGLE_QUESTION_SHEETS_FOLDER_ID/);
  });

  it("has no code that changes sharing (no permissions API) and no delete", () => {
    for (const file of ["../src/write.ts", "../src/read.ts", "../src/auth.ts"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
      expect(src).not.toMatch(/permissions|\.delete\(|emptyTrash/);
    }
  });

  it("the read path has no write calls", () => {
    const src = readFileSync(new URL("../src/read.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/update\(|create\(|batchUpdate|append\(|clear\(/);
  });
});
