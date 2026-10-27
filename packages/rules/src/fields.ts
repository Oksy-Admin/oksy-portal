// The one field list for column mapping (requirements v1 section 10, v2 section 7). The
// worker, the AI prompt and the Column Mappings page all use this list; there is no copy.
// No imports, so the web page can load it without the rest of the rules package.
// Decision 27-Oct-2026: every report has these columns in the same order for every
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
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/**
 * A person's "Ignore (not needed)" choice, stored in column_mappings.canonical_field. The
 * column is not part of the data: never read into extra_fields, never in a report. Upper
 * case, so it can never clash with a field name. NULL stays "extra_fields": a column nobody
 * has decided on yet (the Yes/No question for it is Stage 6).
 */
export const IGNORE_FIELD = "IGNORE";

/** What a person can choose for one column: a field, Ignore, or null (extra_fields). */
export type MappingChoice = CanonicalField | typeof IGNORE_FIELD | null;

export function isCanonicalField(v: unknown): v is CanonicalField {
  return typeof v === "string" && (CANONICAL_FIELDS as readonly string[]).includes(v);
}

/** A valid choice for approve_column_mapping; anything else is refused before the database. */
export function isMappingChoice(v: unknown): v is MappingChoice {
  return v === null || v === IGNORE_FIELD || isCanonicalField(v);
}
