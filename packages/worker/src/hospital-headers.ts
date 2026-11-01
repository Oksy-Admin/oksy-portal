// HMS Kottakkal header fallback (Stage 1b, decisions.md section 5): headers that are only
// safe because the hospital confirmed their meaning (25-Oct pilot answers, P0-T1-003, 004,
// 005, 008, 014). header_decisions (Stage 1b-i) is the real, per-hospital decision; this is
// only the first-contact guess layoutOf() offers before any decision exists. Column-mapping
// concern, not Stage 2b's dictionaries (status words, colours, doctor/insurer/TPA/department
// names) — kept separately from profile.ts for that reason.
import type { CanonicalField } from "@oksy/rules";

export const HMS_CODE = "HOSP32P000107";
export const HMS_SHEET = "1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ";

export const HMS_HEADERS: Record<string, CanonicalField> = {
  "BILL AMOUNT": "bill_amount",
  "FINAL APPROVED AMOUNT": "approved_amount",
  "CO-PAY": "copay_amount",
  "PAID AMOUNT": "payment_amount",
  "POD NUMBER": "courier_no",
  STATUS: "status_text",
};
