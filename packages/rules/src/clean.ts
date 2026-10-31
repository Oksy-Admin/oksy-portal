// Cleaning one source row (file 03 section 4 steps 5 and 7; file 02 sections 3 and 4;
// file 01 sections 4 to 7). Pure code: the worker reads the sheet and writes the database.
// Only confirmed hospital facts are used (hospital profile); anything unconfirmed stays
// NULL or UNKNOWN with an issue, never a guess (hard rule 6). ACTIVE rules raise issues;
// PROPOSED rules are recorded in shadow only (D-043, D-066). Money fields are always
// computed (R-T01 10% default is a parameter, D-066).
import type { CanonicalField } from "./mapping.ts";
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
  /** Confirmed: a TPA cell holding an insurer name means no separate TPA (HMS 25-Oct). */
  tpaCellMayHoldInsurer: boolean;
  /** Known insurer name keys, to recognise an insurer in the TPA cell. */
  insurerKeys: string[];
  /** Tabs whose paid cell meaning (gross or net) is still an open question: no Discount 2. */
  paidMeaningOpenTabs: string[];
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
  deduction_amount: string | null;
  casesheet_sent_date: string | null;
  followup_log: string | null;
  claim_status: Stage;
  status_source: "column" | "colour" | "remarks" | "tab" | "unknown";
  rejection_reason: string | null;
  cancellation_reason: string | null;
  settled_amount: string | null;
  settlement_date: string | null;
  utr_no: string[];
  remarks: string | null;
  los_days: number | null;
  tds_rate_used: string | null;
  tds_rate_source: "DEFAULT" | "RULE" | "CONFIRMED" | null;
  tds_rule_id: string | null;
  gross_amount: string | null;
  tds_amount: string | null;
  discount_1_amount: string | null;
  discount_1_pct: string | null;
  discount_2_amount: string | null;
  discount_2_pct: string | null;
  discount_2_confirmed: boolean | null;
  tds_path: "TDS_ON_PAID" | "TDS_ON_APPROVED" | "NEITHER" | null;
  discount_2_resolution: "OPEN" | "NOT_APPLICABLE" | null;
  overdue_flag: boolean | null;
  pending_days: number | null;
  aging_bucket: "61-90" | "91-180" | "180+" | null;
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

  let sel: Selection | null = null;

  const isRuleActive = (ruleId: string, defaultShadow = false): { enabled: boolean; shadow: boolean } => {
    if (!sel) {
      return { enabled: true, shadow: defaultShadow };
    }
    const inActive = sel.checks.some((c) => c.ruleId === ruleId);
    if (inActive) return { enabled: true, shadow: false };
    const inShadow = sel.shadowChecks.some((c) => c.ruleId === ruleId);
    if (inShadow) return { enabled: true, shadow: true };
    return { enabled: false, shadow: false };
  };

  const maybeIssue = (ruleId: string, severity: Issue["severity"], tier: Issue["tier"], defaultShadow: boolean, field: string, detail: string) => {
    const status = isRuleActive(ruleId, defaultShadow);
    if (!status.enabled) return;
    issues.push(issue(ruleId, severity, tier, status.shadow, field, detail));
  };

  const order: DateOrder = o.dateOrder === "MIXED" ? "DMY" : o.dateOrder;
  // The original text of a cell that could not be read is kept, never lost (file 02 section 3).
  const keepOriginal = (f: CanonicalField, reason: string | null) => {
    const t = r.cells[f]?.text;
    if (reason && reason !== "INPUT_MISSING" && t && t.trim() !== "") extra[`${f} (as entered)`] = t;
  };
  const date = (f: CanonicalField) => {
    const d = parseDate(r.cells[f], o.today, order);
    if (d.value === null) keepOriginal(f, d.reason);
    if (d.value === null && d.reason) nullReasons[f] = d.reason;
    if (d.reason === "INPUT_INVALID") maybeIssue("R-N02", "E", "C", false, f, "Date cannot be read");
    if (d.reason === "OUT_OF_WINDOW") {
      const future = d.value! > o.today;
      maybeIssue(future ? "R-D04" : "R-D05", "E", "C", false, f, future ? "Date in the future" : "Date before 01-Jan-2019");
    }
    if (d.ambiguous && o.dateOrder === "MIXED") maybeIssue("R-D06", "W", "C", true, f, "Day and month could be swapped (mixed sheet)");
    return d.value;
  };
  const amount = (f: CanonicalField, parsed: ReturnType<typeof parseAmountCell>) => {
    if (parsed.value === null) keepOriginal(f, parsed.reason);
    if (parsed.value === null && parsed.reason && !isBlank(r.cells[f])) nullReasons[f] = parsed.reason;
    else if (parsed.value === null && parsed.reason) nullReasons[f] = "INPUT_MISSING";
    if (parsed.needsInput) maybeIssue("R-N02", "E", "C", false, f, "Amount cannot be read (two amounts, words or shorthand)");
    if (parsed.value !== null && parsed.value.startsWith("-")) maybeIssue("R-A05", "E", "C", false, f, "Negative amount");
    return parsed.value;
  };
  const ident = (f: CanonicalField, upper = false) => {
    const v = parseIdentifier(r.cells[f], { upper });
    if (v.value === null) keepOriginal(f, v.reason);
    if (v.value === null && v.reason) nullReasons[f] = v.reason;
    if (v.reason === "SCI_NOTATION_LOST") maybeIssue("R-N02", "E", "C", false, f, "Number shown in scientific notation: digits lost");
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
  const admission = date("admission_date");
  const discharge = date("discharge_date");
  const casesheet = date("casesheet_sent_date");
  const paymentDate = date("payment_date");

  let insurer = text("insurer_name");
  let tpa = text("tpa_name");
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
    for (let i = issues.length - 1; i >= 0; i--) {
      const iss = issues[i]!;
      const st = isRuleActive(iss.ruleId, iss.shadow);
      if (!st.enabled) {
        issues.splice(i, 1);
      } else {
        iss.shadow = st.shadow;
      }
    }
  }

  const bill = amount("bill_amount", amounts.bill);
  const claimed = amount("claimed_amount", amounts.claimed);
  const approved = amount("approved_amount", amounts.approved);
  const copay = amount("copay_amount", amounts.copay);
  const settledCell = amount("payment_amount", amounts.settled);
  const deduction = amount("deduction_amount", parseAmountCell(r.cells.deduction_amount));
  const tdsStated = parseAmountCell(r.cells.tds_amount_stated).value;
  if (r.cells.discount_amount && !isBlank(r.cells.discount_amount)) extra["DISCOUNT (desk column)"] = r.cells.discount_amount.text ?? "";

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
  for (const u of utrs) {
    if (u.length < 8 || u.length > 25 || /[^A-Z0-9]/.test(u)) {
      maybeIssue("R-U01", "W", "C", false, "utr_no", "UTR looks implausible");
      break;
    }
  }

  // Status: confirmed tab, then the status column (confirmed words), then the confirmed colour.
  let stage: Stage | null = null;
  let source: CleanClaim["status_source"] = "unknown";
  const tabStage = p.tabStage[r.tab];
  if (tabStage) {
    stage = tabStage;
    source = "tab";
  }
  const word = r.cells.status_text?.text ? p.statusWords[nameKey(r.cells.status_text.text)] : undefined;
  if (word && word !== "NOT_WRITTEN") {
    if (stage && stage !== word) maybeIssue("R-X01", "W", "C", false, "claim_status", "Status column and tab disagree");
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
      if (!stage) maybeIssue("R-S07", "E", "C", false, "claim_status", "Row colour has no confirmed meaning");
    } else {
      const c = stageFromColour(meaning, approved !== null);
      if (c && stage && c !== stage) {
        maybeIssue("R-X01", "W", "C", false, "claim_status", "Row colour and status disagree");
      } else if (c && !stage) {
        stage = c;
        source = "colour";
      } else if (!c && !stage) {
        maybeIssue("R-S06", "E", "C", false, "claim_status", "Red row: rejected or cancelled not known");
      }
    }
  }
  if (!stage) {
    stage = "UNKNOWN";
    if (!issues.some((i) => i.field === "claim_status")) maybeIssue("R-S06", "E", "C", false, "claim_status", "Status unknown");
  }

  // Money (file 01 section 7): always computed, TDS default R-T01 unless a more specific rule.
  const chosenTds: TdsChoice = o.tds ?? (sel ? resolveTdsRate(sel) ?? DEFAULT_TDS : DEFAULT_TDS);
  const money: MoneyResult = computeMoney({
    bill,
    approved,
    copay,
    payments: payments.map((x) => ({ amount: x.amountReceived, date: x.paymentDate, utr: x.utrNo.join("|") || null })),
    tds: chosenTds,
  });
  const paidMeaningOpen = p.paidMeaningOpenTabs.includes(r.tab);
  if (paidMeaningOpen) flags.push("PAID_MEANING_OPEN");
  if (bill && approved && copay && new Money(bill).minus(approved).equals(copay) && !new Money(copay).isZero()) {
    flags.push("COPAY_INCLUDES_DISCOUNT1");
    maybeIssue("R-H01", "I", "B", true, "copay_amount", "CO-PAY equals Bill - Approved: copay and Discount 1 combined (D-061)");
  }
  for (const f of ["discount1", "gross", "tds", "discount2"] as const) {
    if (money[f].value === null && money[f].reason) nullReasons[f === "discount1" ? "discount_1_amount" : f === "discount2" ? "discount_2_amount" : `${f}_amount`] = money[f].reason!;
  }

  // ACTIVE rules (file 02 section 4)
  if (!patient) maybeIssue("R-N01", "E", "C", false, "patient_name", "Patient name empty");
  if (!admission && !nullReasons.admission_date?.startsWith("OUT")) maybeIssue("R-N02", "E", "C", false, "admission_date", "Admission date missing");
  if (admission && discharge && discharge < admission) maybeIssue("R-D01", "E", "C", false, "discharge_date", "Discharge earlier than admission");
  if (paymentDate && ((admission && paymentDate < admission) || (casesheet && paymentDate < casesheet)))
    maybeIssue("R-D03", "E", "C", false, "payment_date", "Settlement earlier than case sheet or admission");
  if (approved && claimed && new Money(approved).greaterThan(claimed)) maybeIssue("R-A01", "E", "C", false, "approved_amount", "Approved above claimed");
  if (claimed && bill && new Money(claimed).greaterThan(bill)) maybeIssue("R-A02", "W", "C", false, "claimed_amount", "Claimed above bill");
  const settledSum = money.settled.value;
  if (settledSum && approved && settledSum.greaterThan(approved)) maybeIssue("R-A03", "E", "C", false, "settled_amount", "Settled above approved");
  if ((stage === "APPROVED" || stage === "SETTLED") && (approved === null || new Money(approved).isZero()))
    maybeIssue("R-A05", "E", "C", false, "approved_amount", "Approved amount missing for an approved or settled claim");
  if (stage === "SETTLED") {
    if (utrs.length === 0) maybeIssue("R-S01", "E", "C", false, "utr_no", "Settled but no UTR");
    if (!paymentDate || settledSum === null) maybeIssue("R-S02", "E", "C", false, "settlement_date", "Settled but no settlement date or amount");
  }
  if (stage !== "SETTLED" && stage !== "UNKNOWN" && (settledSum !== null || utrs.length > 0))
    maybeIssue("R-S03", "W", "C", false, "claim_status", "Settlement data present but status not SETTLED");
  if (stage === "APPROVED" && approved === null) maybeIssue("R-S04", "E", "C", false, "approved_amount", "Approved but no approved amount");
  if ((stage === "REJECTED" || stage === "CANCELLED") && (approved !== null || settledSum !== null))
    maybeIssue("R-S05", "W", "C", false, "approved_amount", "Rejected or cancelled but amounts present");

  // PROPOSED rules: shadow only (D-043, D-066)
  if (bill && approved && new Money(approved).greaterThan(bill)) maybeIssue("R-A07", "E", "C", true, "approved_amount", "Approved above bill");
  else if (money.flags.includes("DISCOUNT1_NEGATIVE")) maybeIssue("R-A08", "E", "C", true, "copay_amount", "Approved + copay above bill");
  if (money.flags.includes("DISCOUNT2_BELOW_TOLERANCE") && !issues.some((i) => i.ruleId === "R-A03"))
    maybeIssue("R-A09", "E", "C", true, "settled_amount", "Discount 2 below minus INR 2");
  if (money.flags.includes("TDS_PATH_ON_APPROVED") || money.flags.includes("TDS_PATH_NEITHER"))
    maybeIssue("R-A12", "W", "C", true, "settled_amount", "Paid amount fits TDS on approved, or neither path");
  if (!claimNo && stage !== "UNDER_TREATMENT") maybeIssue("R-N03", "E", "C", true, "preauth_or_claim_no", "Claim no missing");
  for (const f of ["department", "treatment_or_surgery", "doctor_name"] as const) {
    if (r.cells[f] === undefined) nullReasons[f] = "NOT_RECORDED_IN_SOURCE"; // the sheet has no such column
    if (isBlank(r.cells[f])) maybeIssue("R-N04", "W", "C", true, f, "Department, procedure or doctor missing");
  }
  if (admission && discharge) {
    const los = daysBetween(admission, discharge);
    if (los > 15 || los < 0) maybeIssue("R-D06", "W", "C", true, "discharge_date", "Stay above 15 days or negative: swap check");
  }
  if ((stage === "REJECTED" && isBlank(r.cells.rejection_reason)) || (stage === "CANCELLED" && isBlank(r.cells.cancellation_reason)))
    maybeIssue("R-S10", "E", "C", true, "claim_status", "Reason missing for rejected or cancelled");

  // Overdue (R-S09, computed, status unchanged)
  let overdue: boolean | null = null;
  let pendingDays: number | null = null;
  let bucket: CleanClaim["aging_bucket"] = null;
  if (stage === "APPROVED" && discharge) {
    pendingDays = daysBetween(discharge, o.today);
    overdue = pendingDays > 60;
    bucket = pendingDays > 180 ? "180+" : pendingDays > 90 ? "91-180" : pendingDays > 60 ? "61-90" : null;
  }

  let { key, type } = recordKeyFor(p, claimNo, patient, admission, discharge);
  if (!key) {
    // Never dropped: kept under its row reference until staff give a claim no or name + date.
    maybeIssue("R-N02", "E", "C", false, "record_key", "No claim no, or no patient name and admission date");
    key = `${p.hospitalCode}|${p.scheme}|ROW:${r.tab}#${r.row}`;
    type = "FALLBACK";
  }

  const activeBlocking = issues.some((i) => !i.shadow && (i.severity === "E" || i.tier === "C" || i.tier === "D") && i.severity !== "I");
  const rowClass: RowClass = activeBlocking ? "NEEDS_STAFF_INPUT" : changes.length > 0 ? "AUTO_FIXED" : "CLEAN";

  const d2Open = money.discount2.value !== null && money.discount2.value.greaterThan(0);
  const claim: CleanClaim = {
    insurer_name: insurer,
    tpa_name: tpa,
    patient_name: patient,
    patient_ip_no: ident("patient_ip_no"),
    policy_or_card_no: ident("policy_or_card_no"),
    preauth_or_claim_no: claimNo,
    admission_date: admission,
    discharge_date: discharge,
    treatment_or_surgery: text("treatment_or_surgery"),
    department: text("department"),
    doctor_name: doctor,
    room_no: ident("room_no"),
    bill_amount: bill,
    claimed_amount: claimed,
    approved_amount: approved,
    copay_amount: copay,
    deduction_amount: deduction,
    casesheet_sent_date: casesheet,
    followup_log: r.cells.followup_log?.text?.trim() || null,
    claim_status: stage,
    status_source: source,
    rejection_reason: r.cells.rejection_reason?.text?.trim() || null,
    cancellation_reason: r.cells.cancellation_reason?.text?.trim() || null,
    settled_amount: fmt(money.settled.value),
    settlement_date: money.settlementDate,
    utr_no: utrs,
    remarks: r.cells.remarks?.text?.trim() || null,
    los_days: admission && discharge ? daysBetween(admission, discharge) : null,
    tds_rate_used: money.tdsRateSource ? chosenTds.rate : null,
    tds_rate_source: money.tdsRateSource,
    tds_rule_id: money.tdsRateSource ? chosenTds.ruleId : null,
    gross_amount: paidMeaningOpen ? null : fmt(money.gross.value),
    tds_amount: paidMeaningOpen ? null : fmt(money.tds.value),
    discount_1_amount: fmt(money.discount1.value),
    discount_1_pct: fmt(money.discount1Pct.value),
    discount_2_amount: paidMeaningOpen ? null : fmt(money.discount2.value),
    discount_2_pct: paidMeaningOpen ? null : fmt(money.discount2Pct.value),
    discount_2_confirmed: paidMeaningOpen ? null : money.settled.value === null ? null : money.discount2Confirmed,
    tds_path: money.settled.value === null || paidMeaningOpen ? null : money.tdsPath.path,
    discount_2_resolution: paidMeaningOpen || money.discount2.value === null ? null : d2Open ? "OPEN" : "NOT_APPLICABLE",
    overdue_flag: overdue,
    pending_days: pendingDays,
    aging_bucket: bucket,
  };
  if (paidMeaningOpen) for (const f of ["gross_amount", "tds_amount", "discount_2_amount"]) nullReasons[f] = "OPEN_QUESTION";

  return { ...base, payments, rowClass, recordKey: key, keyType: type, claim, nullReasons, flags, issues, changes, sourceAmounts };
}
