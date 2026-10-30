// Header decisions (Policy B + D, decisions.md section 5, Stage 1b). A column mapping is
// decided once per hospital + scheme + normalised header and reused on every tab of that
// hospital whose header matches exactly. Before a decision is reused, the column's values
// must look like the decided field (value-shape check) and the hospital must not hold two
// different decisions for the header (consistency guard). Anything else goes to the
// decision list. Pure code; imports only fields.ts so the web page can load it.
// Never logs or returns a cell value (hard rule 10).
import { acceptsManyColumns, aliasKey, CORE_FIELDS, IGNORE_FIELD, isCanonicalField, type CanonicalField, type FieldDef, type FieldType } from "./fields.ts";

/** The decision key of a header: the same rule as normaliseHeader (letters and digits, lower case). */
export const headerKey = aliasKey;

/** One row of header_decisions. canonical_field: a field key, IGNORE, or NULL (keep in extra_fields). */
export interface HeaderDecision {
  scheme: string;
  header_key: string;
  canonical_field: string | null;
  /** A person confirmed the field although the values did not look like it. */
  accept_any_shape?: boolean;
  decided_by?: string | null;
  decided_at?: string | null;
}

/** Why a column of a layout cannot reuse a decision. NOT_DECIDED has no stored note. */
export type NeedReason = "NOT_DECIDED" | "SHAPE" | "TWO_FIELDS_IN_HOSPITAL" | "FIELD_TWICE_IN_TAB";

export interface ColumnNeed {
  column: number;
  header: string;
  header_key: string;
  reason: NeedReason;
  /** Plain words for the decision list (column_mappings.review_reason); null for NOT_DECIDED. */
  note: string | null;
}

/** The column map a layout gets (the same shape as mapping.ts ColumnMap, kept local: no import cycle). */
export interface ResolvedColumn {
  column: number;
  header: string;
  field: CanonicalField | null;
  custom?: string;
  confidence: number;
  ignored?: boolean;
  method: "ALIAS" | "DUPLICATE_HEADER" | "UNMATCHED" | "AI" | "MANUAL";
}

// ---------------------------------------------------------------------------------------
// Auto-Ignore (decision 30-Oct): the portal calculates these itself, so they are never
// shown for approval. Discount is NOT on this list.
// ---------------------------------------------------------------------------------------

/** Header-only auto-Ignore: Length of Stay, Settlement Delay, Balance Amount, TDS %. */
export function autoIgnoreByHeader(rawHeader: string | null | undefined): string | null {
  const raw = (rawHeader ?? "").trim();
  const k = headerKey(raw);
  if (!k) return null;
  if (k === "los" || k.startsWith("lengthofstay") || k.startsWith("loslengthofstay")) return "Length of Stay";
  if (k.startsWith("settlementdelay")) return "Settlement Delay";
  if (["balanceamount", "balanceamt", "balamount", "balamt"].some((p) => k.startsWith(p))) return "Balance Amount";
  if (k.startsWith("tds") && (raw.includes("%") || /^tds(percent|percentage|rate|per)$/.test(k))) return "TDS %";
  return null;
}

const PLACEHOLDER = new Set(["-", "--", "—", "na", "n/a", "nil", "none", "."]);

/** Non-blank values only; dashes and NA count as blank. */
export function filledValues(values: Array<string | null | undefined>): string[] {
  return values.map((v) => (v ?? "").trim()).filter((v) => v !== "" && !PLACEHOLDER.has(v.toLowerCase()));
}

const PERCENT_RE = /^\d{1,2}(\.\d+)?\s*%$/;
const SMALL_NUMBER_RE = /^\d{1,2}(\.\d+)?$/;

/**
 * A plain "TDS" column that holds the rate, not the amount: values like "10%", or, when the
 * same tab also has a TDS AMOUNT column, small numbers (30 or less). TDS % is auto-Ignored.
 */
export function looksLikeTdsPercent(values: Array<string | null | undefined>, tabHasTdsAmount: boolean): boolean {
  const v = filledValues(values);
  if (v.length === 0) return false;
  const fit = v.filter((x) => PERCENT_RE.test(x) || (tabHasTdsAmount && SMALL_NUMBER_RE.test(x) && Number(x) <= 30)).length;
  return fit >= Math.ceil(v.length * 0.8);
}

// ---------------------------------------------------------------------------------------
// Value-shape check (decision 30-Oct night): an amount field must hold amounts, a date
// field dates, a number field numbers. Text fields take anything. No AI.
// ---------------------------------------------------------------------------------------

const AMOUNT_RE = /^\(?-?\s*(₹|rs\.?|inr)?\s*-?[\d,]+(\.\d+)?\s*\)?\s*(\/-)?$/i;
const NUMBER_RE = /^-?[\d,]+(\.\d+)?$/;
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
const DATE_RES = [
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/, // 12/10/2026, 12-10-26, 12.10.2026
  /^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}$/, // 2026-10-12
  new RegExp(`^\\d{1,2}[\\s/.-]*(${MONTHS})[a-z]*[\\s/.,-]*\\d{2,4}$`, "i"), // 12 Oct 2026, 12-Oct-26
  new RegExp(`^(${MONTHS})[a-z]*[\\s.-]*\\d{1,2},?[\\s-]*\\d{2,4}$`, "i"), // Oct 12, 2026
];

export function valueFits(type: FieldType, value: string): boolean {
  const v = value.trim();
  if (type === "amount") return AMOUNT_RE.test(v);
  if (type === "number") return NUMBER_RE.test(v);
  if (type === "date") return DATE_RES.some((re) => re.test(v));
  return true;
}

/**
 * Do the values look like the field type? At least 80% of the filled values must fit; a
 * column with no filled value fits (nothing speaks against it).
 */
export function shapeFits(type: FieldType, values: Array<string | null | undefined>): boolean {
  if (type === "text") return true;
  const v = filledValues(values);
  if (v.length === 0) return true;
  return v.filter((x) => valueFits(type, x)).length >= Math.ceil(v.length * 0.8);
}

/** The shape of one cell, for the golden fixtures (no value is kept, only this word). */
/** small_number: 30 or less, what a TDS rate column holds (looksLikeTdsPercent). */
export type ValueShape = "blank" | "percent" | "date" | "small_number" | "number" | "amount" | "text";
export const VALUE_SHAPES: ValueShape[] = ["blank", "percent", "date", "small_number", "number", "amount", "text"];

export function valueShape(value: string | null | undefined): ValueShape {
  const v = (value ?? "").trim();
  if (filledValues([v]).length === 0) return "blank";
  if (PERCENT_RE.test(v)) return "percent";
  if (DATE_RES.some((re) => re.test(v))) return "date";
  if (SMALL_NUMBER_RE.test(v) && Number(v) <= 30) return "small_number";
  if (NUMBER_RE.test(v)) return "number";
  if (AMOUNT_RE.test(v)) return "amount";
  return "text";
}

const TYPE_WORDS: Record<FieldType, string> = { amount: "amounts", date: "dates", number: "numbers", text: "text" };

/** The type of a decided field: from the field list, else the code list; text when unknown. */
export function fieldType(key: string, fields: FieldDef[] = []): FieldType {
  const f = fields.find((x) => x.key === key);
  if (f) return f.data_type;
  return isCanonicalField(key) ? CORE_FIELDS[key].data_type : "text";
}

// ---------------------------------------------------------------------------------------
// Consistency guard (decision 30-Oct): one header, two different decisions inside the same
// hospital (another scheme) -> reuse stops.
// ---------------------------------------------------------------------------------------

/** Header keys this hospital decided in more than one way, across its schemes. */
export function conflictingHeaders(decisions: HeaderDecision[]): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const d of decisions) (seen.get(d.header_key) ?? seen.set(d.header_key, new Set()).get(d.header_key)!).add(d.canonical_field ?? "");
  return new Set([...seen].filter(([, s]) => s.size > 1).map(([k]) => k));
}

/** A stored choice as a column map: IGNORE, a core field, a field added on the Fields page, or extra_fields. */
function choiceOf(stored: string | null): Pick<ResolvedColumn, "field" | "custom" | "ignored"> {
  if (stored === IGNORE_FIELD) return { field: null, ignored: true };
  if (isCanonicalField(stored)) return { field: stored };
  if (stored) return { field: null, custom: stored };
  return { field: null };
}

export interface ResolveInput {
  scheme: string;
  /** Every header decision of the hospital (all schemes: the consistency guard needs them). */
  decisions: HeaderDecision[];
  fields?: FieldDef[];
  /** The column's cell texts below the header, for the value-shape check. Omitted = no check. */
  values?: (column: number) => Array<string | null>;
}

export interface Resolved {
  map: ResolvedColumn[];
  needs: ColumnNeed[];
  /** Columns that took a stored decision (not auto-Ignored, not blank). */
  reused: number;
  autoIgnored: Array<{ column: number; header: string; reason: string }>;
}

/**
 * Applies the hospital + scheme decisions to a layout. A blank header goes to extra_fields
 * under "Column N" (nothing to decide on a name); a repeated header keeps the first column
 * unless its field takes several columns (remarks). The layout is confirmed when needs is empty.
 */
export function resolveLayout(layout: { map: Array<Pick<ResolvedColumn, "column" | "header">> }, input: ResolveInput): Resolved {
  const mine = new Map(input.decisions.filter((d) => d.scheme === input.scheme).map((d) => [d.header_key, d]));
  const conflicts = conflictingHeaders(input.decisions);
  const keys = layout.map.map((m) => headerKey(m.header));
  const hasTdsAmount = keys.includes("tdsamount");
  const map: ResolvedColumn[] = [];
  const needs: ColumnNeed[] = [];
  const autoIgnored: Resolved["autoIgnored"] = [];
  const firstOfKey = new Map<string, ResolvedColumn>();
  let reused = 0;

  for (const m of layout.map) {
    const header = m.header.trim();
    const key = headerKey(header);
    const base = { column: m.column, header };
    if (!key) {
      map.push({ ...base, field: null, confidence: 0, method: "UNMATCHED" });
      continue;
    }
    const first = firstOfKey.get(key);
    if (first && !acceptsManyColumns(first.field ?? first.custom)) {
      map.push({ ...base, field: null, confidence: 1, method: "DUPLICATE_HEADER" });
      continue;
    }
    const values = input.values?.(m.column);
    const auto = autoIgnoreByHeader(header) ?? (key === "tds" && values && looksLikeTdsPercent(values, hasTdsAmount) ? "TDS %" : null);
    if (auto) {
      const r: ResolvedColumn = { ...base, field: null, ignored: true, confidence: 1, method: "MANUAL" };
      map.push(r);
      firstOfKey.set(key, r);
      autoIgnored.push({ ...base, reason: auto });
      continue;
    }
    const d = mine.get(key);
    const undecided: ResolvedColumn = { ...base, field: null, confidence: 0, method: "UNMATCHED" };
    if (!d) {
      needs.push({ ...base, header_key: key, reason: "NOT_DECIDED", note: null });
      map.push(undecided);
      continue;
    }
    if (conflicts.has(key)) {
      needs.push({ ...base, header_key: key, reason: "TWO_FIELDS_IN_HOSPITAL", note: "This header has two different decisions in this hospital (another scheme). Decide it again." });
      map.push(undecided);
      continue;
    }
    const choice = choiceOf(d.canonical_field);
    const target = choice.field ?? choice.custom;
    if (target && values && !d.accept_any_shape) {
      const type = fieldType(target, input.fields);
      if (!shapeFits(type, values)) {
        needs.push({ ...base, header_key: key, reason: "SHAPE", note: `The values in this column do not look like ${TYPE_WORDS[type]}, but the decided field holds ${TYPE_WORDS[type]}.` });
        map.push(undecided);
        continue;
      }
    }
    const r: ResolvedColumn = { ...base, ...choice, confidence: 1, method: "MANUAL" };
    map.push(r);
    firstOfKey.set(key, r);
    reused++;
  }

  // One field from two different headers in one tab (for example TDS and TDS AMOUNT both
  // decided as TDS amount): never guess which one is right.
  const holders = new Map<string, ResolvedColumn[]>();
  for (const r of map) {
    const k = r.field ?? r.custom;
    if (!k || r.ignored || acceptsManyColumns(k)) continue;
    holders.set(k, [...(holders.get(k) ?? []), r]);
  }
  for (const [k, list] of holders) {
    if (list.length < 2) continue;
    for (const r of list) {
      needs.push({ column: r.column, header: r.header, header_key: headerKey(r.header), reason: "FIELD_TWICE_IN_TAB", note: `Two columns of this tab are decided as the same field (${k}). Decide which one it is.` });
      Object.assign(r, { field: null, confidence: 0, method: "UNMATCHED" });
      delete r.custom;
      reused--;
    }
  }
  needs.sort((a, b) => a.column - b.column);
  return { map, needs, reused, autoIgnored };
}
