// From the Sheets API response to the raw snapshot and to source rows (file 03 sections 3
// and 4). Pure code. Cell values stay in memory and in the snapshot table only; nothing
// here logs a value (hard rule 10).
import type { CellData } from "@oksy/google";
import {
  findHeaderRow,
  headerFingerprint,
  isBlank,
  mapHeaders,
  nameKey,
  type CanonicalField,
  type ColourMeaning,
  type ColumnMap,
  type FieldDef,
  type SourceCell,
  type SourceRow,
} from "@oksy/rules";

/** One cell in the snapshot: [text, number, colour]. Short, so a snapshot stays small. */
export type RawCell = [string | null, number | null, string | null];
export interface RawTab {
  name: string;
  rows: RawCell[][];
}

/** Background colour as #rrggbb; white or no fill is null. Sheets omits zero channels. */
export function colourHex(bg: Record<string, number | undefined> | null | undefined): string | null {
  if (!bg) return null;
  const ch = (v: number | undefined) => Math.round(Math.min(1, Math.max(0, v ?? 0)) * 255);
  const [r, g, b] = [ch(bg.red), ch(bg.green), ch(bg.blue)];
  if (r === 255 && g === 255 && b === 255) return null;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function toRawCell(c: CellData | undefined): RawCell {
  const text = c?.formattedValue ?? null;
  const nv = c?.effectiveValue?.numberValue;
  return [text, typeof nv === "number" ? nv : null, colourHex(c?.effectiveFormat?.backgroundColor)];
}

export function toRawTabs(read: Map<string, CellData[][]>): RawTab[] {
  return [...read.entries()].map(([name, rows]) => ({ name, rows: rows.map((r) => r.map(toRawCell)) }));
}

const cell = (c: RawCell | undefined): SourceCell => ({ text: c?.[0] ?? null, number: c?.[1] ?? null, colour: c?.[2] ?? null });

// Columns whose fill decides the row colour (a row counts as coloured only if the fill
// covers its main columns, file 03 section 3).
const MAIN: CanonicalField[] = ["patient_name", "preauth_or_claim_no", "admission_date", "discharge_date", "bill_amount", "approved_amount"];

export function rowColour(raw: RawCell[], map: ColumnMap[]): string | null {
  const cols = map.filter((m) => m.field && MAIN.includes(m.field)).map((m) => m.column);
  if (cols.length === 0) return null;
  const counts = new Map<string, number>();
  for (const c of cols) {
    const hex = raw[c]?.[2];
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] / cols.length >= 0.6 ? best[0] : null;
}

export interface TabLayout {
  tab: string;
  headerRow: number | null; // 0-based
  headers: string[];
  fingerprint: string;
  map: ColumnMap[];
}

export function layoutOf(tab: RawTab, extraHeaders: Record<string, CanonicalField> = {}, fields?: FieldDef[]): TabLayout {
  const texts = tab.rows.map((r) => r.map((c) => c[0]));
  const headerRow = findHeaderRow(texts);
  const headers = headerRow === null ? [] : (texts[headerRow] ?? []).map((h) => (h ?? "").trim());
  return { tab: tab.name, headerRow, headers, fingerprint: headerFingerprint(headers), map: mapHeaders(headers, extraHeaders, fields) };
}

/**
 * Source rows below the header. Duplicate-header and unmatched columns go to extra under the
 * header (never dropped); fields added on the Fields page go to extra under their key;
 * ignored columns are skipped.
 */
export function sourceRows(tab: RawTab, layout: TabLayout): SourceRow[] {
  if (layout.headerRow === null) return [];
  const out: SourceRow[] = [];
  const headerKeys = layout.headers.map((h) => nameKey(h));
  for (let i = layout.headerRow + 1; i < tab.rows.length; i++) {
    const raw = tab.rows[i] ?? [];
    const cells: SourceRow["cells"] = {};
    const extra: Record<string, string> = {};
    for (const m of layout.map) {
      if (m.ignored) continue; // "Ignore (not needed)": not part of the data, not in extra_fields
      const c = raw[m.column];
      if (m.field) cells[m.field] = cell(c);
      else if (m.custom) {
        // A field added on the Fields page: kept in extra_fields under its key (decision 27-Oct-2026).
        if (c?.[0] != null && c[0].trim() !== "") extra[m.custom] = c[0];
      } else if (c?.[0] != null && c[0].trim() !== "") {
        // A repeated header whose value equals the first column's value adds nothing.
        const first = layout.map.find((x) => nameKey(x.header) === nameKey(m.header) && x.column !== m.column && x.field);
        if (m.method === "DUPLICATE_HEADER" && first && raw[first.column]?.[0] === c[0]) continue;
        const label = m.header || `Column ${m.column + 1}`;
        extra[m.method === "DUPLICATE_HEADER" ? `${label} (column ${m.column + 1})` : label] = c[0];
      }
    }
    // Mapped fields with no column in this tab stay undefined: NOT_RECORDED_IN_SOURCE.
    const isHeaderRepeat = raw.filter((c) => c?.[0]).every((c, j) => nameKey(c[0] ?? "") === headerKeys[j]) && raw.some((c) => c?.[0]);
    const r: SourceRow = { tab: tab.name, row: i + 1, cells, extra, rowColour: rowColour(raw, layout.map), isHeaderRepeat };
    out.push(r);
  }
  return out;
}

/** Legend words (staff confirmed the meanings on 25-Oct; the COLOURS tab gives the exact fill). */
const LEGEND_WORDS: Array<[RegExp, ColourMeaning]> = [
  [/pre\s*-?auth.*initiat/i, "PREAUTH_INITIATED"],
  [/pre\s*-?auth.*approv/i, "PREAUTH_APPROVED"],
  [/reject|denied|cancel/i, "REJECTED_OR_CANCELLED"],
  [/discharg/i, "DISCHARGED"],
  [/claim\s*submit|hard\s*copy/i, "CLAIM_SUBMITTED"],
  [/\bpaid\b|settled/i, "PAID"],
];

/**
 * The colour legend from a LEGEND tab: a label cell with its fill, or a filled cell next to
 * its label. Only labels that match a confirmed meaning are used; two fills for one meaning,
 * or one fill for two meanings, leaves that colour out (ask, never guess).
 */
export function legendFrom(tab: RawTab | undefined): Record<string, ColourMeaning> {
  if (!tab) return {};
  const found = new Map<string, Set<ColourMeaning>>();
  for (const row of tab.rows) {
    for (let j = 0; j < row.length; j++) {
      const [text] = row[j] ?? [null];
      if (!text || isBlank({ text })) continue;
      const meaning = LEGEND_WORDS.find(([re]) => re.test(text))?.[1];
      if (!meaning) continue;
      const fill = row[j]?.[2] ?? row[j - 1]?.[2] ?? row[j + 1]?.[2] ?? null;
      if (!fill) continue;
      (found.get(fill) ?? found.set(fill, new Set()).get(fill)!).add(meaning);
    }
  }
  const legend: Record<string, ColourMeaning> = {};
  const used = new Map<ColourMeaning, number>();
  for (const [, ms] of found) for (const m of ms) used.set(m, (used.get(m) ?? 0) + 1);
  for (const [fill, ms] of found) {
    const m = [...ms][0];
    if (ms.size === 1 && m && used.get(m) === 1) legend[fill] = m;
  }
  return legend;
}
