// Hospital list upload (decision section 4, 27-Oct night: a preview before save). Pure code,
// shared by the server actions and their tests: parse the CSV, check every row, and say per
// row what is wrong. Nothing is saved while any row has an error.

/** The most rows one upload may hold (the full register is about 130 hospitals x 3 schemes). */
export const UPLOAD_MAX_ROWS = 500;

export const SCHEMES = ["PRIVATE", "KASP", "MEDISEP"] as const;
export type Scheme = (typeof SCHEMES)[number];

export interface UploadRow {
  /** The row number in the file (the header is row 1). */
  row: number;
  hospitalCode: string;
  hospitalName: string;
  otherNames: string[];
  district: string | null;
  status: "ACTIVE" | "STOPPED";
  scheme: Scheme;
  sheetUrl: string;
  spreadsheetId: string | null;
  questionSheetUrl: string | null;
  errors: string[];
}

export interface UploadPreview {
  rows: UploadRow[];
  /** A problem with the whole file (no header, no rows, too many rows). */
  fileError: string | null;
  errorCount: number;
}

export function extractSpreadsheetId(urlOrId: string): string | null {
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

/** CSV with quoted fields ("a, b" and "" inside quotes); blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some((c) => c.length > 0)) rows.push(currentRow);
      currentRow = [];
      currentVal = "";
    } else {
      currentVal += char;
    }
  }
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((c) => c.length > 0)) rows.push(currentRow);
  }
  return rows;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function schemeOf(raw: string): Scheme | null {
  const k = key(raw);
  if (!k || k === "private" || k === "pvt") return "PRIVATE";
  if (k.startsWith("kasp")) return "KASP";
  if (k.startsWith("medisep")) return "MEDISEP";
  return null;
}

function statusOf(raw: string): "ACTIVE" | "STOPPED" | null {
  const k = key(raw);
  if (!k || k === "active") return "ACTIVE";
  if (k === "stopped" || k === "inactive") return "STOPPED";
  return null;
}

/** Parses and checks the whole file. Writes nothing. */
export function previewHospitalList(text: string): UploadPreview {
  const parsed = parseCsv(text.replace(/^﻿/, ""));
  const fail = (fileError: string): UploadPreview => ({ rows: [], fileError, errorCount: 1 });
  if (parsed.length < 2 || !parsed[0]) return fail("The file needs a header row and at least one data row.");
  if (parsed.length - 1 > UPLOAD_MAX_ROWS) return fail(`At most ${UPLOAD_MAX_ROWS} rows in one upload (this file has ${parsed.length - 1}).`);

  const columns = new Map(parsed[0].map((h, i) => [key(h), i]));
  const col = (r: string[], ...names: string[]) => {
    for (const n of names) {
      const i = columns.get(key(n));
      if (i !== undefined && r[i] !== undefined) return r[i].trim();
    }
    return "";
  };
  if (!["hospitalid", "hospitalcode", "id"].some((n) => columns.has(n)) || !["hospitalname", "name"].some((n) => columns.has(n))) {
    return fail("The header row must have Hospital ID and Hospital Name (download the template).");
  }

  const seen = new Map<string, number>();
  const rows = parsed.slice(1).map((r, i): UploadRow => {
    const errors: string[] = [];
    const hospitalCode = col(r, "Hospital ID", "Hospital Code", "ID").toUpperCase();
    const hospitalName = col(r, "Hospital Name", "Name");
    const rawScheme = col(r, "Scheme");
    const rawStatus = col(r, "Status");
    const sheetUrl = col(r, "Google Sheet Link", "Sheet Link", "Sheet URL");
    const scheme = schemeOf(rawScheme);
    const status = statusOf(rawStatus);
    const spreadsheetId = sheetUrl ? extractSpreadsheetId(sheetUrl) : null;

    if (!hospitalCode) errors.push("Hospital ID is missing.");
    else if (!/^[A-Z0-9]{3,32}$/.test(hospitalCode)) errors.push(`Hospital ID "${hospitalCode}" must be 3 to 32 letters or digits.`);
    if (!hospitalName) errors.push("Hospital Name is missing.");
    if (!scheme) errors.push(`Scheme "${rawScheme}" is not Private, KASP or MEDISEP.`);
    if (!status) errors.push(`Status "${rawStatus}" is not Active or Stopped.`);
    if (!sheetUrl) errors.push("Google Sheet Link is missing.");
    else if (!spreadsheetId) errors.push("Google Sheet Link is not a Google Sheet address.");
    const pair = `${hospitalCode}|${scheme ?? rawScheme}`;
    const first = seen.get(pair);
    if (hospitalCode && first !== undefined) errors.push(`Same Hospital ID and Scheme as row ${first}.`);
    else seen.set(pair, i + 2);

    return {
      row: i + 2,
      hospitalCode,
      hospitalName,
      otherNames: col(r, "Other Names", "Aliases").split(";").map((n) => n.trim()).filter(Boolean),
      district: col(r, "District") || null,
      status: status ?? "ACTIVE",
      scheme: scheme ?? "PRIVATE",
      sheetUrl,
      spreadsheetId,
      questionSheetUrl: col(r, "Question Sheet Link", "Question Sheet URL") || null,
      errors,
    };
  });
  return { rows, fileError: null, errorCount: rows.filter((r) => r.errors.length > 0).length };
}
