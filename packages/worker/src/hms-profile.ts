// HMS Kottakkal (HOSP32P000107, PRIVATE) facts confirmed by the hospital in the 25-Oct
// answers (pilot workbook, stored in questions/answers). Each fact names its question.
// Only CONFIRMED answers are used; "Not sure" (P0-T1-006, 010, 011, 017, 018), NORKA
// conflict rows, one doctor-name pair (P0-T6-009, 014) and the TILL AUG 2023 paid meaning (N-0001)
// stay open (step h, file 00 section 2). No patient data in this file.
import { nameKey, type CanonicalField, type ColourMeaning, type HospitalProfile } from "@oksy/rules";

export const HMS_CODE = "HOSP32P000107";
export const HMS_SHEET = "1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ";

/**
 * Doctor name aliases from the stored answers (P0-T6, CONFIRMED only; the Jaseem rows are
 * RETURN_TO_HOSPITAL and are left out). Read from the database at run time so no names sit
 * in Git. Question text form: Doctor name "Std" for the spellings: a; b; c
 */
export function doctorAliasesFrom(questions: Array<{ question_text: string; status: string; confirmed: boolean }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    if (q.status !== "ANSWERED" || !q.confirmed) continue;
    const m = q.question_text.match(/^Doctor name "([^"?]+)" for the spellings: (.+)$/);
    if (!m || !m[1] || !m[2]) continue;
    const std = m[1].trim();
    for (const sp of [std, ...m[2].split(";")]) out[nameKey(sp.trim())] = std;
  }
  return out;
}

/**
 * HMS headers that are only safe because the hospital confirmed their meaning
 * (P0-T1-003, 004, 005, 008, 014). "STATUS" is mapped for HMS only: its words are confirmed
 * (P0-T2-015 to 017). Filled in after the first header read if names differ.
 */
export const HMS_HEADERS: Record<string, CanonicalField> = {
  "BILL AMOUNT": "bill_amount",
  "FINAL APPROVED AMOUNT": "approved_amount",
  "CO-PAY": "copay_amount",
  "PAID AMOUNT": "payment_amount",
  "POD NUMBER": "courier_no",
  STATUS: "status_text",
};

export function hmsProfile(legend: Record<string, ColourMeaning>, doctorAliases: Record<string, string>): HospitalProfile {
  return {
    hospitalCode: HMS_CODE,
    scheme: "PRIVATE",
    // P0-T2-012: every row in the PAID tab is paid, even with no colour.
    tabStage: { PAID: "SETTLED" },
    // P0-T2-015 to 017.
    statusWords: {
      paid: "SETTLED",
      settled: "SETTLED",
      setteled: "SETTLED",
      fullypaid: "SETTLED",
      claimapproved: "APPROVED",
      settelmentapproved: "APPROVED",
      settlementapproved: "APPROVED",
      na: "NOT_WRITTEN",
      "0": "NOT_WRITTEN",
    },
    // P0-T2-002 to 007 (meanings) with the fills of the COLOURS tab; empty while that tab is not ALLOW.
    colourLegend: legend,
    // P0-T6-002 to 019 (doctorAliasesFrom).
    doctorAliases,
    // P0-T1-015.
    tpaCellMayHoldInsurer: true,
    insurerKeys: ["star", "newindia", "unitedindia", "national", "oriental", "iffco", "icici", "hdfc", "bajaj", "careh", "niva", "aditya", "manipal", "sbigeneral", "tata", "reliance", "royal", "chola", "universalsompo", "liberty", "futuregenerali", "kotak", "galaxy", "magma", "zuno", "acko", "digit"],
    // N-0001 (queued): is the TILL AUG 2023 paid cell gross or net? No Discount 2 until answered.
    paidMeaningOpenTabs: ["TILL AUG 2023"],
  };
}

export function defaultProfile(
  hospitalCode: string,
  scheme: string,
  legend: Record<string, ColourMeaning> = {},
  doctorAliases: Record<string, string> = {}
): HospitalProfile {
  return {
    hospitalCode,
    scheme,
    tabStage: {},
    statusWords: {
      paid: "SETTLED",
      settled: "SETTLED",
      setteled: "SETTLED",
      fullypaid: "SETTLED",
      claimapproved: "APPROVED",
      settelmentapproved: "APPROVED",
      settlementapproved: "APPROVED",
      na: "NOT_WRITTEN",
      "0": "NOT_WRITTEN",
    },
    colourLegend: legend,
    doctorAliases,
    tpaCellMayHoldInsurer: true,
    insurerKeys: [
      "star", "newindia", "unitedindia", "national", "oriental", "iffco", "icici", "hdfc", "bajaj",
      "careh", "niva", "aditya", "manipal", "sbigeneral", "tata", "reliance", "royal", "chola",
      "universalsompo", "liberty", "futuregenerali", "kotak", "galaxy", "magma", "zuno", "acko", "digit",
    ],
    paidMeaningOpenTabs: [],
  };
}

