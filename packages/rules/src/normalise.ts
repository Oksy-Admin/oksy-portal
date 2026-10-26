// Normalisation (file 02 section 3). Pure code: no database, no Google. A value that cannot
// be read safely becomes NULL with a reason, never a guess (hard rule 6). Amounts stay
// decimal strings; they never pass through JavaScript arithmetic (hard rule 7).

/** One source cell as the engine needs it (built from the Sheets API by the worker). */
export interface SourceCell {
  /** The text the sheet shows (formattedValue). */
  text: string | null;
  /** The cell's number (effectiveValue.numberValue), when the cell holds a number or a date. */
  number?: number | null;
  /** Background colour as #rrggbb, or null for none or white. */
  colour?: string | null;
}

export type NullCode = "INPUT_MISSING" | "INPUT_INVALID" | "NOT_A_VALUE" | "OUT_OF_WINDOW" | "SCI_NOTATION_LOST";

export interface Parsed<T> {
  value: T | null;
  /** Why value is NULL (or, for OUT_OF_WINDOW, why the kept value is wrong). */
  reason: NullCode | null;
  /** The cell needs a person (tier C): ambiguous, two amounts, "45k" and the like. */
  needsInput?: boolean;
}

const BLANK_WORDS = /^(na|n\/a|nil|null|none|-+|–|—|\.|0?\s*-\s*0?|pending|not available|nill)$/i;

export function isBlank(cell: SourceCell | undefined | null): boolean {
  return cell == null || cell.text == null || cell.text.trim() === "";
}

/** Header as a key: lowercase, letters and digits only (file 03 section 3, version groups). */
export function normaliseHeader(h: string | null | undefined): string {
  return (h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------------------

/** A JavaScript number read from the sheet, as a plain decimal string without arithmetic. */
function numberToDecimalString(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  if (!/e/i.test(s)) return s;
  // Very small or very large: use fixed notation only when it is exact.
  if (Math.abs(n) >= 1e21) return null;
  return n.toFixed(20).replace(/\.?0+$/, "");
}

/**
 * INR amount (file 02 section 3, Amounts): strips ₹, Rs, Rs., INR, /-, commas (lakh style
 * too). NIL, -, NA = NULL (not zero). "45k", "1.2 L", "50000 + 12000" = NULL and needs input.
 */
export function parseAmountCell(cell: SourceCell | undefined | null): Parsed<string> {
  if (isBlank(cell)) return { value: null, reason: "INPUT_MISSING" };
  const text = cell!.text!.trim();
  if (typeof cell!.number === "number") {
    const s = numberToDecimalString(cell!.number);
    if (s !== null) return { value: s, reason: null };
  }
  if (BLANK_WORDS.test(text)) return { value: null, reason: "NOT_A_VALUE" };
  const cleaned = text
    .replace(/₹|\binr\b|\brs\.?/gi, "")
    .replace(/\/-\s*$/, "")
    .replace(/[,\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return { value: cleaned.replace(/^(-?)0+(?=\d)/, "$1"), reason: null };
  }
  return { value: null, reason: "INPUT_INVALID", needsInput: true };
}

// ---------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export const DATE_WINDOW_START = "2019-01-01";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= (days[m - 1] ?? 0);
}

function fullYear(y: number): number {
  if (y >= 100) return y;
  return y <= 29 ? 2000 + y : 1900 + y;
}

/** Sheets and Excel date serial (days since 30-Dec-1899) to ISO, integer part only. */
export function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 100000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export type DateOrder = "DMY" | "MDY";

export interface ParsedDate extends Parsed<string> {
  /** Both parts were 12 or less, so day and month could be swapped (file 02 section 3). */
  ambiguous?: boolean;
  /** The two numeric parts, for the sheet-level day-first check. */
  parts?: [number, number];
}

/**
 * A date cell. Real date cells (a number with date text) use the serial. Text accepts
 * 12/03/2022, 12-3-22, 12.03.2022, 12 Mar 2022, 12-Mar-2022, March 12, 2022, 2022-03-12.
 * Indian sheets are day-first unless the sheet shows otherwise (order). Window: from
 * 01-Jan-2019 to today; outside it the value is kept with reason OUT_OF_WINDOW (an error,
 * not auto-fixed).
 */
export function parseDate(cell: SourceCell | undefined | null, today: string, order: DateOrder = "DMY"): ParsedDate {
  if (isBlank(cell)) return { value: null, reason: "INPUT_MISSING" };
  const text = cell!.text!.trim();
  if (BLANK_WORDS.test(text)) return { value: null, reason: "NOT_A_VALUE" };

  let iso: string | null = null;
  let ambiguous = false;
  let parts: [number, number] | undefined;

  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    iso = validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  } else if ((m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(Number(m[3]));
    parts = [a, b];
    let d: number;
    let mo: number;
    if (a > 12 && b <= 12) [d, mo] = [a, b];
    else if (b > 12 && a <= 12) [d, mo] = [b, a];
    else {
      [d, mo] = order === "DMY" ? [a, b] : [b, a];
      ambiguous = a <= 12 && b <= 12 && a !== b;
    }
    iso = validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  } else if ((m = text.match(/^(\d{1,2})[\s-]*([a-z]{3,9})\.?[\s,-]*(\d{2}|\d{4})$/i))) {
    const word = (m[2] ?? "").toLowerCase();
    const mo = MONTHS[word.slice(0, word.startsWith("sept") ? 4 : 3)];
    const y = fullYear(Number(m[3]));
    const d = Number(m[1]);
    iso = mo && validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  } else if ((m = text.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i))) {
    const mo = MONTHS[(m[1] ?? "").toLowerCase().slice(0, 3)];
    const y = Number(m[3]);
    const d = Number(m[2]);
    iso = mo && validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  } else if (typeof cell!.number === "number" && /^\d{5}(\.\d+)?$/.test(text)) {
    iso = serialToIso(cell!.number); // a date typed as a plain serial number
  }

  // A real date cell: the serial is the truth when the text could not be read.
  if (iso === null && typeof cell!.number === "number" && !/^\d+(\.\d+)?$/.test(text)) {
    iso = serialToIso(cell!.number);
  }
  if (iso === null) return { value: null, reason: "INPUT_INVALID", needsInput: true };
  if (iso < DATE_WINDOW_START || iso > today) return { value: iso, reason: "OUT_OF_WINDOW", ambiguous, parts };
  return { value: iso, reason: null, ambiguous, parts };
}

/**
 * Sheet-level order (file 02 section 3): a first part above 12 means day-first, a second
 * part above 12 means month-first; both seen = MIXED (each ambiguous date is then tier C).
 */
export function detectDateOrder(parts: Array<[number, number] | undefined>): DateOrder | "MIXED" {
  let dayFirst = false;
  let monthFirst = false;
  for (const p of parts) {
    if (!p) continue;
    if (p[0] > 12 && p[1] <= 12) dayFirst = true;
    if (p[1] > 12 && p[0] <= 12) monthFirst = true;
  }
  if (dayFirst && monthFirst) return "MIXED";
  return monthFirst ? "MDY" : "DMY";
}

/** Whole days from a to b (ISO dates). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// ---------------------------------------------------------------------------------------
// Text identifiers and names
// ---------------------------------------------------------------------------------------

/**
 * Claim no, policy no, UTR, IP no: always text, trimmed, digits never changed. Scientific
 * notation (1.23457E+11) means the sheet lost digits: recover from the cell number only when
 * it is a safe whole number, else NULL and ask (file 02 section 3).
 */
export function parseIdentifier(cell: SourceCell | undefined | null, opts: { upper?: boolean } = {}): Parsed<string> {
  if (isBlank(cell)) return { value: null, reason: "INPUT_MISSING" };
  let text = cell!.text!.trim().replace(/\s+/g, " ");
  if (BLANK_WORDS.test(text)) return { value: null, reason: "NOT_A_VALUE" };
  if (/^\d(\.\d+)?e\+?\d+$/i.test(text)) {
    const n = cell!.number;
    if (typeof n === "number" && Number.isSafeInteger(n)) text = String(n);
    else return { value: null, reason: "SCI_NOTATION_LOST", needsInput: true };
  }
  return { value: opts.upper ? text.toUpperCase() : text, reason: null };
}

/** Patient, doctor names: collapse spaces, trim, drop a leading serial number; spelling never changed. */
export function normaliseName(cell: SourceCell | undefined | null): Parsed<string> {
  if (isBlank(cell)) return { value: null, reason: "INPUT_MISSING" };
  const text = cell!.text!.replace(/\s+/g, " ").trim().replace(/^\d{1,4}[.)]\s+/, "");
  if (text === "" || BLANK_WORDS.test(text)) return { value: null, reason: "NOT_A_VALUE" };
  return { value: text, reason: null };
}

/** Key for matching names to an alias list: lowercase, no spaces or punctuation. */
export function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A UTR cell (D-047, HMS answers 25-Oct): "AXISCN…|UTIBN…" (a bank reference and UTR pair)
 * is ONE payment; several UTRs in one cell (comma, newline, "&", "and", "/") are listed but
 * the amount is not split: the caller flags AMOUNT_SPLIT_UNKNOWN.
 */
export function splitUtrs(text: string | null): string[][] {
  if (text == null || text.trim() === "") return [];
  return text
    .split(/[,;\n&]+|\s+and\s+|\s+\/\s+/i)
    .map((g) => g.trim())
    .filter((g) => g !== "" && !BLANK_WORDS.test(g))
    .map((g) =>
      g
        .split("|")
        .map((u) => u.trim().replace(/\s+/g, "").toUpperCase())
        .filter((u) => u !== ""),
    );
}
