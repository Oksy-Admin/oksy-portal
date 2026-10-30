// Column mapping by header name (file 03 section 3). Order: alias dictionary, then the
// hospital's own confirmed headers. Unmatched columns go to extra_fields, never dropped.
// Ambiguous headers ("Amount", "Date", "Status", "Ref No", "Balance", "Deduction") are
// never mapped on the header alone.
import { acceptsManyColumns, coreFieldDefs, FIELD_KEY_RE, IGNORE_FIELD, isCanonicalField, NEVER_ALONE_HEADERS, type CanonicalField, type FieldDef } from "./fields.ts";
import { normaliseHeader } from "./normalise.ts";

export * from "./fields.ts";

/** Normalised header -> field key, from a field list. A header used by two fields is left out (never guess). */
export function aliasIndex(fields: FieldDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  const clash = new Set<string>();
  for (const f of fields) {
    if (f.status !== "ACTIVE") continue; // a hidden field is not offered for new mappings
    for (const h of f.aliases) {
      const k = normaliseHeader(h);
      if (!k) continue;
      if (out[k] && out[k] !== f.key) clash.add(k);
      out[k] = f.key;
    }
  }
  for (const k of clash) delete out[k];
  return out;
}

/** The code list's aliases: used when the mapping_fields table cannot be read. */
const CODE_ALIASES = aliasIndex(coreFieldDefs());

/** Headers never mapped on the name alone (file 03 section 3): they go to extra_fields for G1 review. */
const NEVER_ON_HEADER_ALONE = new Set(NEVER_ALONE_HEADERS.map(normaliseHeader));

export interface ColumnMap {
  column: number;
  header: string;
  field: CanonicalField | null; // null = extra_fields, unless ignored or custom
  /** A field added on the Fields page: its value is stored in extra_fields under this key. */
  custom?: string;
  confidence: number;
  /** A person chose "Ignore (not needed)": the column is not read at all. */
  ignored?: boolean;
  method: "ALIAS" | "DUPLICATE_HEADER" | "UNMATCHED" | "AI" | "MANUAL"; // MANUAL = a person's choice
}

/**
 * Maps a header row. A repeated header keeps the first column; later copies are
 * DUPLICATE_HEADER (their value goes to extra_fields when it differs; file 03 section 3, HMS),
 * except for a field that takes several columns (MULTI_COLUMN_FIELDS, e.g. two REMARK
 * columns): every copy maps to that field and the values are joined when a row is read.
 * extra lets a hospital add its own confirmed headers (G1). fields is the mapping_fields
 * list; without it the code list is used. Hidden fields are never proposed.
 */
export function mapHeaders(headers: Array<string | null>, extra: Record<string, CanonicalField> = {}, fields?: FieldDef[]): ColumnMap[] {
  const aliases = fields && fields.length > 0 ? aliasIndex(fields) : CODE_ALIASES;
  const hidden = new Set((fields ?? []).filter((f) => f.status !== "ACTIVE").map((f) => f.key));
  const seenFields = new Set<string>();
  const seenHeaders = new Map<string, string | undefined>(); // normalised header -> its field
  const local: Record<string, CanonicalField> = {};
  for (const [h, f] of Object.entries(extra)) local[normaliseHeader(h)] = f;
  return headers.map((raw, column) => {
    const header = (raw ?? "").trim();
    const key = normaliseHeader(header);
    if (key === "") return { column, header, field: null, confidence: 0, method: "UNMATCHED" };
    if (seenHeaders.has(key)) {
      const prev = seenHeaders.get(key);
      if (!acceptsManyColumns(prev)) return { column, header, field: null, confidence: 1, method: "DUPLICATE_HEADER" };
    }
    const found = NEVER_ON_HEADER_ALONE.has(key) ? undefined : (local[key] ?? aliases[key]);
    if (!seenHeaders.has(key)) seenHeaders.set(key, found && !hidden.has(found) && !seenFields.has(found) ? found : undefined);
    if (!found || hidden.has(found) || (seenFields.has(found) && !acceptsManyColumns(found))) return { column, header, field: null, confidence: 0, method: "UNMATCHED" };
    seenFields.add(found);
    if (isCanonicalField(found)) return { column, header, field: found, confidence: 0.95, method: "ALIAS" };
    return { column, header, field: null, custom: found, confidence: 0.95, method: "ALIAS" };
  });
}

/** The key a column map stands for (core or custom), as stored in column_mappings.canonical_field. */
export function mappedKey(m: Pick<ColumnMap, "field" | "custom">): string | null {
  return m.field ?? m.custom ?? null;
}

/**
 * A stored choice (column_mappings.canonical_field) for applying a confirmed mapping:
 * IGNORE = not read at all; a core field = that field; another key = a field added on the
 * Fields page (stored in extra_fields under the key); NULL = extra_fields under the header.
 */
export function readChoice(stored: string | null): { field: CanonicalField | null; ignored: boolean; custom?: string } {
  if (stored === IGNORE_FIELD) return { field: null, ignored: true };
  if (isCanonicalField(stored)) return { field: stored, ignored: false };
  if (stored && FIELD_KEY_RE.test(stored)) return { field: null, ignored: false, custom: stored };
  return { field: null, ignored: false };
}

/** Ordered normalised headers joined: the version-group fingerprint (file 03 section 3). */
export function headerFingerprint(headers: Array<string | null>): string {
  return headers.map((h) => normaliseHeader(h)).join("|").replace(/\|+$/, "");
}

/**
 * The header row: the first of rows 1 to 10 where most filled cells are non-numeric text
 * and at least 4 cells are filled (file 03 section 3, inventory). Returns the 0-based index.
 */
export function findHeaderRow(rows: Array<Array<string | null>>): number | null {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const filled = (rows[i] ?? []).filter((c) => c != null && c.trim() !== "");
    if (filled.length < 4) continue;
    const textual = filled.filter((c) => !/^[\d\s.,/-]+$/.test(c!));
    if (textual.length / filled.length >= 0.8) return i;
  }
  return null;
}
