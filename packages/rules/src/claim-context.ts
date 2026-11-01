// Rebuilds an engine.ts EngineContext from a stored (already cleaned) claims_staging row,
// for the Rule Library "test before save" job (stage-plan 2d: the draft runs "on the stored
// claims of the chosen scope, read only" -- never re-reads a hospital sheet). Pure code.
import type { EngineContext, EngineValue } from "./engine.ts";

export interface StoredClaimRow {
  record_uid: string;
  hospital_code: string;
  scheme: string;
  insurer_name: string | null;
  tpa_name: string | null;
  admission_date: string | null;
  discharge_date: string | null;
  casesheet_sent_date: string | null;
  settlement_date: string | null;
  bill_amount: string | number | null;
  claimed_amount: string | number | null;
  approved_amount: string | number | null;
  discount_amount: string | number | null;
  deduction_amount: string | number | null;
  settled_amount: string | number | null;
  tds_amount: string | number | null;
  expected_tds_amount: string | number | null;
  expected_settlement_amount: string | number | null;
  balance_amount: string | number | null;
  los_days: number | null;
  claim_status: string;
  patient_name: string | null;
  preauth_or_claim_no: string | null;
  department: string | null;
  treatment_or_surgery: string | null;
  doctor_name: string | null;
  utr_no: string[] | null;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  source_tab: string;
  source_row: number;
}

const UTR_SHAPE = /^[A-Z0-9]+$/;

function isNully(v: string | number | null | undefined): boolean {
  return v === null || v === undefined;
}

/**
 * Flags that only exist at sheet-read time (status_colour_unconfirmed, status_sources_disagree,
 * date_swap_unresolved) are always false here: a stored claim's status and dates are already
 * the resolved ones, so a rule that fires only on one of those never matches in this test --
 * a documented limit (claude/stage-plan.md 2d), not a bug.
 */
export function contextFromStoredClaim(row: StoredClaimRow, today: string): EngineContext {
  const status = row.claim_status;
  const isUnderTreatment = status === "UNDER_TREATMENT";
  const isApproved = status === "APPROVED";
  const isSettled = status === "SETTLED";
  const isRejectedOrCancelled = status === "REJECTED" || status === "CANCELLED";
  const utrs = (row.utr_no ?? []).filter((u): u is string => Boolean(u));
  const hasUtr = utrs.length > 0;
  const utrShapeInvalid = utrs.some((u) => u.length < 8 || u.length > 25 || !UTR_SHAPE.test(u));
  const settlementDateOrAmountMissing = !row.settlement_date || isNully(row.settled_amount);
  const settlementDataPresent = !isNully(row.settled_amount) || hasUtr;
  const amountsPresent = !isNully(row.approved_amount) || !isNully(row.settled_amount);
  const reasonMissing = isRejectedOrCancelled && !row.rejection_reason && !row.cancellation_reason;

  const values: Record<string, EngineValue> = {
    admission_date: row.admission_date,
    discharge_date: row.discharge_date,
    casesheet_sent_date: row.casesheet_sent_date,
    payment_date: row.settlement_date,
    bill_amount: row.bill_amount,
    claimed_amount: row.claimed_amount,
    approved_amount: row.approved_amount,
    discount_amount: row.discount_amount,
    deduction_amount: row.deduction_amount,
    total_settled: row.settled_amount,
    total_tds: row.tds_amount,
    expected_tds_amount: row.expected_tds_amount,
    expected_settlement: row.expected_settlement_amount,
    balance_amount: row.balance_amount,
    los_days: row.los_days,
    claim_status: status,
    patient_name: row.patient_name,
    preauth_or_claim_no: row.preauth_or_claim_no,
    department: row.department,
    treatment_or_surgery: row.treatment_or_surgery,
    doctor_name: row.doctor_name,
    is_under_treatment: isUnderTreatment,
    is_approved: isApproved,
    is_settled: isSettled,
    is_approved_or_settled: isApproved || isSettled,
    is_rejected_or_cancelled: isRejectedOrCancelled,
    has_utr: hasUtr,
    utr_shape_invalid: utrShapeInvalid,
    settlement_date_or_amount_missing: settlementDateOrAmountMissing,
    settlement_data_present: settlementDataPresent,
    amounts_present: amountsPresent,
    reason_missing_for_rejected_or_cancelled: reasonMissing,
    status_sources_disagree: false,
    status_colour_unconfirmed: false,
    date_swap_unresolved: false,
  };
  return { today, values };
}
