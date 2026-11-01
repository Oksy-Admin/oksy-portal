// Cleaning one source row (file 03 section 4 steps 5 and 7; file 02 sections 3 and 4;
// file 01 sections 4 to 7). Pure code: the worker reads the sheet and writes the database.
// Only confirmed hospital facts are used (hospital profile); anything unconfirmed stays
// NULL or UNKNOWN with an issue, never a guess (hard rule 6). ACTIVE rules raise issues;
// PROPOSED rules are recorded in shadow only (D-043, D-066). Money fields are always
// computed (R-T01 10% default is a parameter, D-066).
import type { CanonicalField } from "./mapping.ts";
import { evaluateRules, type EngineContext, type EngineIssue, type EngineRule } from "./engine.ts";
import { computeMoney, Money, type MoneyResult, type TdsChoice } from "./money.ts";
import { selectRules, resolveTdsRate, type RuleVersion, type RuleContext, type Selection } from "./selection.ts";
import {
  daysBetween,
  isBlank,
  nameKey,
  normaliseName,
  parseAmountCell,
  parseDate,
  parseIdentifier,
  splitUtrs,
  type DateOrder,
  type SourceCell,
} from "./normalise.ts";

export type Stage = "UNDER_TREATMENT" | "UNDER_PROCESSING" | "APPROVED" | "SETTLED" | "REJECTED" | "CANCELLED" | "UNKNOWN";
export type RowClass = "CLEAN" | "AUTO_FIXED" | "NEEDS_STAFF_INPUT" | "REJECTED" | "NON_DATA_ROW";
export type ColourMeaning =
  | "PREAUTH_INITIATED"
  | "PREAUTH_APPROVED"
  | "REJECTED_OR_CANCELLED"
  | "DISCHARGED"
  | "CLAIM_SUBMITTED"
  | "PAID";

/** Facts about one hospital sheet, each confirmed by the hospital or an approver. */
export interface HospitalProfile {
  hospitalCode: string;
  scheme: string;
  /** Tab -> stage, only where the hospital confirmed it (HMS: every PAID row is paid). */
  tabStage: Record<string, Stage>;
  /** Status words confirmed by the hospital, matched on nameKey (lowercase, no spaces). */
  statusWords: Record<string, Stage | "NOT_WRITTEN">;
  /** #rrggbb -> confirmed meaning. Empty until the legend is read and confirmed (G2). */
  colourLegend: Record<string, ColourMeaning>;
  /** nameKey(spelling) -> confirmed standard doctor name (G3, staff answer). */
  doctorAliases: Record<string, string>;
  /** nameKey(spelling) -> confirmed standard insurer name (Stage 2b dictionary, one list per scheme). */
  insurerAliases: Record<string, string>;
  /** nameKey(spelling) -> confirmed standard TPA name (Stage 2b dictionary, one list per scheme). */
  tpaAliases: Record<string, string>;
  /** nameKey(spelling) -> confirmed standard department name (Stage 2b dictionary, one list per scheme). */
  departmentAliases: Record<string, string>;
  /** Confirmed: a TPA cell holding an insurer name means no separate TPA (HMS 25-Oct). */
  tpaCellMayHoldInsurer: boolean;
  /** Known insurer name keys (Stage 2b: the scheme's confirmed insurer dictionary), to recognise an insurer in the TPA cell. */
  insurerKeys: string[];
  /** Tabs whose paid cell meaning (gross or net) is still an open question: no Discount 2. */
  paidMeaningOpenTabs: string[];
  /** POD Number rules (R-K06) run only from this date on; null = the rule never fires (decisions.md section 8). */
  podStartDate: string | null;
}

export interface SourceRow {
  tab: string;
  row: number; // 1-based sheet row
  cells: Partial<Record<CanonicalField, SourceCell>>;
  /** Unmapped and duplicate columns: original header -> text (kept, never dropped). */
  extra: Record<string, string>;
  /** Colour covering the row's main columns, or null. */
  rowColour: string | null;
  /** The row is a repeat of the header row. */
  isHeaderRepeat?: boolean;
}

export interface Issue {
  ruleId: string;
  severity: "E" | "W" | "I";
  tier: "A" | "B" | "C" | "D";
  shadow: boolean;
  field: string;
  detail: string; // rule wording only: never a value from the row
}

export interface Change {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  ruleId: string;
  tier: "A" | "B" | "C" | "D";
}

export interface CleanPayment {
  paymentNo: number;
  paymentDate: string | null;
  utrNo: string[];
  amountReceived: string | null;
  tdsAmountStated: string | null;
  flags: string[];
}

export interface CleanClaim {
  insurer_name: string | null;
  tpa_name: string | null;
  patient_name: string | null;
  patient_ip_no: string | null;
  policy_or_card_no: string | null;
  phone_number: string | null;
  policy_holder_name: string | null;
  preauth_or_claim_no: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  treatment_or_surgery: string | null;
  department: string | null;
  doctor_name: string | null;
  room_no: string | null;
  bill_amount: string | null;
  claimed_amount: string | null;
  approved_amount: string | null;
  copay_amount: string | null;
  /** Deduction (C) = Bill - Approved - Co-pay (column-dictionary section 4). Always computed; never read from the sheet. */
  deduction_amount: string | null;
  /** The hospital's own "Discount" column (decisions section 8); compared with deduction_amount by rule R-F01. */
  discount_amount: string | null;
  casesheet_sent_date: string | null;
  /** POD Number (column-dictionary.md section 1); rules apply from the hospital's POD Start Date. */
  courier_no: string | null;
  followup_log: string | null;
  claim_status: Stage;
  status_source: "column" | "colour" | "remarks" | "tab" | "unknown";
  rejection_reason: string | null;
  cancellation_reason: string | null;
  /** Total Settled (C): sum of the claim's payments. */
  settled_amount: string | null;
  settlement_date: string | null;
  utr_no: string[];
  remarks: string | null;
  los_days: number | null;
  date_swap_applied: boolean;
  tds_rate_used: string | null;
  tds_rate_source: "DEFAULT" | "RULE" | "CONFIRMED" | null;
  tds_rule_id: string | null;
  /** Total TDS (C): sum of the hospital's stated TDS per payment (never derived from a rate). */
  tds_amount: string | null;
  /** For comparison only (R-F03): Approved x the normal rate. Never written as a fact. */
  expected_tds_amount: string | null;
  /** Expected settlement (C) = Approved - Total TDS. */
  expected_settlement_amount: string | null;
  /** Balance Amount (C) = Approved - Total TDS - Total Settled. Zero allowed; negative is an Error (R-F06). */
  balance_amount: string | null;
  overdue_flag: boolean | null;
  pending_days: number | null;
  aging_bucket: "61-90" | "91-180" | "180+" | null;
  // Retired Stage 2a (decisions section 9: money rules rewritten); the columns stay, unused.
  gross_amount: null;
  discount_1_amount: null;
  discount_1_pct: null;
  discount_2_amount: null;
  discount_2_pct: null;
  discount_2_confirmed: null;
  tds_path: null;
  discount_2_resolution: null;
}

export interface CleanRow {
  tab: string;
  row: number;
  rowClass: RowClass;
  recordKey: string | null;
  keyType: "CLAIM_NO" | "FALLBACK" | null;
  claim: CleanClaim | null;
  payments: CleanPayment[];
  nullReasons: Record<string, string>;
  flags: string[];
  issues: Issue[];
  changes: Change[];
  extra: Record<string, string>;
  /** Amounts as the parser read them, for the independent reconciliation. */
  sourceAmounts: Record<"bill" | "claimed" | "approved" | "copay" | "settled", string | null>;
}

export const DEFAULT_TDS: TdsChoice = { rate: "0.10", source: "DEFAULT", ruleId: "R-T01" };

const CORE_FIELDS: CanonicalField[] = ["patient_name", "preauth_or_claim_no", "admission_date", "policy_or_card_no", "patient_ip_no"];

function fmt(m: InstanceType<typeof Money> | null, dp = 2): string | null {
  return m === null ? null : m.toFixed(dp);
}

function issue(ruleId: string, severity: Issue["severity"], tier: Issue["tier"], shadow: boolean, field: string, detail: string): Issue {
  return { ruleId, severity, tier, shadow, field, detail };
}

/**
 * TDS rate (extra field `tds`, a percent; decisions.md section 9, 1-Nov): at most 1 decimal,
 * cut off, never rounded; a whole number written with .0 becomes the whole number. A
 * trailing "%" is accepted and stripped. Anything that is not a plain number (with an
 * optional trailing %) is left as it is (null = no change).
 */
export function cleanTdsRate(raw: string): string | null {
  const trimmed = raw.trim();
  const stripped = trimmed.endsWith("%") ? trimmed.slice(0, -1).trim() : trimmed;
  const m = /^-?\d+(?:\.\d+)?$/.exec(stripped);
  if (!m) return null;
  const dot = m[0].indexOf(".");
  let cleaned = m[0];
  if (dot !== -1) {
    const intPart = m[0].slice(0, dot);
    const firstDecimal = m[0][dot + 1]!;
    cleaned = firstDecimal === "0" ? intPart : `${intPart}.${firstDecimal}`;
  }
  return cleaned === trimmed ? null : cleaned;
}

/**
 * `tds_amount_stated` only (decisions.md section 9, 1-Nov): rounded to the nearest whole
 * rupee, no decimals (never truncated). Never applied to bill, approved, settled, co-pay,
 * discount or any other amount. Anything that is not a plain number is left as it is (null =
 * no change).
 */
export function cleanTdsAmountStated(raw: string): string | null {
  const trimmed = raw.trim();
  const m = /^-?\d+(?:\.\d+)?$/.exec(trimmed);
  if (!m) return null;
  const n = Number(m[0]);
  const cleaned = String(Math.sign(n) * Math.round(Math.abs(n)));
  return cleaned === trimmed ? null : cleaned;
}

/** A row with no patient, claim no or admission date is a separator, total or banner (R-C01). */
export function isNonDataRow(r: SourceRow): boolean {
  if (r.isHeaderRepeat) return true;
  return CORE_FIELDS.every((f) => isBlank(r.cells[f]));
}

/** A row where every cell is empty is not a source row at all (sheet padding). */
export function isEmptyRow(r: SourceRow): boolean {
  return Object.values(r.cells).every((c) => isBlank(c)) && Object.values(r.extra).every((t) => t.trim() === "");
}

function stageFromColour(m: ColourMeaning, hasApproved: boolean): Stage | null {
  switch (m) {
    case "PREAUTH_INITIATED":
    case "PREAUTH_APPROVED":
      return "UNDER_TREATMENT";
    case "DISCHARGED":
      return "UNDER_PROCESSING";
    case "CLAIM_SUBMITTED":
      // HMS 25-Oct: approved but not paid stays GREEN until paid.
      return hasApproved ? "APPROVED" : "UNDER_PROCESSING";
    case "PAID":
      return "SETTLED";
    case "REJECTED_OR_CANCELLED":
      return null; // one colour for two stages: the reason decides, else ask
  }
}

/**
 * Claim identity (decision section 7, 30-Oct night): same claim = same claim number + same
 * admission date + same discharge date, inside one hospital + scheme. A blank date is "-" (a
 * patient still in hospital has no discharge date yet). Without a claim number the fallback
 * is patient name + admission date.
 */
export function recordKeyFor(
  p: HospitalProfile,
  claimNo: string | null,
  patient: string | null,
  doa: string | null,
  dod: string | null = null,
): { key: string | null; type: "CLAIM_NO" | "FALLBACK" | null } {
  const base = `${p.hospitalCode}|${p.scheme}`;
  if (claimNo) return { key: `${base}|C:${claimNo.toUpperCase().replace(/\s+/g, "")}|${doa ?? "-"}|${dod ?? "-"}`, type: "CLAIM_NO" };
  if (patient && doa) return { key: `${base}|F:${nameKey(patient)}|${doa}`, type: "FALLBACK" };
  return { key: null, type: null };
}

/**
 * The key the same claim had before its discharge date was known ("-"), or null when the key
 * is not a claim-number key or has no discharge date. A claim found under this key keeps its
 * record (record_uid) when the discharge date is filled in.
 */
export function openKeyOf(key: string): string | null {
  const parts = key.split("|");
  if (parts.length !== 5 || !parts[2]?.startsWith("C:") || parts[4] === "-") return null;
  return [...parts.slice(0, 4), "-"].join("|");
}

export interface CleanOptions {
  today: string; // ISO
  dateOrder: DateOrder | "MIXED";
  tds?: TdsChoice;
  ruleVersions?: RuleVersion[];
  /**
   * Two-part approval (decisions.md section 7, 1-Nov): a confirmed second part's own payments,
   * merged in so Total Settled / Total TDS / Balance are computed over both parts together.
   * Only ever set by packages/rules/src/two-part.ts, after a person has confirmed the match.
   */
  extraPayments?: Array<{ amount: string | null; date: string | null; utr: string | null; tdsStated: string | null }>;
  /** Two-part approval: the "Part 1 ... | Part 2 ..." breakdown, appended after the row's own remarks. */
  remarksSuffix?: string | null;
}

export function cleanRow(p: HospitalProfile, r: SourceRow, o: CleanOptions): CleanRow {
  const issues: Issue[] = [];
  const changes: Change[] = [];
  const nullReasons: Record<string, string> = {};
  const flags: string[] = [];
  const extra = { ...r.extra };
  const base = { tab: r.tab, row: r.row, extra, payments: [] as CleanPayment[] };

  const amounts = {
    bill: parseAmountCell(r.cells.bill_amount),
    claimed: parseAmountCell(r.cells.claimed_amount),
    approved: parseAmountCell(r.cells.approved_amount),
    copay: parseAmountCell(r.cells.copay_amount),
    settled: parseAmountCell(r.cells.payment_amount),
  };
  const sourceAmounts = {
    bill: amounts.bill.value,
    claimed: amounts.claimed.value,
    approved: amounts.approved.value,
    copay: amounts.copay.value,
    settled: amounts.settled.value,
  };

  if (isNonDataRow(r)) {
    return { ...base, rowClass: "NON_DATA_ROW", recordKey: null, keyType: null, claim: null, nullReasons, flags, issues: [issue("R-C01", "I", "A", false, "", "Separator, total, banner or repeated header row")], changes, sourceAmounts };
  }

  // TDS rate (extra field `tds`): lane 1, automatic, audit-tagged; the original text is kept.
  // `tds_amount_stated` and every bill/approved/settled amount are untouched (decisions.md
  // section 9, 1-Nov).
  if (extra.tds !== undefined) {
    const cleaned = cleanTdsRate(extra.tds);
    if (cleaned !== null) {
      changes.push({ field: "tds", oldValue: extra.tds, newValue: cleaned, ruleId: "M-TDS-RATE-FORMAT", tier: "B" });
      extra["tds (as entered)"] = extra.tds;
      extra.tds = cleaned;
    }
  }

  let sel: Selection | null = null;

  // Structural issues: reading-level, never switched off from the Rule Library (2a plan,
  // "which rule wins" note). Business-condition issues are raised by the engine, below.
  const structural = (ruleId: string, severity: Issue["severity"], field: string, detail: string) => {
    issues.push(issue(ruleId, severity, "C", false, field, detail));
  };

  const order: DateOrder = o.dateOrder === "MIXED" ? "DMY" : o.dateOrder;
  // The original text of a cell that could not be read is kept, never lost (file 02 section 3).
  const keepOriginal = (f: CanonicalField, reason: string | null) => {
    const t = r.cells[f]?.text;
    if (reason && reason !== "INPUT_MISSING" && t && t.trim() !== "") extra[`${f} (as entered)`] = t;
  };
  const dateAmbiguous: Partial<Record<CanonicalField, boolean>> = {};
  const date = (f: CanonicalField) => {
    const d = parseDate(r.cells[f], o.today, order);
    if (d.value === null) keepOriginal(f, d.reason);
    if (d.value === null && d.reason) nullReasons[f] = d.reason;
    if (d.reason === "INPUT_INVALID") structural("R-N02", "E", f, "Date cannot be read");
    if (d.reason === "OUT_OF_WINDOW") {
      const future = d.value! > o.today;
      structural(future ? "R-D04" : "R-D05", "E", f, future ? "Date in the future" : "Date before 01-Jan-2019");
    }
    if (d.ambiguous && o.dateOrder === "MIXED") dateAmbiguous[f] = true;
    return d.value;
  };
  const amount = (f: CanonicalField, parsed: ReturnType<typeof parseAmountCell>) => {
    if (parsed.value === null) keepOriginal(f, parsed.reason);
    if (parsed.value === null && parsed.reason && !isBlank(r.cells[f])) nullReasons[f] = parsed.reason;
    else if (parsed.value === null && parsed.reason) nullReasons[f] = "INPUT_MISSING";
    if (parsed.needsInput) structural("R-N02", "E", f, "Amount cannot be read (two amounts, words or shorthand)");
    if (parsed.value !== null && parsed.value.startsWith("-")) structural("R-N05", "E", f, "Negative amount");
    return parsed.value;
  };
  const ident = (f: CanonicalField, upper = false) => {
    const v = parseIdentifier(r.cells[f], { upper });
    if (v.value === null) keepOriginal(f, v.reason);
    if (v.value === null && v.reason) nullReasons[f] = v.reason;
    if (v.reason === "SCI_NOTATION_LOST") structural("R-N02", "E", f, "Number shown in scientific notation: digits lost");
    return v.value;
  };
  const text = (f: CanonicalField) => {
    const v = normaliseName(r.cells[f]);
    if (v.value === null && v.reason) nullReasons[f] = v.reason;
    return v.value;
  };

  // Identity and case
  const patient = text("patient_name");
  const claimNo = ident("preauth_or_claim_no", true);
  const policyOrCardNo = ident("policy_or_card_no");
  const phoneNumber = ident("phone_number");
  const policyHolderName = text("policy_holder_name");
  const courierNo = ident("courier_no");
  let admission = date("admission_date");
  let discharge = date("discharge_date");
  const casesheet = date("casesheet_sent_date");
  const paymentDate = date("payment_date");

  // Day-month swap (decisions section 9): the only automatic date fix, and only when the stay
  // is over 15 days (or negative) and the ambiguous date's day and month can be swapped. If
  // that does not bring the stay to 15 days or less, R-D06 asks instead of guessing.
  let dateSwapApplied = false;
  let dateSwapUnresolved = false;
  if (admission && discharge) {
    const rawLos = daysBetween(admission, discharge);
    if (rawLos > 15 || rawLos < 0) {
      const swapDayMonth = (iso: string) => `${iso.slice(0, 5)}${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
      let resolved = false;
      if (dateAmbiguous.discharge_date) {
        const swapped = swapDayMonth(discharge);
        const los2 = daysBetween(admission, swapped);
        if (los2 >= 0 && los2 <= 15) {
          changes.push({ field: "discharge_date", oldValue: discharge, newValue: swapped, ruleId: "R-D06", tier: "C" });
          discharge = swapped;
          resolved = true;
        }
      }
      if (!resolved && dateAmbiguous.admission_date) {
        const swapped = swapDayMonth(admission);
        const los2 = daysBetween(swapped, discharge);
        if (los2 >= 0 && los2 <= 15) {
          changes.push({ field: "admission_date", oldValue: admission, newValue: swapped, ruleId: "R-D06", tier: "C" });
          admission = swapped;
          resolved = true;
        }
      }
      if (resolved) dateSwapApplied = true;
      else dateSwapUnresolved = true;
    }
  }

  let insurer = text("insurer_name");
  if (insurer) {
    const std = p.insurerAliases[nameKey(insurer)];
    if (std && std !== insurer) {
      changes.push({ field: "insurer_name", oldValue: insurer, newValue: std, ruleId: "M-ALIAS-INSURER", tier: "B" });
      extra["insurer_name (as entered)"] = insurer;
      insurer = std;
    }
  }
  let tpa = text("tpa_name");
  if (tpa) {
    const std = p.tpaAliases[nameKey(tpa)];
    if (std && std !== tpa) {
      changes.push({ field: "tpa_name", oldValue: tpa, newValue: std, ruleId: "M-ALIAS-TPA", tier: "B" });
      extra["tpa_name (as entered)"] = tpa;
      tpa = std;
    }
  }
  if (p.tpaCellMayHoldInsurer && tpa && p.insurerKeys.some((k) => nameKey(tpa!).includes(k))) {
    if (!insurer) {
      changes.push({ field: "insurer_name", oldValue: null, newValue: tpa, ruleId: "HMS-TPA-IS-INSURER", tier: "B" });
      insurer = tpa;
    }
    changes.push({ field: "tpa_name", oldValue: tpa, newValue: null, ruleId: "HMS-TPA-IS-INSURER", tier: "B" });
    nullReasons.tpa_name = "NO_SEPARATE_TPA";
    tpa = null;
  }

  let doctor = text("doctor_name");
  if (doctor) {
    const std = p.doctorAliases[nameKey(doctor)];
    if (std && std !== doctor) {
      changes.push({ field: "doctor_name", oldValue: doctor, newValue: std, ruleId: "M-ALIAS-DOCTOR", tier: "B" });
      extra["doctor_name (as entered)"] = doctor;
      doctor = std;
    }
  }

  if (o.ruleVersions && o.ruleVersions.length > 0) {
    const ruleContext: RuleContext = {
      hospital: p.hospitalCode,
      scheme: p.scheme,
      insurer,
      tpa,
      dates: {
        admission,
        discharge,
        settlement: paymentDate,
      },
    };
    sel = selectRules(o.ruleVersions, ruleContext);
  }

  let department = text("department");
  if (department) {
    const std = p.departmentAliases[nameKey(department)];
    if (std && std !== department) {
      changes.push({ field: "department", oldValue: department, newValue: std, ruleId: "M-ALIAS-DEPARTMENT", tier: "B" });
      extra["department (as entered)"] = department;
      department = std;
    }
  }
  const treatment = text("treatment_or_surgery");
  for (const f of ["department", "treatment_or_surgery", "doctor_name"] as const) {
    if (r.cells[f] === undefined) nullReasons[f] = "NOT_RECORDED_IN_SOURCE"; // the sheet has no such column
  }

  const bill = amount("bill_amount", amounts.bill);
  const claimed = amount("claimed_amount", amounts.claimed);
  const approved = amount("approved_amount", amounts.approved);
  const copay = amount("copay_amount", amounts.copay);
  const settledCell = amount("payment_amount", amounts.settled);
  const discountStated = amount("discount_amount", parseAmountCell(r.cells.discount_amount));
  let tdsStated = amount("tds_amount_stated", parseAmountCell(r.cells.tds_amount_stated));
  // tds_amount_stated only: rounded to the nearest whole rupee (decisions.md section 9,
  // 1-Nov). Lane 1, automatic, audit-tagged; the original is kept. Every other amount field
  // (bill, approved, settled, co-pay, discount) is untouched.
  if (tdsStated !== null) {
    const rounded = cleanTdsAmountStated(tdsStated);
    if (rounded !== null) {
      changes.push({ field: "tds_amount_stated", oldValue: tdsStated, newValue: rounded, ruleId: "M-TDS-AMOUNT-ROUND", tier: "B" });
      extra["tds_amount_stated (as entered)"] = tdsStated;
      tdsStated = rounded;
    }
  }

  // Payments (D-047; HMS 25-Oct: one row holds a part payment with both UTRs; a pair is one payment)
  const utrGroups = splitUtrs(r.cells.payment_utr?.text ?? null);
  const utrs = utrGroups.flat();
  const payments: CleanPayment[] = [];
  if (settledCell !== null || utrs.length > 0 || paymentDate !== null) {
    const pf: string[] = [];
    if (utrGroups.length > 1) pf.push("AMOUNT_SPLIT_UNKNOWN");
    payments.push({ paymentNo: 1, paymentDate, utrNo: utrs, amountReceived: settledCell, tdsAmountStated: tdsStated, flags: pf });
    if (utrGroups.length > 1) flags.push("AMOUNT_SPLIT_UNKNOWN");
  }
  // Two-part approval (decisions.md section 7, 1-Nov): a confirmed second part's own payments,
  // added as their own payment rows (never merged into one, each keeps its own UTR).
  const extraUtrs: string[] = [];
  for (const p of o.extraPayments ?? []) {
    const u = p.utr ? p.utr.split("|") : [];
    extraUtrs.push(...u);
    payments.push({ paymentNo: payments.length + 1, paymentDate: p.date, utrNo: u, amountReceived: p.amount, tdsAmountStated: p.tdsStated, flags: [] });
  }
  const allUtrs = [...utrs, ...extraUtrs];
  let utrShapeInvalid = false;
  for (const u of allUtrs) {
    if (u.length < 8 || u.length > 25 || /[^A-Z0-9]/.test(u)) {
      utrShapeInvalid = true;
      break;
    }
  }

  // Status: confirmed tab, then the status column (confirmed words), then the confirmed colour.
  let stage: Stage | null = null;
  let source: CleanClaim["status_source"] = "unknown";
  let statusSourcesDisagree = false;
  let statusColourUnconfirmed = false;
  const tabStage = p.tabStage[r.tab];
  if (tabStage) {
    stage = tabStage;
    source = "tab";
  }
  const word = r.cells.status_text?.text ? p.statusWords[nameKey(r.cells.status_text.text)] : undefined;
  if (word && word !== "NOT_WRITTEN") {
    if (stage && stage !== word) statusSourcesDisagree = true;
    if (!stage) {
      stage = word;
      source = "column";
    }
  } else if (r.cells.status_text?.text && !isBlank(r.cells.status_text) && word === undefined) {
    extra["STATUS (unconfirmed word)"] = r.cells.status_text.text;
  }
  if (r.rowColour) {
    const meaning = p.colourLegend[r.rowColour];
    if (!meaning) {
      if (!stage) statusColourUnconfirmed = true;
    } else {
      const c = stageFromColour(meaning, approved !== null);
      if (c && stage && c !== stage) statusSourcesDisagree = true;
      else if (c && !stage) {
        stage = c;
        source = "colour";
      }
      // c === null (REJECTED_OR_CANCELLED colour, reason not yet known): stage stays unset
      // and falls through to UNKNOWN below, raised by R-S06 (one issue, not two).
    }
  }
  if (!stage) stage = "UNKNOWN";

  // Money (decisions.md section 8, rewritten Stage 2a): TDS default R-T01 unless a more
  // specific rule; Total TDS and TDS itself are never derived, only what the hospital stated.
  const chosenTds: TdsChoice = o.tds ?? (sel ? resolveTdsRate(sel) ?? DEFAULT_TDS : DEFAULT_TDS);
  const money: MoneyResult = computeMoney({
    bill,
    approved,
    copay,
    discountStated,
    payments: payments.map((x) => ({ amount: x.amountReceived, date: x.paymentDate, utr: x.utrNo.join("|") || null, tdsStated: x.tdsAmountStated })),
    tdsRate: chosenTds,
  });
  const paidMeaningOpen = p.paidMeaningOpenTabs.includes(r.tab);
  if (paidMeaningOpen) flags.push("PAID_MEANING_OPEN");
  for (const [field, f] of [
    ["deduction_amount", money.deduction],
    ["settled_amount", money.totalSettled],
    ["tds_amount", money.totalTds],
    ["expected_tds_amount", money.expectedTdsAmount],
    ["expected_settlement_amount", money.expectedSettlement],
    ["balance_amount", money.balance],
  ] as const) {
    if (f.value === null && f.reason) nullReasons[field] = f.reason;
  }
  // The "paid" cell's meaning (gross or net) is still an open question for this tab: Total
  // Settled may not really be "after TDS" yet, so the figures built on it are held back too.
  if (paidMeaningOpen) for (const f of ["expected_settlement_amount", "balance_amount"] as const) nullReasons[f] = "OPEN_QUESTION";

  // Derived booleans for the rule engine (flat AND/OR conditions only; compound situations
  // are worked out once here, as data the Rule Library can still switch its rule off for).
  const isUnderTreatment = stage === "UNDER_TREATMENT";
  const isApproved = stage === "APPROVED";
  const isSettled = stage === "SETTLED";
  const isRejected = stage === "REJECTED";
  const isCancelled = stage === "CANCELLED";
  const hasUtr = allUtrs.length > 0;
  const totalSettledVal = money.totalSettled.value;
  const losDays = admission && discharge ? daysBetween(admission, discharge) : null;

  const ctx: EngineContext = {
    today: o.today,
    values: {
      admission_date: admission,
      discharge_date: discharge,
      casesheet_sent_date: casesheet,
      payment_date: paymentDate,
      bill_amount: bill,
      claimed_amount: claimed,
      approved_amount: approved,
      copay_amount: copay,
      discount_amount: discountStated,
      deduction_amount: fmt(money.deduction.value),
      total_settled: fmt(money.totalSettled.value),
      total_tds: fmt(money.totalTds.value),
      expected_tds_amount: fmt(money.expectedTdsAmount.value),
      expected_settlement: fmt(money.expectedSettlement.value),
      balance_amount: fmt(money.balance.value),
      los_days: losDays,
      claim_status: stage,
      patient_name: patient,
      preauth_or_claim_no: claimNo,
      policy_or_card_no: policyOrCardNo,
      phone_number: phoneNumber,
      policy_holder_name: policyHolderName,
      courier_no: courierNo,
      pod_start_date: p.podStartDate,
      department,
      treatment_or_surgery: treatment,
      doctor_name: doctor,
      is_under_treatment: isUnderTreatment,
      is_approved: isApproved,
      is_settled: isSettled,
      is_approved_or_settled: isApproved || isSettled,
      is_rejected_or_cancelled: isRejected || isCancelled,
      has_utr: hasUtr,
      settlement_date_or_amount_missing: !paymentDate || totalSettledVal === null,
      settlement_data_present: totalSettledVal !== null || hasUtr,
      amounts_present: approved !== null || totalSettledVal !== null,
      reason_missing_for_rejected_or_cancelled: (isRejected && isBlank(r.cells.rejection_reason)) || (isCancelled && isBlank(r.cells.cancellation_reason)),
      date_swap_unresolved: dateSwapUnresolved,
      status_colour_unconfirmed: statusColourUnconfirmed,
      status_sources_disagree: statusSourcesDisagree,
      utr_shape_invalid: utrShapeInvalid,
    },
  };

  if (sel) {
    const toEngineRule = (r2: RuleVersion): EngineRule | null =>
      r2.checkDefinition && r2.severity
        ? { ruleId: r2.ruleId, version: r2.version, severity: r2.severity, checkDefinition: r2.checkDefinition, action: r2.action ?? "ASK_STAFF", staffMessage: r2.staffMessage ?? null }
        : null;
    const activeHits: EngineIssue[] = evaluateRules(sel.checks.map(toEngineRule).filter((x): x is EngineRule => x !== null), ctx);
    const shadowHits: EngineIssue[] = evaluateRules(sel.shadowChecks.map(toEngineRule).filter((x): x is EngineRule => x !== null), ctx);
    for (const h of activeHits) issues.push({ ruleId: h.ruleId, severity: h.severity, tier: "C", shadow: false, field: h.field, detail: h.message });
    for (const h of shadowHits) issues.push({ ruleId: h.ruleId, severity: h.severity, tier: "C", shadow: true, field: h.field, detail: h.message });
  }

  if (!admission && !nullReasons.admission_date?.startsWith("OUT")) structural("R-N02", "E", "admission_date", "Admission date missing");

  let { key, type } = recordKeyFor(p, claimNo, patient, admission, discharge);
  if (!key) {
    // Never dropped: kept under its row reference until staff give a claim no or name + date.
    structural("R-N02", "E", "record_key", "No claim no, or no patient name and admission date");
    key = `${p.hospitalCode}|${p.scheme}|ROW:${r.tab}#${r.row}`;
    type = "FALLBACK";
  }

  const activeBlocking = issues.some((i) => !i.shadow && i.severity === "E");
  const rowClass: RowClass = activeBlocking ? "NEEDS_STAFF_INPUT" : changes.length > 0 ? "AUTO_FIXED" : "CLEAN";

  const claim: CleanClaim = {
    insurer_name: insurer,
    tpa_name: tpa,
    patient_name: patient,
    patient_ip_no: ident("patient_ip_no"),
    policy_or_card_no: policyOrCardNo,
    phone_number: phoneNumber,
    policy_holder_name: policyHolderName,
    preauth_or_claim_no: claimNo,
    admission_date: admission,
    discharge_date: discharge,
    treatment_or_surgery: treatment,
    department,
    doctor_name: doctor,
    room_no: ident("room_no"),
    bill_amount: bill,
    claimed_amount: claimed,
    approved_amount: approved,
    copay_amount: copay,
    deduction_amount: fmt(money.deduction.value),
    discount_amount: discountStated,
    casesheet_sent_date: casesheet,
    courier_no: courierNo,
    followup_log: r.cells.followup_log?.text?.trim() || null,
    claim_status: stage,
    status_source: source,
    rejection_reason: r.cells.rejection_reason?.text?.trim() || null,
    cancellation_reason: r.cells.cancellation_reason?.text?.trim() || null,
    settled_amount: fmt(money.totalSettled.value),
    settlement_date: money.settlementDate,
    utr_no: allUtrs,
    remarks: [r.cells.remarks?.text?.trim() || null, o.remarksSuffix ?? null].filter(Boolean).join(" | ") || null,
    los_days: losDays,
    date_swap_applied: dateSwapApplied,
    tds_rate_used: money.tdsRateSource ? chosenTds.rate : null,
    tds_rate_source: money.tdsRateSource,
    tds_rule_id: money.tdsRateSource ? chosenTds.ruleId : null,
    tds_amount: fmt(money.totalTds.value),
    expected_tds_amount: fmt(money.expectedTdsAmount.value),
    expected_settlement_amount: paidMeaningOpen ? null : fmt(money.expectedSettlement.value),
    balance_amount: paidMeaningOpen ? null : fmt(money.balance.value),
    overdue_flag: isApproved && discharge ? daysBetween(discharge, o.today) > 60 : null,
    pending_days: isApproved && discharge ? daysBetween(discharge, o.today) : null,
    aging_bucket:
      isApproved && discharge
        ? ((): CleanClaim["aging_bucket"] => {
            const pd = daysBetween(discharge, o.today);
            return pd > 180 ? "180+" : pd > 90 ? "91-180" : pd > 60 ? "61-90" : null;
          })()
        : null,
    gross_amount: null,
    discount_1_amount: null,
    discount_1_pct: null,
    discount_2_amount: null,
    discount_2_pct: null,
    discount_2_confirmed: null,
    tds_path: null,
    discount_2_resolution: null,
  };

  return { ...base, payments, rowClass, recordKey: key, keyType: type, claim, nullReasons, flags, issues, changes, sourceAmounts };
}
