// The Stage 2a initial rule list (requirements.md sections 11-12; decisions.md section 14,
// Anoop 31-Oct: "start fresh, about 30 rules, keep old IDs where the meaning is the same").
// One array, used to seed `rules` + `rule_versions` (see the matching migration) and by the
// engine tests, so the seed and the tests can never drift apart.
import type { CheckDefinition, RuleAction, SimpleCondition } from "./engine.ts";

export type SeedRuleType = "CHECK" | "PARAMETER";
export type SeedStatus = "ACTIVE" | "REFERENCE";

export interface SeedRule {
  ruleId: string;
  type: SeedRuleType;
  title: string;
  status: SeedStatus;
  severity?: "E" | "W";
  action?: RuleAction;
  staffMessage?: string;
  checkDefinition?: CheckDefinition;
  parameterName?: string;
  parameterValue?: string;
  /** REFERENCE rules only: why the check itself stays in code, not in the Rule Library. */
  structuralNote?: string;
}

const simple = (
  ruleId: string,
  title: string,
  severity: "E" | "W",
  issueField: string,
  logic: "AND" | "OR",
  conditions: SimpleCondition[],
  staffMessage: string,
  action: RuleAction = "ASK_STAFF",
): SeedRule => ({
  ruleId,
  type: "CHECK",
  title,
  status: "ACTIVE",
  severity,
  action,
  staffMessage,
  checkDefinition: { kind: "SIMPLE", logic, conditions, issueField },
});

export const INITIAL_RULES: SeedRule[] = [
  // --- Structural: reading-level, kept in code (engine.ts cannot express "is this cell
  // readable at all"); these still get a reference row so they are listed with a title. ---
  { ruleId: "R-C01", type: "CHECK", title: "Non-data row (separator, total or banner)", status: "REFERENCE", structuralNote: "Decided before any field is read; not a condition over cleaned values." },
  { ruleId: "R-N02", type: "CHECK", title: "Cell cannot be read (date, amount or identifier)", status: "REFERENCE", structuralNote: "A parsing failure, not a business condition." },
  { ruleId: "R-N05", type: "CHECK", title: "Negative amount in an amount field", status: "REFERENCE", structuralNote: "A parsing sanity check, applied to every amount field as it is read." },
  { ruleId: "R-D04", type: "CHECK", title: "Date in the future", status: "REFERENCE", structuralNote: "Checked while the date is parsed; an implausible date is never used as a value." },
  { ruleId: "R-D05", type: "CHECK", title: "Date before 01-Jan-2019", status: "REFERENCE", structuralNote: "Checked while the date is parsed; an implausible date is never used as a value." },
  { ruleId: "R-Y01", type: "CHECK", title: "Header layout changed", status: "REFERENCE", structuralNote: "About reading the sheet, not one claim's values; raised by the worker." },

  // --- Parameter: the TDS default rate, unchanged mechanism (selection.ts chooseParameters). ---
  { ruleId: "R-T01", type: "PARAMETER", title: "Default TDS rate 10 percent", status: "ACTIVE", parameterName: "tds_rate", parameterValue: "0.10" },

  // --- Dates ---
  simple("R-D01", "Discharge earlier than admission", "E", "discharge_date", "AND",
    [{ field: "discharge_date", operator: "BEFORE", compareField: "admission_date" }],
    "Discharge date ({discharge_date}) is before the admission date.", "AUTOMATIC"),
  simple("R-D03", "Settlement earlier than hardcopy sent or admission", "E", "payment_date", "OR",
    [
      { field: "payment_date", operator: "BEFORE", compareField: "admission_date" },
      { field: "payment_date", operator: "BEFORE", compareField: "casesheet_sent_date" },
    ],
    "Settlement date ({payment_date}) is before the admission or hardcopy sent date.", "AUTOMATIC"),
  simple("R-D06", "Day-month swap could not resolve the stay", "W", "discharge_date", "AND",
    [{ field: "date_swap_unresolved", operator: "FLAG_TRUE" }],
    "The stay is over 15 days (or negative) and swapping day and month did not fix it.", "ASK_STAFF"),
  simple("R-D07", "Hardcopy sent before discharge date", "E", "casesheet_sent_date", "AND",
    [{ field: "casesheet_sent_date", operator: "BEFORE", compareField: "discharge_date" }],
    "Hardcopy sent date ({casesheet_sent_date}) is before the discharge date.", "AUTOMATIC"),
  simple("R-W01", "Stay over 30 days", "W", "discharge_date", "AND",
    [{ field: "los_days", operator: "GREATER_THAN", compareValue: 30 }],
    "Length of stay is over 30 days: please confirm the dates are correct.", "ASK_STAFF"),

  // --- Amounts ---
  simple("R-A01", "Approved amount greater than claimed", "E", "approved_amount", "AND",
    [{ field: "approved_amount", operator: "GREATER_THAN", compareField: "claimed_amount" }],
    "Approved amount is greater than the claimed amount.", "AUTOMATIC"),
  simple("R-A02", "Claimed amount greater than bill", "W", "claimed_amount", "AND",
    [{ field: "claimed_amount", operator: "GREATER_THAN", compareField: "bill_amount" }],
    "Claimed amount is greater than the bill amount.", "AUTOMATIC"),
  simple("R-A03", "Settled amount greater than approved", "E", "settled_amount", "AND",
    [{ field: "total_settled", operator: "GREATER_THAN", compareField: "approved_amount" }],
    "Total settled is greater than the approved amount.", "AUTOMATIC"),
  simple("R-A05", "Approved amount missing for an approved or settled claim", "E", "approved_amount", "AND",
    [
      { field: "is_approved_or_settled", operator: "FLAG_TRUE" },
      { field: "approved_amount", operator: "EMPTY" },
    ],
    "Claim is Approved or Settled but has no approved amount.", "ASK_STAFF"),
  simple("R-A07", "Approved amount greater than bill", "E", "approved_amount", "AND",
    [{ field: "approved_amount", operator: "GREATER_THAN", compareField: "bill_amount" }],
    "Approved amount is greater than the bill amount.", "AUTOMATIC"),

  // --- Money rules (decisions.md section 8) ---
  simple("R-F01", "Discount differs from Bill minus Approved minus Co-pay", "W", "discount_amount", "AND",
    [
      { field: "discount_amount", operator: "NOT_EMPTY" },
      { field: "discount_amount", operator: "DIFFERS_BY_MORE_THAN", compareField: "deduction_amount", toleranceAmount: 1 },
    ],
    "The Discount you entered ({discount_amount}) differs from Bill - Approved - Co-pay ({deduction_amount}).", "ASK_STAFF"),
  simple("R-F02", "TDS empty on a paid claim", "W", "tds_amount_stated", "AND",
    [
      { field: "total_settled", operator: "NOT_EMPTY" },
      { field: "total_tds", operator: "EMPTY" },
    ],
    "A payment is recorded but TDS is blank. Expected TDS at 10% of approved is {expected_tds_amount}.", "ASK_STAFF"),
  simple("R-F03", "TDS differs from the normal rate", "W", "tds_amount_stated", "AND",
    [
      { field: "total_tds", operator: "NOT_EMPTY" },
      { field: "total_tds", operator: "DIFFERS_BY_MORE_THAN", compareField: "expected_tds_amount", toleranceAmount: 1 },
    ],
    "TDS entered ({total_tds}) differs from the normal rate's expected amount ({expected_tds_amount}).", "ASK_STAFF"),
  simple("R-F04", "Paid amount differs from the expected settlement", "W", "settled_amount", "AND",
    [
      { field: "total_settled", operator: "NOT_EMPTY" },
      { field: "total_settled", operator: "DIFFERS_BY_MORE_THAN", compareField: "expected_settlement", toleranceAmount: 1 },
    ],
    "Total settled ({total_settled}) differs from Approved minus TDS ({expected_settlement}).", "ASK_STAFF"),
  simple("R-F05", "Settled amount equal to approved amount", "E", "settled_amount", "AND",
    [
      { field: "total_settled", operator: "NOT_EMPTY" },
      { field: "total_settled", operator: "EQUALS", compareField: "approved_amount" },
    ],
    "Settled amount equals the approved amount: TDS looks like it was not deducted.", "ASK_STAFF"),
  simple("R-F06", "Balance Amount is negative", "E", "balance_amount", "AND",
    [{ field: "balance_amount", operator: "LESS_THAN", compareValue: 0 }],
    "Balance (Approved - Total TDS - Total Settled) is negative ({balance_amount}).", "AUTOMATIC"),

  // --- Names and identity ---
  simple("R-N01", "Patient name empty", "E", "patient_name", "AND",
    [{ field: "patient_name", operator: "EMPTY" }],
    "Patient name is empty.", "ASK_STAFF"),
  simple("R-N03", "Claim number missing", "E", "preauth_or_claim_no", "AND",
    [
      { field: "is_under_treatment", operator: "FLAG_FALSE" },
      { field: "preauth_or_claim_no", operator: "EMPTY" },
    ],
    "Claim number is missing (only an Under Treatment case may have none).", "ASK_STAFF"),
  {
    ruleId: "R-N04",
    type: "CHECK",
    title: "Department, procedure or doctor missing",
    status: "ACTIVE",
    severity: "W",
    action: "ASK_STAFF",
    staffMessage: "{field} is empty.",
    checkDefinition: { kind: "SIMPLE_FOR_EACH", fieldList: ["department", "treatment_or_surgery", "doctor_name"], operator: "EMPTY" },
  },

  // --- Status ---
  simple("R-S01", "Settled claim has no UTR", "E", "utr_no", "AND",
    [
      { field: "is_settled", operator: "FLAG_TRUE" },
      { field: "has_utr", operator: "FLAG_FALSE" },
    ],
    "Claim is Settled but has no UTR.", "ASK_STAFF"),
  simple("R-S02", "Settled claim missing settlement date or amount", "E", "settlement_date", "AND",
    [
      { field: "is_settled", operator: "FLAG_TRUE" },
      { field: "settlement_date_or_amount_missing", operator: "FLAG_TRUE" },
    ],
    "Claim is Settled but is missing the settlement date or the settled amount.", "ASK_STAFF"),
  simple("R-S03", "Settlement data present but status not Settled", "W", "claim_status", "AND",
    [
      { field: "is_settled", operator: "FLAG_FALSE" },
      { field: "claim_status", operator: "NOT_EQUALS", compareValue: "UNKNOWN" },
      { field: "settlement_data_present", operator: "FLAG_TRUE" },
    ],
    "A settled amount or UTR is present but the status is not Settled.", "ASK_STAFF"),
  simple("R-S04", "Approved claim missing approved amount", "E", "approved_amount", "AND",
    [
      { field: "is_approved", operator: "FLAG_TRUE" },
      { field: "approved_amount", operator: "EMPTY" },
    ],
    "Claim is Approved but has no approved amount.", "ASK_STAFF"),
  simple("R-S05", "Rejected or cancelled claim has approved or settled amount", "W", "claim_status", "AND",
    [
      { field: "is_rejected_or_cancelled", operator: "FLAG_TRUE" },
      { field: "amounts_present", operator: "FLAG_TRUE" },
    ],
    "Claim is Rejected or Cancelled but an approved or settled amount is present.", "ASK_STAFF"),
  simple("R-S06", "Claim status unknown", "E", "claim_status", "AND",
    [{ field: "claim_status", operator: "EQUALS", compareValue: "UNKNOWN" }],
    "Claim status could not be worked out from the tab, the status column or a confirmed colour.", "ASK_STAFF"),
  simple("R-S07", "Row colour has no confirmed meaning", "E", "claim_status", "AND",
    [{ field: "status_colour_unconfirmed", operator: "FLAG_TRUE" }],
    "This row's colour has no confirmed meaning for this hospital.", "ASK_STAFF"),
  simple("R-S09", "Approved claim overdue by 60 days with no payment", "W", "approved_amount", "AND",
    [
      { field: "is_approved", operator: "FLAG_TRUE" },
      { field: "total_settled", operator: "EMPTY" },
      { field: "discharge_date", operator: "BEFORE", compareValue: "TODAY", offsetDays: -60 },
    ],
    "Approved more than 60 days ago (from discharge) with no payment yet.", "ASK_STAFF"),
  simple("R-S10", "Reason missing for rejected or cancelled claim", "E", "claim_status", "AND",
    [{ field: "reason_missing_for_rejected_or_cancelled", operator: "FLAG_TRUE" }],
    "Claim is Rejected or Cancelled but has no reason.", "ASK_STAFF"),

  // --- UTR and status agreement ---
  simple("R-U01", "UTR looks implausible", "W", "utr_no", "AND",
    [{ field: "utr_shape_invalid", operator: "FLAG_TRUE" }],
    "UTR does not look like a real UTR (length or characters).", "ASK_STAFF"),
  simple("R-X01", "Status sources disagree", "W", "claim_status", "AND",
    [{ field: "status_sources_disagree", operator: "FLAG_TRUE" }],
    "The tab, status column and row colour do not all agree on the status.", "ASK_STAFF"),

  // --- Stage 2c: cross-row rules (decisions.md section 7). The comparison itself stays in
  // code (packages/worker/src/identity.ts, packages/rules/src/two-part.ts: the flat per-row
  // engine above cannot compare one row against another), the same allowed exception as
  // R-C01/R-N02 above; only severity, action and staffMessage are read from here, which the
  // reading-level REFERENCE rows above still do not do (unchanged, out of scope for 2c).
  // R-Y03 was deliberately kept ACTIVE (not retired) by the 2a migration; its wording moves
  // here now. checkDefinition stays undefined, so these never reach the engine (toEngineRule
  // in clean.ts requires one) - they exist here only so severity/action/message are data.
  {
    ruleId: "R-Y03",
    type: "CHECK",
    title: "Same patient with the same admission date under another claim number",
    status: "ACTIVE",
    severity: "W",
    action: "ASK_STAFF",
    staffMessage: "Same patient with the same admission date under another claim number.",
  },
  {
    ruleId: "R-K01",
    type: "CHECK",
    title: "Same UTR appears on more than one claim",
    status: "ACTIVE",
    severity: "W",
    action: "ASK_STAFF",
    staffMessage: "Same UTR appears on more than one claim: please confirm this is not a data entry error.",
  },
  {
    ruleId: "R-K02",
    type: "CHECK",
    title: "Claim number repeats under a different admission or discharge date",
    status: "ACTIVE",
    severity: "W",
    action: "ASK_STAFF",
    staffMessage: "Claim number {preauth_or_claim_no} repeats under a different admission or discharge date.",
  },

  // --- Stage 2c: Anoop's decisions of 1-Nov-2026 ---
  simple("R-K04", "Policy number equals phone number", "W", "policy_or_card_no", "AND",
    [{ field: "policy_or_card_no", operator: "EQUALS", compareField: "phone_number" }],
    "Policy number is the same as the phone number: please confirm this is correct.", "ASK_STAFF"),
  simple("R-K05", "Policy Holder Name empty with a claim number present", "W", "policy_holder_name", "AND",
    [
      { field: "policy_holder_name", operator: "EMPTY" },
      { field: "preauth_or_claim_no", operator: "NOT_EMPTY" },
    ],
    "Policy Holder Name is empty but a claim number is present.", "ASK_STAFF"),
  // POD Number rules run only from the hospital's POD Start Date (decisions.md section 8): with
  // no POD Start Date set, pod_start_date resolves to null, AFTER always returns false, and the
  // rule never fires - no extra code needed for "if a hospital has none yet, it does not run".
  simple("R-K06", "POD Number empty while Hardcopy Sent Date is present", "W", "courier_no", "AND",
    [
      { field: "courier_no", operator: "EMPTY" },
      { field: "casesheet_sent_date", operator: "NOT_EMPTY" },
      { field: "casesheet_sent_date", operator: "AFTER", compareField: "pod_start_date" },
    ],
    "Hardcopy was sent on {casesheet_sent_date} but no POD Number is recorded.", "ASK_STAFF"),
];
