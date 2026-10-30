// The field list for column mapping (requirements v1 section 10, v2 section 7).
// Since 27-Oct-2026 the list lives in the database table mapping_fields, managed on the
// Fields page (Owner / Admin). The 35 core fields below are its seed (migration
// 20261027000028) and the fallback when the table cannot be read; a test checks that the
// seed and this list agree. No imports, so the web page can load it on its own.
// Decision 27-Oct-2026: every report has the ACTIVE fields in the same order for every
// hospital; a hospital without a column shows blank cells.

export const CANONICAL_FIELDS = [
  "serial_no",
  "patient_name",
  "patient_ip_no",
  "policy_or_card_no",
  "phone_number",
  "policy_holder_name",
  "preauth_or_claim_no",
  "insurer_name",
  "tpa_name",
  "admission_date",
  "discharge_date",
  "treatment_or_surgery",
  "department",
  "doctor_name",
  "room_no",
  "room_category",
  "bill_amount",
  "claimed_amount",
  "preauth_approved_amount",
  "approved_amount",
  "copay_amount",
  "deduction_amount",
  "discount_amount",
  "casesheet_sent_date",
  "courier_no",
  "followup_date",
  "followup_log",
  "status_text",
  "rejection_reason",
  "cancellation_reason",
  "payment_date",
  "payment_amount",
  "payment_utr",
  "tds_amount_stated",
  "remarks",
] as const;
/** A core field: the cleaning engine reads it by this name (claims_staging columns). */
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export const FIELD_TYPES = ["text", "number", "date", "amount"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** One row of mapping_fields. key never changes; a rename changes only label. */
export interface FieldDef {
  key: string;
  label: string;
  data_type: FieldType;
  aliases: string[];
  status: "ACTIVE" | "HIDDEN";
  is_core: boolean;
  sort_order: number;
}

/**
 * Headers never mapped on the name alone (file 03 section 3): they go to extra_fields for
 * a person to decide. Also refused as an alias on the Fields page.
 */
export const NEVER_ALONE_HEADERS = ["Amount", "Date", "Status", "Ref No", "Balance", "Deduction", "Approved", "Ref"];

/** The header comparison key (same rule as normaliseHeader): lower case letters and digits only. */
export function aliasKey(h: string | null | undefined): string {
  return (h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Cleans an alias list from the Fields page: trimmed, no empties, no repeats, nothing on the
 * never-alone list. Returns the problem instead when there is one.
 */
export function cleanAliases(input: string[]): { aliases: string[] } | { error: string } {
  const out: string[] = [];
  const seen = new Set<string>();
  const never = new Set(NEVER_ALONE_HEADERS.map(aliasKey));
  for (const raw of input) {
    const a = raw.trim();
    const k = aliasKey(a);
    if (!k || seen.has(k)) continue;
    if (never.has(k)) return { error: `"${a}" is too general to map a column on its own; it cannot be an alias.` };
    if (a.length > 80) return { error: `Alias "${a.slice(0, 20)}…" is longer than 80 characters.` };
    seen.add(k);
    out.push(a);
  }
  return { aliases: out };
}

/** Keys: lower case, letters, digits and _. A field added on the Fields page gets one from its label. */
export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{1,62}$/;

/**
 * Label, type and the usual headers of each core field (file 03 section 3, HMS headers
 * confirmed 25-Oct, Stage 3 additions 27-Oct). Headers are compared after normaliseHeader.
 */
export const CORE_FIELDS: Record<CanonicalField, { label: string; data_type: FieldType; aliases: string[] }> = {
  serial_no: { label: "Serial No", data_type: "number", aliases: ["Sl No", "Sl. No", "S No", "S.No", "Sr No", "No", "Sno", "Slno"] },
  patient_name: { label: "Patient Name", data_type: "text", aliases: ["Patient Name", "Pt Name", "Name of Patient", "Patient", "Name"] },
  patient_ip_no: { label: "IP Number", data_type: "text", aliases: ["IP No", "IP Number", "MR No", "MRD No", "IP", "MRD/ UHID/ IP NUMBER", "MRD / UHID / IP No"] },
  policy_or_card_no: {
    label: "Policy Number / Card ID",
    data_type: "text",
    aliases: ["Policy No", "Policy Number", "Card No", "Member ID", "Policy No / Card No", "Card Number", "Policy / Card Number", "Card Number / Policy Number"],
  },
  phone_number: { label: "Phone Number", data_type: "text", aliases: ["Phone", "Phone No", "Phone Number", "Mobile", "Mobile No", "Mobile Number", "Contact No", "Contact Number"] },
  policy_holder_name: { label: "Policy Holder Name", data_type: "text", aliases: ["Policy Holder", "Policy Holder Name", "Insured Name", "Card Holder", "Card Holder Name"] },
  preauth_or_claim_no: {
    label: "Claim Number",
    data_type: "text",
    aliases: ["Pre-auth No", "Preauth No", "Claim No", "Claim Number", "Case No", "Authorisation No", "Authorization No", "CCN", "Claim ID", "AL No", "Pre Auth No"],
  },
  insurer_name: { label: "Insurer", data_type: "text", aliases: ["Insurer", "Insurance Company", "Insurance", "Company", "Insurer Name", "Insurance Co", "Insurance Company Name"] },
  tpa_name: { label: "TPA", data_type: "text", aliases: ["TPA", "TPA Name"] },
  admission_date: { label: "Admission Date", data_type: "date", aliases: ["DOA", "Adm Date", "Admission Date", "Date of Admission", "Date Of Admission"] },
  discharge_date: { label: "Discharge Date", data_type: "date", aliases: ["DOD", "Discharge Date", "Date of Discharge", "Date Of Discharge", "Dis Date"] },
  treatment_or_surgery: {
    label: "Procedure / Treatment",
    data_type: "text",
    aliases: ["Treatment", "Procedure", "Package", "Surgery", "Diagnosis", "Treatment / Surgery", "Procedure Name", "Procedure/Treatment", "Procedure / Treatment"],
  },
  department: { label: "Department", data_type: "text", aliases: ["Department", "Dept", "Speciality", "Specialty"] },
  doctor_name: { label: "Doctor", data_type: "text", aliases: ["Doctor", "Consultant", "Doctor Name", "Consultant Name", "Treating Doctor", "DR NAME"] },
  room_no: { label: "Room No", data_type: "text", aliases: ["Room No", "Room", "Bed No"] },
  room_category: { label: "Room Category", data_type: "text", aliases: ["Room Category", "Room Type"] },
  bill_amount: { label: "Bill Amount", data_type: "amount", aliases: ["Bill", "Final Bill", "Bill Amount", "Total Bill", "Bill Amt", "Hospital Bill Amount"] },
  claimed_amount: { label: "Claimed Amount", data_type: "amount", aliases: ["Claimed Amount", "Claim Amount", "Claimed Amt"] },
  preauth_approved_amount: {
    label: "Pre-auth Approved Amount",
    data_type: "amount",
    aliases: ["Pre-auth Approval Amount", "Pre-auth Approved Amount", "Preauth Approved Amount", "Pre Auth Approved Amount", "Preauth Approval Amount"],
  },
  approved_amount: { label: "Approved Amount", data_type: "amount", aliases: ["Final Approved Amount", "Final Approved", "Sanctioned", "Sanctioned Amount", "Approved Amount", "Final Approval"] },
  copay_amount: { label: "Co-pay", data_type: "amount", aliases: ["Co-pay", "Copay", "Co Pay", "Patient Share", "Co-Pay Amount"] },
  deduction_amount: { label: "Deduction", data_type: "amount", aliases: [] },
  discount_amount: { label: "Discount", data_type: "amount", aliases: ["Discount", "Hospital Discount"] },
  casesheet_sent_date: {
    label: "Hardcopy Sent Date",
    data_type: "date",
    aliases: ["Hard Copy Sent", "Courier Date", "Hard Copy Date", "Casesheet Sent", "File Sent Date", "Hard Copy Sent Date"],
  },
  courier_no: { label: "POD Number", data_type: "text", aliases: ["POD Number", "POD No", "POD", "Courier No"] },
  followup_date: { label: "Follow-up Date", data_type: "date", aliases: ["Follow Up Date", "Follow-up Date", "Next Follow Up", "Next Follow Up Date"] },
  followup_log: { label: "Follow-up Remarks", data_type: "text", aliases: ["Follow Up", "Followup", "Follow-up"] },
  status_text: { label: "Claim Status", data_type: "text", aliases: ["Claim Status", "Status of Claim", "Current Status"] },
  rejection_reason: { label: "Rejection Reason", data_type: "text", aliases: ["Rejection Reason", "Reason for Rejection", "Denial Reason"] },
  cancellation_reason: { label: "Cancellation Reason", data_type: "text", aliases: ["Cancellation Reason", "Reason for Cancellation"] },
  payment_date: {
    label: "Settlement Date",
    data_type: "date",
    aliases: ["Settled Date", "Payment Date", "Paid Date", "Date of Payment", "Settlement Date", "Payment Received Date"],
  },
  payment_amount: { label: "Settled Amount", data_type: "amount", aliases: ["Paid Amount", "Amount Received", "Settled Amount", "Received Amount", "Paid Amt"] },
  payment_utr: { label: "UTR", data_type: "text", aliases: ["UTR", "UTR No", "UTR Number", "NEFT Ref", "NEFT No", "Transaction No"] },
  tds_amount_stated: { label: "TDS", data_type: "amount", aliases: ["TDS", "TDS Amount"] },
  remarks: { label: "Remarks", data_type: "text", aliases: ["Remark", "Remarks", "Claim Remark", "Follow Up Remarks"] },
};

/** The core fields as mapping_fields rows (seed and fallback), in report order. */
export function coreFieldDefs(): FieldDef[] {
  return CANONICAL_FIELDS.map((key, i) => ({ key, ...CORE_FIELDS[key], status: "ACTIVE", is_core: true, sort_order: (i + 1) * 10 }));
}

/**
 * A person's "Ignore (not needed)" choice, stored in column_mappings.canonical_field. The
 * column is not part of the data: never read into extra_fields, never in a report. Upper
 * case, so it can never clash with a field key. NULL stays "extra_fields": a column nobody
 * has decided on yet (the Yes/No question for it is Stage 6).
 */
export const IGNORE_FIELD = "IGNORE";

/**
 * Fields that take more than one source column (decision 27-Oct-2026, Anoop). Rule, kept
 * simple on purpose: every other field takes one column per layout; a field on this list
 * takes every column mapped to it. The values are joined with " | " in the sheet's column
 * order, and empty values are skipped (no double separators). The report has one column
 * for the field. Today only remarks (hospital sheets have two REMARK columns).
 */
export const MULTI_COLUMN_FIELDS: readonly string[] = ["remarks"];
export const MULTI_COLUMN_SEPARATOR = " | ";

export function acceptsManyColumns(key: string | null | undefined): boolean {
  return key != null && MULTI_COLUMN_FIELDS.includes(key);
}

/**
 * The values of a multi-column field, in column order: trimmed, empties skipped, joined.
 * null when all are empty. With labels (the source column names), each value is prefixed
 * "LABEL: value" (decision 30-Oct: one remarks field, joined, prefixed by the column name).
 */
export function joinColumnValues(values: Array<string | null | undefined>, labels?: string[]): string | null {
  const kept = values
    .map((v, i) => {
      const t = (v ?? "").trim();
      const label = (labels?.[i] ?? "").replace(/\s+/g, " ").trim();
      return t === "" ? "" : label ? `${label}: ${t}` : t;
    })
    .filter((v) => v !== "");
  return kept.length === 0 ? null : kept.join(MULTI_COLUMN_SEPARATOR);
}

/** What a person can choose for one column: a field key, Ignore, or null (extra_fields). */
export type MappingChoice = string | null;

export function isCanonicalField(v: unknown): v is CanonicalField {
  return typeof v === "string" && (CANONICAL_FIELDS as readonly string[]).includes(v);
}

/**
 * A valid choice for a new mapping: null, Ignore, or an ACTIVE field of the list (the core
 * list when none is given). A hidden field is not offered for new mappings.
 */
export function isMappingChoice(v: unknown, fields: FieldDef[] = coreFieldDefs()): v is MappingChoice {
  if (v === null || v === IGNORE_FIELD) return true;
  return typeof v === "string" && fields.some((f) => f.key === v && f.status === "ACTIVE");
}

/**
 * Why a field cannot be deleted, or null when it can: a core field never (the cleaning
 * engine reads it), any other field only when no column uses it. The database checks again.
 */
export function deleteBlockReason(field: Pick<FieldDef, "is_core">, columnsUsing: number): string | null {
  if (field.is_core) return "Core field: hide instead";
  if (columnsUsing > 0) return "In use, hide instead";
  return null;
}

/** Fields offered for a new mapping: ACTIVE ones, in the fixed order. */
export function offeredFields(fields: FieldDef[]): FieldDef[] {
  return reportFields(fields);
}

/** Report columns: every ACTIVE field, in the fixed order (sort_order, then key). */
export function reportFields(fields: FieldDef[]): FieldDef[] {
  return fields.filter((f) => f.status === "ACTIVE").sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

/**
 * One report row: a value per report column. A core field comes from the claim, a field
 * added on the Fields page from extra_fields (by key). No value = blank cell.
 */
export function reportRow(fields: FieldDef[], claim: Record<string, unknown>, extra: Record<string, string> = {}): string[] {
  return reportFields(fields).map((f) => {
    const v = f.is_core ? claim[f.key] : extra[f.key];
    return v === null || v === undefined ? "" : String(v);
  });
}
