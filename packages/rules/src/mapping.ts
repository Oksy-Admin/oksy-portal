// Column mapping by header name (file 03 section 3). Order: alias dictionary, then the
// hospital's own confirmed headers. Unmatched columns go to extra_fields, never dropped.
// Ambiguous headers ("Amount", "Date", "Status", "Ref No", "Balance", "Deduction") are
// never mapped on the header alone.
import { normaliseHeader } from "./normalise.ts";

export type CanonicalField =
  | "serial_no"
  | "patient_name"
  | "patient_ip_no"
  | "policy_or_card_no"
  | "preauth_or_claim_no"
  | "insurer_name"
  | "tpa_name"
  | "admission_date"
  | "discharge_date"
  | "treatment_or_surgery"
  | "department"
  | "doctor_name"
  | "room_no"
  | "bill_amount"
  | "claimed_amount"
  | "approved_amount"
  | "copay_amount"
  | "deduction_amount"
  | "discount_amount"
  | "casesheet_sent_date"
  | "courier_no"
  | "followup_log"
  | "status_text"
  | "rejection_reason"
  | "cancellation_reason"
  | "payment_date"
  | "payment_amount"
  | "payment_utr"
  | "tds_amount_stated"
  | "remarks";

/** Normalised header -> field. Typical headers (file 03 section 3) plus HMS headers confirmed 25-Oct. */
const ALIASES: Record<string, CanonicalField> = {};
function alias(field: CanonicalField, ...headers: string[]): void {
  for (const h of headers) ALIASES[normaliseHeader(h)] = field;
}
alias("serial_no", "Sl No", "Sl. No", "S No", "S.No", "Sr No", "No", "Sno", "Slno");
alias("patient_name", "Patient Name", "Pt Name", "Name of Patient", "Patient", "Name");
alias("patient_ip_no", "IP No", "IP Number", "UHID", "MR No", "MRD No", "IP", "MRD/ UHID/ IP NUMBER", "MRD / UHID / IP No");
alias("policy_or_card_no", "Policy No", "Policy Number", "Card No", "Member ID", "Policy No / Card No", "Card Number",
  "Policy / Card Number", "Card Number / Policy Number");
alias("preauth_or_claim_no", "Pre-auth No", "Preauth No", "Claim No", "Claim Number", "Case No", "Authorisation No",
  "Authorization No", "CCN", "Claim ID", "AL No", "Pre Auth No");
alias("insurer_name", "Insurer", "Insurance Company", "Insurance", "Company", "Insurer Name", "Insurance Co", "Insurance Company Name");
alias("tpa_name", "TPA", "TPA Name");
alias("admission_date", "DOA", "Adm Date", "Admission Date", "Date of Admission", "Date Of Admission");
alias("discharge_date", "DOD", "Discharge Date", "Date of Discharge", "Date Of Discharge", "Dis Date");
alias("treatment_or_surgery", "Treatment", "Procedure", "Package", "Surgery", "Diagnosis", "Treatment / Surgery",
  "Procedure Name", "Procedure/Treatment", "Procedure / Treatment");
alias("department", "Department", "Dept", "Speciality", "Specialty");
alias("doctor_name", "Doctor", "Consultant", "Doctor Name", "Consultant Name", "Treating Doctor", "DR NAME");
alias("room_no", "Room No", "Room", "Bed No");
alias("bill_amount", "Bill", "Final Bill", "Bill Amount", "Total Bill", "Bill Amt", "Hospital Bill Amount");
alias("claimed_amount", "Claimed Amount", "Claim Amount", "Claimed Amt");
alias("approved_amount", "Final Approved Amount", "Final Approved", "Sanctioned", "Sanctioned Amount",
  "Approved Amount", "Final Approval");
alias("copay_amount", "Co-pay", "Copay", "Co Pay", "Patient Share", "Co-Pay Amount");
alias("discount_amount", "Discount", "Hospital Discount");
alias("casesheet_sent_date", "Hard Copy Sent", "Courier Date", "Hard Copy Date", "Casesheet Sent", "File Sent Date",
  "Hard Copy Sent Date");
alias("courier_no", "POD Number", "POD No", "POD", "Courier No");
alias("followup_log", "Follow Up", "Followup", "Follow-up", "Follow Up Remarks");
alias("rejection_reason", "Rejection Reason", "Reason for Rejection", "Denial Reason");
alias("cancellation_reason", "Cancellation Reason", "Reason for Cancellation");
alias("payment_date", "Settled Date", "Payment Date", "Paid Date", "Date of Payment", "Settlement Date", "Payment Received Date");
alias("payment_amount", "Paid Amount", "Amount Received", "Settled Amount", "Received Amount", "Paid Amt");
alias("payment_utr", "UTR", "UTR No", "UTR Number", "NEFT Ref", "NEFT No", "Transaction No");
alias("tds_amount_stated", "TDS", "TDS Amount");
alias("remarks", "Remark", "Remarks", "Claim Remark");
alias("status_text", "Claim Status", "Status of Claim", "Current Status");

/** Headers never mapped on the name alone (file 03 section 3): they go to extra_fields for G1 review. */
const NEVER_ON_HEADER_ALONE = new Set(
  ["Amount", "Date", "Status", "Ref No", "Balance", "Deduction", "Approved", "Ref"].map(normaliseHeader),
);

export interface ColumnMap {
  column: number;
  header: string;
  field: CanonicalField | null; // null = extra_fields
  confidence: number;
  method: "ALIAS" | "DUPLICATE_HEADER" | "UNMATCHED";
}

/**
 * Maps a header row. A repeated header keeps the first column; later copies are
 * DUPLICATE_HEADER (their value goes to extra_fields when it differs; file 03 section 3, HMS).
 * extra lets a hospital add its own confirmed headers (G1).
 */
export function mapHeaders(headers: Array<string | null>, extra: Record<string, CanonicalField> = {}): ColumnMap[] {
  const seenFields = new Set<CanonicalField>();
  const seenHeaders = new Set<string>();
  const local: Record<string, CanonicalField> = {};
  for (const [h, f] of Object.entries(extra)) local[normaliseHeader(h)] = f;
  return headers.map((raw, column) => {
    const header = (raw ?? "").trim();
    const key = normaliseHeader(header);
    if (key === "") return { column, header, field: null, confidence: 0, method: "UNMATCHED" };
    if (seenHeaders.has(key)) return { column, header, field: null, confidence: 1, method: "DUPLICATE_HEADER" };
    seenHeaders.add(key);
    const field = NEVER_ON_HEADER_ALONE.has(key) ? undefined : (local[key] ?? ALIASES[key]);
    if (!field || seenFields.has(field)) return { column, header, field: null, confidence: 0, method: "UNMATCHED" };
    seenFields.add(field);
    return { column, header, field, confidence: 0.95, method: "ALIAS" };
  });
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
