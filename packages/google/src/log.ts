// Every Google read and write is logged (brief A4.3) with WHAT was touched, never cell
// content: no patient data in application logs (hard rule 10). From M6 the worker
// stores these events in the database.
export type GoogleEvent =
  | { kind: "LIST_TABS"; spreadsheetId: string; tabCount: number }
  | { kind: "READ_TAB"; spreadsheetId: string; tab: string; rowCount: number }
  | { kind: "SKIP_TAB"; spreadsheetId: string; tab: string; policy: "DENY" | "REVIEW" }
  | { kind: "CHECK_ACCESS"; spreadsheetId: string; error?: string }
  | { kind: "CREATE_SHEET"; fileId: string; folderId: string; name: string }
  | { kind: "WRITE_VALUES"; fileId: string; range: string; rowCount: number }
  | { kind: "PROTECT_RANGE"; fileId: string; sheetId: number; startColumnIndex: number; endColumnIndex: number }
  | { kind: "TRASH_SHEET"; fileId: string }
  | { kind: "WRITE_BLOCKED"; fileId: string; reason: string };

export type GoogleLogger = (event: GoogleEvent & { at: string }) => void;

export function makeLogger(sink: (event: GoogleEvent & { at: string }) => void): (e: GoogleEvent) => void {
  return (e) => sink({ ...e, at: new Date().toISOString() });
}

/** One row of the database table google_events (migration 0003). No cell content. */
export interface GoogleEventRow {
  at?: string;
  run_id?: string | null;
  kind: GoogleEvent["kind"];
  file_id: string;
  tab_name?: string;
  skipped_policy?: "DENY" | "REVIEW";
  tab_count?: number;
  row_count?: number;
  range_a1?: string;
  folder_id?: string;
  file_name?: string;
  grid_sheet_id?: number;
  start_column_index?: number;
  end_column_index?: number;
  reason?: string;
}

/**
 * Several events as rows with the same columns: the database API refuses a batch whose
 * rows have different keys (PGRST102), so missing columns are sent as null.
 */
export function toEventRows(events: Array<GoogleEvent & { at?: string }>, runId: string | null = null): Array<Record<string, unknown>> {
  const rows = events.map((e) => toEventRow(e, runId) as unknown as Record<string, unknown>);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
}

export function toEventRow(e: GoogleEvent & { at?: string }, runId: string | null = null): GoogleEventRow {
  const base = { at: e.at, run_id: runId, kind: e.kind };
  switch (e.kind) {
    case "LIST_TABS":
      return { ...base, file_id: e.spreadsheetId, tab_count: e.tabCount };
    case "READ_TAB":
      return { ...base, file_id: e.spreadsheetId, tab_name: e.tab, row_count: e.rowCount };
    case "SKIP_TAB":
      return { ...base, file_id: e.spreadsheetId, tab_name: e.tab, skipped_policy: e.policy };
    case "CHECK_ACCESS":
      return e.error ? { ...base, file_id: e.spreadsheetId, reason: e.error } : { ...base, file_id: e.spreadsheetId };
    case "CREATE_SHEET":
      return { ...base, file_id: e.fileId, folder_id: e.folderId, file_name: e.name };
    case "WRITE_VALUES":
      return { ...base, file_id: e.fileId, range_a1: e.range, row_count: e.rowCount };
    case "PROTECT_RANGE":
      return {
        ...base,
        file_id: e.fileId,
        grid_sheet_id: e.sheetId,
        start_column_index: e.startColumnIndex,
        end_column_index: e.endColumnIndex,
      };
    case "TRASH_SHEET":
      return { ...base, file_id: e.fileId };
    case "WRITE_BLOCKED":
      return { ...base, file_id: e.fileId, reason: e.reason };
  }
}
