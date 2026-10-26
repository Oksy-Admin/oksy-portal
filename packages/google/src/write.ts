// WRITE PATH: only inside the "Oksy Question Sheets" Shared Drive (hard rule 2, brief A4.4,
// D-059). Service accounts have no Drive storage, so the robot can only create files in a
// Shared Drive; every Drive call here passes supportsAllDrives. Separate from the read path. Before every write the file's parent folder is checked,
// so a bug cannot write to a hospital sheet. The robot never changes sharing: this module
// has no permissions call at all. Nothing is deleted; a test sheet is moved to trash.
import type { GoogleEvent } from "./log.ts";

export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

/** The only Drive and Sheets calls the write path needs. */
export interface DriveWriter {
  files: {
    create(params: {
      requestBody: { name: string; mimeType: string; parents: string[] };
      fields: string;
      supportsAllDrives?: boolean;
    }): Promise<{ data: { id?: string | null; parents?: string[] | null } }>;
    get(params: { fileId: string; fields: string; supportsAllDrives?: boolean }): Promise<{
      data: {
        id?: string | null;
        parents?: string[] | null;
        trashed?: boolean | null;
        mimeType?: string | null;
        driveId?: string | null;
      };
    }>;
    update(params: { fileId: string; requestBody: { trashed: boolean }; supportsAllDrives?: boolean }): Promise<unknown>;
    list(params: {
      q: string;
      fields: string;
      corpora: "drive";
      driveId: string;
      includeItemsFromAllDrives: boolean;
      supportsAllDrives: boolean;
      pageToken?: string;
    }): Promise<{ data: { files?: Array<{ id?: string | null; name?: string | null }> | null; nextPageToken?: string | null } }>;
  };
}

export interface ProtectedRange {
  protectedRangeId?: number | null;
  description?: string | null;
  warningOnly?: boolean | null;
  range?: { sheetId?: number | null; startColumnIndex?: number | null; endColumnIndex?: number | null } | null;
  editors?: { users?: string[] | null } | null;
}

export interface SheetsWriter {
  spreadsheets: {
    batchUpdate(params: { spreadsheetId: string; requestBody: { requests: object[] } }): Promise<unknown>;
    get(params: { spreadsheetId: string; fields: string }): Promise<{
      data: { sheets?: Array<{ protectedRanges?: ProtectedRange[] | null }> | null };
    }>;
    values: {
      update(params: {
        spreadsheetId: string;
        range: string;
        valueInputOption: "RAW";
        requestBody: { values: string[][] };
      }): Promise<unknown>;
    };
  };
}

export class WriteOutsideFolderError extends Error {
  constructor(fileId: string, reason: string) {
    super(`Write blocked for file ${fileId}: ${reason}`);
    this.name = "WriteOutsideFolderError";
  }
}

export function createWritePath(opts: {
  drive: DriveWriter;
  sheets: SheetsWriter;
  questionSheetsFolderId: string;
  log: (e: GoogleEvent) => void;
}) {
  const { drive, sheets, questionSheetsFolderId: folderId, log } = opts;
  if (!folderId) throw new Error("GOOGLE_QUESTION_SHEETS_FOLDER_ID is not set: the write path cannot start");

  /**
   * Throws unless the file is a spreadsheet directly inside the Question Sheets location
   * (the Shared Drive root, or a folder inside it) and lives in a Shared Drive at all.
   * Hospital sheets are in a My Drive, so they fail both checks.
   */
  async function assertInFolder(fileId: string): Promise<void> {
    let data: Awaited<ReturnType<DriveWriter["files"]["get"]>>["data"];
    try {
      ({ data } = await drive.files.get({ fileId, fields: "id,parents,trashed,mimeType,driveId", supportsAllDrives: true }));
    } catch {
      data = {}; // not found or no access: blocked below, the Google error is not echoed
    }
    let reason: string | null = null;
    if (!(data.parents ?? []).includes(folderId)) reason = "file is not in the Oksy Question Sheets folder";
    else if (!data.driveId) reason = "file is not in a Shared Drive";
    else if (data.mimeType !== SPREADSHEET_MIME) reason = "file is not a Google Sheet";
    else if (data.trashed) reason = "file is in the trash";
    if (reason) {
      log({ kind: "WRITE_BLOCKED", fileId, reason });
      throw new WriteOutsideFolderError(fileId, reason);
    }
  }

  async function createSheet(name: string): Promise<string> {
    const { data } = await drive.files.create({
      requestBody: { name, mimeType: SPREADSHEET_MIME, parents: [folderId] },
      fields: "id,parents",
      supportsAllDrives: true,
    });
    if (!data.id) throw new Error("Drive did not return an id for the new sheet");
    await assertInFolder(data.id);
    log({ kind: "CREATE_SHEET", fileId: data.id, folderId, name });
    return data.id;
  }

  async function writeValues(fileId: string, range: string, values: string[][]): Promise<void> {
    await assertInFolder(fileId);
    await sheets.spreadsheets.values.update({
      spreadsheetId: fileId,
      range,
      valueInputOption: "RAW",
      requestBody: { values },
    });
    log({ kind: "WRITE_VALUES", fileId, range, rowCount: values.length });
  }

  /**
   * Protects columns [startCol, endCol) of a tab so only the robot can edit them (brief
   * A2.11: question columns robot-only). Columns outside the range stay editable for staff.
   * This is a range protection inside the sheet, not file sharing.
   */
  async function protectColumns(
    fileId: string,
    p: { sheetId: number; startColumnIndex: number; endColumnIndex: number; robotEmail: string; description: string },
  ): Promise<void> {
    await assertInFolder(fileId);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: fileId,
      requestBody: {
        requests: [
          {
            addProtectedRange: {
              protectedRange: {
                description: p.description,
                warningOnly: false,
                range: { sheetId: p.sheetId, startColumnIndex: p.startColumnIndex, endColumnIndex: p.endColumnIndex },
                editors: { users: [p.robotEmail] },
              },
            },
          },
        ],
      },
    });
    log({ kind: "PROTECT_RANGE", fileId, sheetId: p.sheetId, startColumnIndex: p.startColumnIndex, endColumnIndex: p.endColumnIndex });
  }

  /** The protected ranges of a Question Sheet (metadata only, no cell content). */
  async function listProtections(fileId: string): Promise<ProtectedRange[]> {
    await assertInFolder(fileId);
    const { data } = await sheets.spreadsheets.get({
      spreadsheetId: fileId,
      fields: "sheets.protectedRanges(protectedRangeId,description,warningOnly,range,editors)",
    });
    return (data.sheets ?? []).flatMap((s) => s.protectedRanges ?? []);
  }

  /** Moves a sheet the robot made to the trash (recoverable). Used for test sheets only. */
  async function trashSheet(fileId: string): Promise<void> {
    await assertInFolder(fileId);
    await drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
    log({ kind: "TRASH_SHEET", fileId });
  }

  /**
   * The Shared Drive that holds the folder: the folder ID itself when it is the drive root.
   * With the drive.file scope Google answers notFound for the drive root, so that is the
   * fallback (live check, 24-Oct).
   */
  async function sharedDriveId(): Promise<string> {
    try {
      const { data } = await drive.files.get({ fileId: folderId, fields: "id,driveId", supportsAllDrives: true });
      return data.driveId ?? folderId;
    } catch {
      return folderId;
    }
  }

  /** Sheets directly in the Question Sheets location that the robot can see (not trashed). */
  async function listSheets(): Promise<Array<{ id: string; name: string }>> {
    const driveId = await sharedDriveId();
    const out: Array<{ id: string; name: string }> = [];
    let pageToken: string | undefined;
    do {
      const { data } = await drive.files.list({
        q: `'${folderId.replace(/'/g, "\\'")}' in parents and mimeType = '${SPREADSHEET_MIME}' and trashed = false`,
        fields: "nextPageToken,files(id,name)",
        corpora: "drive",
        driveId,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageToken,
      });
      for (const f of data.files ?? []) if (f.id) out.push({ id: f.id, name: f.name ?? "" });
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  return { assertInFolder, createSheet, writeValues, protectColumns, listProtections, trashSheet, listSheets };
}
