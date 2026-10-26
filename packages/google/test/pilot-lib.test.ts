import { describe, expect, it } from "vitest";
import type { CellData } from "../src/read.ts";
import { d2Row, goldenRow, money, parseWorkbook, questionRow, returnQuestions, type OpenMatchers } from "../scripts/pilot-lib.ts";

// A FAKE answered workbook. Every name and number is invented.
const cells = (rows: string[][]): CellData[][] => rows.map((r) => r.map((v) => ({ formattedValue: v })));
const WB = new Map<string, CellData[][]>([
  ["START HERE", cells([["Welcome"]])],
  ["1 Quick check", cells([
    ["#", "Topic", "We understand that…", "✍ Correct?", "✍ If No, write here"],
    ["1", "Co-pay", "Fake statement one", "Yes", ""],
    ["6", "TDS", "Fake statement six", "Not sure", ""],
  ])],
  ["3 Fix list", cells([
    ["No.", "Tab", "Row", "Patient", "Admit date", "What is wrong", "What your sheet shows", "✍ Answer", "✍ Correct value / note"],
    ["1", "PAID", "10", "Fake Alpha", "01-Jan-2025", "Status unknown", "blank", "Value is correct", ""],
    ["2", "PAID", "11", "Fake Beta", "02-Jan-2025", "NORKA insurer does not match the policy number", "NORKA CARE 7633000000", "United India Insurance", ""],
    ["No.", "Tab", "Row", "Patient", "Admit date", "What is wrong", "What your sheet shows", "✍ Answer", "✍ Correct value / note"],
    ["4", "PAID", "13", "Fake Theta", "05-Jan-2025", "NORKA insurer does not match the policy number", "NORKA CARE 7633000001", "New India Assurance", ""],
    ["5", "PAID", "14", "Fake Iota", "06-Jan-2025", "Status unknown", "blank", "Rejected by insurer", ""],
    ["6", "PAID", "15", "Fake Kappa", "07-Jan-2025", "Copay unclear", "", "Sheet is already correct", ""],
    ["7", "PAID", "31", "Fake Zeta", "08-Jan-2025", "Paid less than approved", "", "Part payments (details →)", "two payments"],
    ["8", "OCTOBER 2026", "5", "Fake Zeta", "09-Oct-2026", "Status unknown", "", "Discharged, claim in process", ""],
    ["3", "PAID", "12", "Fake Gamma", "03-Jan-2025", "UTR missing", "", "Cannot find it", ""],
  ])],
  ["4 Bill & co-pay", cells([
    ["No.", "Tab", "Row", "Patient", "Admit date", "Insurer", "Approved", "Paid", "Number under CO-PAY in your sheet", "✍ Bill amount", "✍ Patient co-pay (if known)", "✍ Done in our sheet?"],
    ["1", "PAID", "20", "Fake Delta", "04-Jan-2024", "Fake Insurer", "1,00,000", "85,500", "", "1,20,000", "5,000", "Yes, done"],
  ])],
  ["5 Short payments", cells([
    ["No.", "Tab", "Row", "Patient", "Insurer", "Approved", "Received", "Short by", "Remark in your sheet", "✍ Is this final?"],
    ["1", "PAID", "30", "Fake Epsilon", "Fake Insurer", "100000", "85500", "5,000", "", "Final - hospital discount"],
    ["2", "PAID", "31", "Fake Zeta", "Fake Insurer", "50000", "40000", "5,000", "", "More money to come"],
    ["3", "PAID", "32", "Fake Eta", "Fake Insurer", "4549", "4459", "90", "", "Final - insurer deducted"],
  ])],
  ["6 Doctor names", cells([
    ["Name we will use", "Spellings found in your sheet", "✍ Correct?", "✍ If No, correct full name"],
    ["Dr. Fake Doctor", "Dr Fake Doc", "Yes", ""],
  ])],
]);
const M: OpenMatchers = {
  approvedVsPayment: /fake eta/i,
  tillAug2023PaidCell: /fake nobody/i,
  partPayment: /fake zeta/i,
  doctor: /fake doctor/i,
  quickCheckNotSure: ["6"],
};

describe("pilot workbook parsing", () => {
  const items = parseWorkbook(WB, M);
  const byCode = new Map(items.map((i) => [i.qCode, i]));

  it("reads every question tab and skips START HERE", () => {
    expect(items.map((i) => i.qCode).sort()).toEqual([
      "P0-T1-001", "P0-T1-006", "P0-T3-001", "P0-T3-002", "P0-T3-003", "P0-T3-004", "P0-T3-005", "P0-T3-006", "P0-T3-007", "P0-T3-008",
      "P0-T4-001", "P0-T5-001", "P0-T5-002", "P0-T5-003", "P0-T6-002",
    ]);
  });

  it("keeps money as exact decimal strings and never guesses", () => {
    expect(money("1,20,000")).toBe("120000");
    expect(money("₹ 4,549/-")).toBe("4549");
    expect(money("45k")).toBeNull();
    expect(money("")).toBeNull();
  });

  it("maps answers to outcomes and statuses", () => {
    expect(byCode.get("P0-T1-001")).toMatchObject({ outcome: "CONFIRMED", status: "ANSWERED" });
    expect(byCode.get("P0-T3-003")).toMatchObject({ outcome: "CANNOT_FIND", status: "CANNOT_FIND" });
    expect(byCode.get("P0-T4-001")).toMatchObject({ outcome: "FIXED_AT_SOURCE", status: "ANSWERED" });
    expect(byCode.get("P0-T3-005")).toMatchObject({ outcome: "VALUE_GIVEN", status: "ANSWERED" }); // status given as the answer
    expect(byCode.get("P0-T3-006")).toMatchObject({ outcome: "CONFIRMED" }); // "Sheet is already correct"
  });

  it("skips a repeated header row and keeps NORKA open only when the answer disagrees with the policy prefix", () => {
    expect(items.some((i) => i.questionText === "What is wrong")).toBe(false);
    expect(byCode.get("P0-T3-004")).toMatchObject({ open: null, status: "ANSWERED" }); // New India + 763300 agree
  });

  it("marks the OPEN items and never applies them", () => {
    expect(byCode.get("P0-T3-002")).toMatchObject({ open: "NORKA_CONFLICT", outcome: "CONFLICT", status: "CONFLICT" });
    expect(byCode.get("P0-T1-006")).toMatchObject({ open: "QUICK_CHECK_NOT_SURE", status: "RETURN_TO_HOSPITAL" });
    expect(byCode.get("P0-T5-002")).toMatchObject({ open: "PART_PAYMENT", status: "RETURN_TO_HOSPITAL" });
    // Same name, another claim with no "Part payments" answer: not a part payment.
    expect(byCode.get("P0-T3-008")).toMatchObject({ open: null, status: "ANSWERED" });
    expect(byCode.get("P0-T5-003")).toMatchObject({ open: "APPROVED_VS_PAYMENT" });
    expect(byCode.get("P0-T6-002")).toMatchObject({ open: "DOCTOR_MAPPING" });
  });

  it("question rows carry the source, and no patient name", () => {
    const q = questionRow(byCode.get("P0-T3-001")!, "fake-answer-file");
    expect(q).toMatchObject({ source_file_id: "fake-answer-file", source_tab: "3 Fix list", source_question_no: "1", tab_name: "PAID", row_number: 10 });
    expect(JSON.stringify(q)).not.toMatch(/Fake Alpha/);
  });

  it("Discount 2 proposals: every answer of tab 5 becomes PROPOSED-ready, decision from the answer", () => {
    expect(d2Row(byCode.get("P0-T5-001")!, "a1")).toMatchObject({ decision: "ELIGIBLE", discount_2_amount: "5000", tab_name: "PAID", row_number: 30 });
    expect(d2Row(byCode.get("P0-T5-002")!, "a2")).toMatchObject({ decision: "NOT_ELIGIBLE" });
    expect(d2Row(byCode.get("P0-T5-003")!, "a3")).toMatchObject({ decision: "ELIGIBLE" });
    expect(Object.keys(d2Row(byCode.get("P0-T5-001")!, "a1")!)).not.toContain("status");
  });

  it("Golden Tests only from confirmed, non-OPEN rows", () => {
    expect(goldenRow(byCode.get("P0-T5-001")!, "a")).toMatchObject({ case_code: "GT1-D2-001", expected: { discount_2_amount: "5000", discount_2_decision: "ELIGIBLE" } });
    expect(goldenRow(byCode.get("P0-T4-001")!, "a")).toMatchObject({ expected: { bill_amount: "120000", copay_amount: "5000" } });
    expect(goldenRow(byCode.get("P0-T3-001")!, "a")).toMatchObject({ case_code: "GT1-FX-001" });
    expect(goldenRow(byCode.get("P0-T5-002")!, "a")).toBeNull(); // OPEN part payment
    expect(goldenRow(byCode.get("P0-T5-003")!, "a")).toBeNull(); // OPEN approved vs payment
    expect(goldenRow(byCode.get("P0-T3-002")!, "a")).toBeNull(); // NORKA conflict
    expect(goldenRow(byCode.get("P0-T3-003")!, "a")).toBeNull(); // cannot find
  });

  it("return-to-hospital questions: one per OPEN item, tab-level where Anoop said so", () => {
    const r = returnQuestions(items);
    expect(r.map((q) => q.q_code)).toEqual(["A-0001", "U-0001", "M-0001", "R-0001"]);
    expect(JSON.stringify(r)).not.toMatch(/Fake (Eta|Zeta)/);
  });
});
