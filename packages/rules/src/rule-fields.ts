// The fields a Rule Library condition can read (Stage 2d). Distinct from fields.ts's
// CANONICAL_FIELDS (sheet-mapping targets): this list is the engine's own context keys
// (engine.ts EngineContext.values) -- the claim fields plus the derived flags and computed
// money fields clean.ts adds before the engine runs. One source for the rule-form field
// dropdown, the plain-words AI prompt and the CSV upload template, so they can never drift
// from what engine.ts actually reads.
export type RuleFieldType = "text" | "number" | "date" | "boolean";

export interface RuleFieldDef {
  label: string;
  type: RuleFieldType;
  /** False for a flag only known at sheet-read time (colour, day-month swap, status
   * disagreement): a "test before save" run against stored claims can never see these,
   * because by the time a claim is stored its status and dates are already resolved. */
  availableInTest: boolean;
}

export const RULE_FIELDS: Record<string, RuleFieldDef> = {
  admission_date: { label: "Admission date", type: "date", availableInTest: true },
  discharge_date: { label: "Discharge date", type: "date", availableInTest: true },
  casesheet_sent_date: { label: "Hardcopy sent date", type: "date", availableInTest: true },
  payment_date: { label: "Settlement date", type: "date", availableInTest: true },
  bill_amount: { label: "Bill amount", type: "number", availableInTest: true },
  claimed_amount: { label: "Claimed amount", type: "number", availableInTest: true },
  approved_amount: { label: "Approved amount", type: "number", availableInTest: true },
  discount_amount: { label: "Discount (hospital's own column)", type: "number", availableInTest: true },
  deduction_amount: { label: "Deduction (Bill - Approved - Co-pay)", type: "number", availableInTest: true },
  total_settled: { label: "Total settled", type: "number", availableInTest: true },
  total_tds: { label: "Total TDS", type: "number", availableInTest: true },
  expected_tds_amount: { label: "Expected TDS (normal rate x Approved)", type: "number", availableInTest: true },
  expected_settlement: { label: "Expected settlement (Approved - Total TDS)", type: "number", availableInTest: true },
  balance_amount: { label: "Balance (Approved - Total TDS - Total settled)", type: "number", availableInTest: true },
  los_days: { label: "Length of stay (days)", type: "number", availableInTest: true },
  claim_status: { label: "Claim status", type: "text", availableInTest: true },
  patient_name: { label: "Patient name", type: "text", availableInTest: true },
  preauth_or_claim_no: { label: "Claim number", type: "text", availableInTest: true },
  department: { label: "Department", type: "text", availableInTest: true },
  treatment_or_surgery: { label: "Treatment / surgery", type: "text", availableInTest: true },
  doctor_name: { label: "Doctor", type: "text", availableInTest: true },
  is_under_treatment: { label: "Is Under Treatment", type: "boolean", availableInTest: true },
  is_approved: { label: "Is Approved", type: "boolean", availableInTest: true },
  is_settled: { label: "Is Settled", type: "boolean", availableInTest: true },
  is_approved_or_settled: { label: "Is Approved or Settled", type: "boolean", availableInTest: true },
  is_rejected_or_cancelled: { label: "Is Rejected or Cancelled", type: "boolean", availableInTest: true },
  has_utr: { label: "Has a UTR", type: "boolean", availableInTest: true },
  utr_shape_invalid: { label: "UTR shape looks wrong", type: "boolean", availableInTest: true },
  settlement_date_or_amount_missing: { label: "Settlement date or amount missing", type: "boolean", availableInTest: true },
  settlement_data_present: { label: "Settlement data present", type: "boolean", availableInTest: true },
  amounts_present: { label: "Approved or settled amount present", type: "boolean", availableInTest: true },
  reason_missing_for_rejected_or_cancelled: { label: "Reason missing (Rejected / Cancelled)", type: "boolean", availableInTest: true },
  status_sources_disagree: { label: "Status sources disagree (read time only)", type: "boolean", availableInTest: false },
  status_colour_unconfirmed: { label: "Row colour unconfirmed (read time only)", type: "boolean", availableInTest: false },
  date_swap_unresolved: { label: "Day-month swap unresolved (read time only)", type: "boolean", availableInTest: false },
};

export const RULE_FIELD_KEYS = Object.keys(RULE_FIELDS);

export function isRuleField(key: string): boolean {
  return Object.hasOwn(RULE_FIELDS, key);
}
