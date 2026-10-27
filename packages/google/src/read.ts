// READ PATH for hospital claim sheets (hard rule 2: read only). This module has no
// write call of any kind; it is given a read-only client (scopes in auth.ts).
import type { GoogleEvent } from "./log.ts";
import { effectivePolicy, TabNotAllowedError, type TabPolicy } from "./policy.ts";

/** The only Sheets calls the read path needs. Satisfied by the real client and by fakes. */
export interface SheetsReader {
  spreadsheets: {
    get(params: {
      spreadsheetId: string;
      fields: string;
      ranges?: string[];
      includeGridData?: boolean;
    }): Promise<{ data: SpreadsheetData }>;
  };
}

export interface SpreadsheetData {
  sheets?: Array<{
    properties?: { title?: string | null; index?: number | null; hidden?: boolean | null } | null;
    data?: Array<{ rowData?: Array<{ values?: CellData[] | null }> | null }> | null;
  }> | null;
}

export interface CellData {
  formattedValue?: string | null;
  effectiveValue?: Record<string, unknown> | null;
  effectiveFormat?: { backgroundColor?: Record<string, number | undefined> | null } | null;
}

// Field masks (D-049): tab metadata only when listing; values and background colour only
// when reading. Never the full cell format.
export const LIST_TABS_FIELDS = "sheets.properties(title,index,hidden)";
export const READ_TAB_FIELDS =
  "sheets(properties(title),data(rowData(values(formattedValue,effectiveValue,effectiveFormat/backgroundColor))))";

// Header probe for tab discovery: the header is found in rows 1 to 10 (findHeaderRow).
export const HEADER_PROBE_ROWS = 10;

// Access check (brief A7.5): the spreadsheet ID only. No title, no tab names, no cells.
export const CHECK_ACCESS_FIELDS = "spreadsheetId";

/** A registry row as the access check needs it (table hospital_sheets). */
export interface SheetToCheck {
  spreadsheetId: string;
  sync: string;
  readSkipReason: string | null;
}

/** Thrown before any Google call for a sheet that must never be read (hard rule 4, D-046). */
export class SheetNotReadableError extends Error {
  constructor(spreadsheetId: string, why: string) {
    super(`Sheet …${spreadsheetId.slice(-6)} is not read: ${why}`);
    this.name = "SheetNotReadableError";
  }
}

export type AccessResult = { ok: true } | { ok: false; status: number | null; reason: string };
export type AccessStatus = "OK" | "ACCESS_PENDING" | "READ_FAILED";

/**
 * Status after a check (file 05 section 10): OK; ACCESS_PENDING while the robot has never
 * been able to open the sheet (not shared yet); READ_FAILED when it could before, or when
 * Google failed for another reason (quota, server error), so a red sheet never looks fine.
 */
export function accessStatusAfter(result: AccessResult, everOk: boolean): AccessStatus {
  if (result.ok) return "OK";
  if (!everOk && (result.status === 403 || result.status === 404)) return "ACCESS_PENDING";
  return "READ_FAILED";
}

export interface TabInfo {
  title: string;
  index: number;
  hidden: boolean;
  policy: TabPolicy;
}

/** A1 range covering a whole tab; quotes are doubled as Sheets requires. */
export function wholeTabRange(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`;
}

export function createReadPath(client: SheetsReader, log: (e: GoogleEvent) => void) {
  /** Tab names and their policies. Fetches metadata only, never cell content. */
  async function listTabs(spreadsheetId: string, saved: Readonly<Record<string, TabPolicy>>): Promise<TabInfo[]> {
    const res = await client.spreadsheets.get({ spreadsheetId, fields: LIST_TABS_FIELDS });
    const tabs = (res.data.sheets ?? []).map((s, i) => {
      const title = s.properties?.title ?? "";
      return {
        title,
        index: s.properties?.index ?? i,
        hidden: Boolean(s.properties?.hidden),
        policy: effectivePolicy(title, saved),
      };
    });
    log({ kind: "LIST_TABS", spreadsheetId, tabCount: tabs.length });
    return tabs;
  }

  /**
   * Reads values and background colours of the ALLOW tabs only. DENY and REVIEW tabs are
   * never put into the request; they are logged as skipped by name only.
   */
  async function readAllowedTabs(
    spreadsheetId: string,
    saved: Readonly<Record<string, TabPolicy>>,
  ): Promise<Map<string, CellData[][]>> {
    const tabs = await listTabs(spreadsheetId, saved);
    const allowed = tabs.filter((t) => t.policy === "ALLOW").map((t) => t.title);
    for (const t of tabs) {
      if (t.policy !== "ALLOW") log({ kind: "SKIP_TAB", spreadsheetId, tab: t.title, policy: t.policy });
    }
    const result = new Map<string, CellData[][]>();
    if (allowed.length === 0) return result;

    const ranges = allowed.map((title) => {
      const policy = effectivePolicy(title, saved);
      if (policy !== "ALLOW") throw new TabNotAllowedError(title, policy); // second, independent check
      return wholeTabRange(title);
    });
    const res = await client.spreadsheets.get({ spreadsheetId, ranges, fields: READ_TAB_FIELDS, includeGridData: true });

    for (const sheet of res.data.sheets ?? []) {
      const title = sheet.properties?.title ?? "";
      if (!allowed.includes(title)) continue; // never keep anything that was not asked for
      const rows = (sheet.data?.[0]?.rowData ?? []).map((r) => r.values ?? []);
      result.set(title, rows);
      log({ kind: "READ_TAB", spreadsheetId, tab: title, rowCount: rows.length });
    }
    return result;
  }

  /**
   * Can the robot open this sheet? Refuses, without calling Google, a sheet whose SYNC is not
   * YES or that is read under another hospital. One metadata call, logged as CHECK_ACCESS.
   */
  async function checkAccess(sheet: SheetToCheck): Promise<AccessResult> {
    if (sheet.sync !== "YES") throw new SheetNotReadableError(sheet.spreadsheetId, `SYNC = ${sheet.sync}`);
    if (sheet.readSkipReason) throw new SheetNotReadableError(sheet.spreadsheetId, sheet.readSkipReason);
    try {
      await client.spreadsheets.get({ spreadsheetId: sheet.spreadsheetId, fields: CHECK_ACCESS_FIELDS });
      log({ kind: "CHECK_ACCESS", spreadsheetId: sheet.spreadsheetId });
      return { ok: true };
    } catch (e) {
      const err = e as { code?: unknown; status?: unknown; errors?: Array<{ reason?: string }> };
      const raw = typeof err.code === "number" ? err.code : typeof err.status === "number" ? err.status : null;
      const reason = (err.errors?.[0]?.reason ?? "unknown").slice(0, 100);
      log({ kind: "CHECK_ACCESS", spreadsheetId: sheet.spreadsheetId, error: `${raw ?? "no status"} ${reason}` });
      return { ok: false, status: raw, reason };
    }
  }

  /**
   * Tab discovery (requirements v2 section 5): the first rows of month tabs, to find and
   * compare the header before a person has confirmed the mapping. Only the named tabs, only
   * rows 1 to HEADER_PROBE_ROWS, and never a credential-like tab (it is refused before the call).
   */
  async function readHeaderRows(spreadsheetId: string, tabNames: string[]): Promise<Map<string, CellData[][]>> {
    const result = new Map<string, CellData[][]>();
    if (tabNames.length === 0) return result;
    for (const t of tabNames) {
      if (effectivePolicy(t, {}) === "DENY") throw new TabNotAllowedError(t, "DENY");
    }
    const ranges = tabNames.map((t) => `${wholeTabRange(t)}!1:${HEADER_PROBE_ROWS}`);
    const res = await client.spreadsheets.get({ spreadsheetId, ranges, fields: READ_TAB_FIELDS, includeGridData: true });
    for (const sheet of res.data.sheets ?? []) {
      const title = sheet.properties?.title ?? "";
      if (!tabNames.includes(title)) continue;
      const rows = (sheet.data?.[0]?.rowData ?? []).map((r) => r.values ?? []);
      result.set(title, rows);
      log({ kind: "READ_TAB", spreadsheetId, tab: title, rowCount: rows.length });
    }
    return result;
  }

  return { listTabs, readAllowedTabs, readHeaderRows, checkAccess };
}
