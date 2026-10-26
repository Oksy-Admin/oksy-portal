// Phase 0b: turn the answered HMS pilot workbook into questions, answers, Discount 2
// proposals, Golden Tests and return-to-hospital questions. Pure functions (no Google, no
// database), so they are tested with fake rows. Money stays as decimal strings (hard rule 7).
// Nothing here is printed: patient names are used only to find the OPEN rows Anoop named.
import type { CellData } from "../src/read.ts";

export const HMS_PRIVATE = "1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ";
export const HOSPITAL = "HOSP32P000107";

export type QType = "C" | "N" | "R" | "M" | "S" | "U" | "A" | "D" | "P" | "E";
export type Outcome = "CONFIRMED" | "FIXED_AT_SOURCE" | "VALUE_GIVEN" | "CANNOT_FIND" | "CONFLICT" | "UNCLEAR";
export type QStatus = "QUEUED" | "SHOWN" | "ANSWERED" | "CANNOT_FIND" | "CONFLICT" | "RETURN_TO_HOSPITAL";

/** The OPEN items Anoop named on 25-Oct, by label (no names). */
export type OpenLabel =
  | "APPROVED_VS_PAYMENT"
  | "TILL_AUG_2023_PAID_CELL"
  | "PART_PAYMENT"
  | "DOCTOR_MAPPING"
  | "QUICK_CHECK_NOT_SURE"
  | "NORKA_CONFLICT";

/** How to find those rows. Held in the script only, never printed or stored. */
export interface OpenMatchers {
  approvedVsPayment: RegExp; // patient name of the approved 4549 vs payment 4459 row
  tillAug2023PaidCell: RegExp; // patient names whose TILL AUG 2023 paid cell is unclear
  partPayment: RegExp; // patient names with part payments
  doctor: RegExp; // the doctor name to map
  quickCheckNotSure: string[]; // Quick check question numbers marked "Not sure"
}

export interface PilotItem {
  tabNo: number;
  sourceTab: string;
  sourceRow: number; // 1-based row in the answer workbook
  questionNo: string;
  qCode: string;
  qType: QType;
  scope: "ROW" | "TAB" | "HOSPITAL";
  hmsTab: string | null;
  hmsRow: number | null;
  fieldName: string | null;
  questionText: string;
  answerValue: string | null;
  typedValue: string | null;
  note: string | null;
  outcome: Outcome | null; // null = not answered
  status: QStatus;
  open: OpenLabel | null;
  money: Record<string, string | null>; // decimal strings from the workbook's copy of the sheet
  extra: Record<string, string>; // other short fields for Golden Tests (insurer, remark)
}

const norm = (s: string) => s.replace(/✍/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** "1,23,456.50", "₹ 4,549/-" -> "123456.50" / "4549"; anything else -> null (never guessed). */
export function money(text: string | undefined | null): string | null {
  if (text == null) return null;
  const t = text.replace(/₹|rs\.?|inr|\/-|,|\s/gi, "");
  return /^-?\d+(\.\d{1,2})?$/.test(t) ? t : null;
}

function col(header: string[], ...names: string[]): number {
  const h = header.map(norm);
  for (const n of names) {
    const i = h.findIndex((x) => x === norm(n) || x.startsWith(norm(n)));
    if (i >= 0) return i;
  }
  return -1;
}

export function outcomeOf(tabNo: number, answer: string, typed: string | null): Outcome {
  const a = norm(answer);
  if (/cannot find|can't find|not available|not found/.test(a)) return "CANNOT_FIND";
  if (/not sure|don't know|dont know|unsure/.test(a)) return "UNCLEAR";
  if (tabNo === 5 && /^final|more money/.test(a)) return "CONFIRMED";
  if (/fixed|done|corrected|updated|typed in our sheet/.test(a)) return "FIXED_AT_SOURCE";
  if (/^yes\b|^correct|value is correct|already correct|^ok\b/.test(a)) return "CONFIRMED";
  if (/^no\b/.test(a)) return typed ? "VALUE_GIVEN" : "UNCLEAR";
  if (/^other\b/.test(a)) return typed ? "VALUE_GIVEN" : "UNCLEAR";
  // In the Fix list a dropdown choice such as a status or an insurer IS the value given.
  if (tabNo === 3 && a) return "VALUE_GIVEN";
  return typed ? "VALUE_GIVEN" : "UNCLEAR";
}

/** NORKA policy prefixes (file 11): 763300 = New India, 100204 = United India. */
export function norkaAgrees(answer: string, sheetShows: string): boolean | null {
  const insurer = /new india/i.test(answer) ? "NI" : /united india/i.test(answer) ? "UI" : null;
  const prefix = /763300/.test(sheetShows) ? "NI" : /100204/.test(sheetShows) ? "UI" : null;
  if (!insurer || !prefix) return null; // cannot tell: stays a conflict
  return insurer === prefix;
}

function typeForFix(whatWrong: string): QType {
  const w = norm(whatWrong);
  if (/duplicate|same case/.test(w)) return "P";
  if (/date|admission|discharge|\blos\b/.test(w)) return "D";
  if (/utr|payment|paid|settle/.test(w)) return "U";
  if (/status|stage|colou?r/.test(w)) return "S";
  if (/insurer|tpa|norka|policy|scheme/.test(w)) return "M";
  return "A";
}

function rowOpenLabel(m: OpenMatchers, tabNo: number, patient: string, hmsTab: string | null): OpenLabel | null {
  if (!patient) return null;
  if (m.approvedVsPayment.test(patient)) return "APPROVED_VS_PAYMENT";
  if (m.partPayment.test(patient)) return "PART_PAYMENT";
  if (m.tillAug2023PaidCell.test(patient) && (hmsTab ?? "").toUpperCase() === "TILL AUG 2023") return "TILL_AUG_2023_PAID_CELL";
  if (tabNo === 3 && m.tillAug2023PaidCell.test(patient)) return "TILL_AUG_2023_PAID_CELL";
  return null;
}

function statusFor(outcome: Outcome | null, open: OpenLabel | null): QStatus {
  if (open === "NORKA_CONFLICT") return "CONFLICT";
  if (open) return "RETURN_TO_HOSPITAL";
  if (outcome === null) return "SHOWN";
  if (outcome === "CANNOT_FIND") return "CANNOT_FIND";
  if (outcome === "UNCLEAR") return "RETURN_TO_HOSPITAL";
  return "ANSWERED";
}

export function parseWorkbook(tabs: Map<string, CellData[][]>, matchers: OpenMatchers): PilotItem[] {
  const items: PilotItem[] = [];
  for (const [title, rows] of tabs) {
    const m = /^(\d+)\s/.exec(title);
    if (!m) continue; // START HERE and other non-question tabs
    const tabNo = Number(m[1]);
    const cells = rows.map((r) => r.map((c) => (c.formattedValue ?? "").trim()));
    const headerIdx = cells.findIndex((r) => r.filter((v) => v !== "").length >= 3);
    if (headerIdx < 0) continue;
    const header = cells[headerIdx] ?? [];
    const c = {
      no: col(header, "#", "No."),
      tab: col(header, "Tab"),
      row: col(header, "Row"),
      patient: col(header, "Patient"),
      topic: col(header, "Topic"),
      understand: col(header, "We understand"),
      colour: col(header, "Colour"),
      correct: col(header, "Correct?"),
      ifNo: col(header, "If No"),
      wrong: col(header, "What is wrong"),
      shows: col(header, "What your sheet shows"),
      answer: col(header, "Answer"),
      correctValue: col(header, "Correct value"),
      insurer: col(header, "Insurer"),
      approved: col(header, "Approved"),
      paid: col(header, "Paid"),
      received: col(header, "Received"),
      shortBy: col(header, "Short by"),
      remark: col(header, "Remark in your sheet"),
      copayCell: col(header, "Number under CO-PAY"),
      bill: col(header, "Bill amount"),
      patientCopay: col(header, "Patient co-pay"),
      doneInSheet: col(header, "Done in our sheet"),
      isFinal: col(header, "Is this final"),
      nameWeUse: col(header, "Name we will use"),
      spellings: col(header, "Spellings found"),
    };
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

    cells.forEach((r, idx) => {
      if (idx <= headerIdx || r.every((v) => v === "")) return;
      // A repeated header row inside the tab is not a question.
      if (r.some((v, i) => v !== "" && norm(v) === norm(header[i] ?? "") && /[a-z]/.test(norm(v)))) return;
      const sourceRow = idx + 1;
      const questionNo = get(r, c.no) || String(sourceRow);
      const hmsTab = get(r, c.tab) || null;
      const n = Number(get(r, c.row));
      const hmsRow = Number.isInteger(n) && n > 0 ? n : null;
      const patient = get(r, c.patient);
      const it: Omit<PilotItem, "qCode" | "outcome" | "status"> = {
        tabNo,
        sourceTab: title,
        sourceRow,
        questionNo,
        qType: "A",
        scope: hmsTab && hmsRow ? "ROW" : "HOSPITAL",
        hmsTab,
        hmsRow,
        fieldName: null,
        questionText: "",
        answerValue: null,
        typedValue: null,
        note: null,
        open: null,
        money: {},
        extra: {},
      };
      let answer = "";
      switch (tabNo) {
        case 1:
          it.qType = "R";
          it.scope = "HOSPITAL";
          it.questionText = [get(r, c.topic), get(r, c.understand)].filter(Boolean).join(": ");
          answer = get(r, c.correct);
          it.typedValue = get(r, c.ifNo) || null;
          if (matchers.quickCheckNotSure.includes(questionNo) && /not sure/i.test(answer)) it.open = "QUICK_CHECK_NOT_SURE";
          break;
        case 2:
          it.qType = "C";
          it.scope = "HOSPITAL";
          it.questionText = [get(r, c.colour), get(r, c.understand)].filter(Boolean).join(": ");
          answer = get(r, c.correct);
          it.typedValue = get(r, c.ifNo) || null;
          break;
        case 3: {
          const wrong = get(r, c.wrong);
          it.qType = typeForFix(wrong);
          it.questionText = wrong;
          answer = get(r, c.answer);
          it.typedValue = get(r, c.correctValue) || null;
          it.extra.sheet_shows = get(r, c.shows);
          if (/norka/i.test(wrong) && norkaAgrees(get(r, c.answer), it.extra.sheet_shows) !== true) it.open = "NORKA_CONFLICT";
          break;
        }
        case 4:
          it.fieldName = "bill_amount";
          it.questionText = "Bill amount and patient co-pay for this claim";
          answer = get(r, c.doneInSheet);
          it.typedValue = get(r, c.bill) || null;
          it.note = get(r, c.patientCopay) ? `patient co-pay: ${get(r, c.patientCopay)}` : null;
          it.money = {
            approved: money(get(r, c.approved)),
            paid: money(get(r, c.paid)),
            copay_cell: money(get(r, c.copayCell)),
            bill_amount: money(get(r, c.bill)),
            patient_copay: money(get(r, c.patientCopay)),
          };
          it.extra.insurer = get(r, c.insurer);
          break;
        case 5:
          it.qType = "E";
          it.fieldName = "discount_2";
          it.questionText = `Short by ${get(r, c.shortBy)}: is this final?`;
          answer = get(r, c.isFinal);
          it.money = { approved: money(get(r, c.approved)), received: money(get(r, c.received)), short_by: money(get(r, c.shortBy)) };
          it.extra.insurer = get(r, c.insurer);
          it.extra.remark = get(r, c.remark);
          break;
        case 6:
          it.qType = "M";
          it.scope = "HOSPITAL";
          it.fieldName = "doctor_name";
          it.questionText = `Doctor name "${get(r, c.nameWeUse)}" for the spellings: ${get(r, c.spellings)}`;
          answer = get(r, c.correct);
          it.typedValue = get(r, c.ifNo) || null;
          if (matchers.doctor.test(get(r, c.nameWeUse)) || matchers.doctor.test(get(r, c.spellings))) it.open = "DOCTOR_MAPPING";
          break;
        default:
          return;
      }
      it.open ??= rowOpenLabel(matchers, tabNo, patient, hmsTab);
      it.answerValue = answer || null;
      const outcome = answer || it.typedValue ? outcomeOf(tabNo, answer, it.typedValue) : null;
      const final = it.open === "NORKA_CONFLICT" && outcome ? "CONFLICT" : outcome;
      items.push({
        ...it,
        qCode: `P0-T${tabNo}-${questionNo.padStart(3, "0")}`,
        outcome: final,
        status: statusFor(final, it.open),
      });
    });
  }
  // A part-payment name match counts only for a claim where staff answered "Part payments"
  // (the same name can belong to another patient).
  const partClaims = new Set(items.filter((i) => i.tabNo === 3 && /part payment/i.test(i.answerValue ?? "")).map((i) => `${i.hmsTab}|${i.hmsRow}`));
  for (const i of items) {
    if (i.open === "PART_PAYMENT" && !partClaims.has(`${i.hmsTab}|${i.hmsRow}`)) {
      i.open = null;
      i.status = statusFor(i.outcome, null);
    }
  }
  return items;
}

// ----------------------------------------------------------------------------------
// Rows for the database (migration 0005). Built from items; the script only sends them.
// ----------------------------------------------------------------------------------

export function questionRow(it: PilotItem, sourceFileId: string) {
  return {
    q_code: it.qCode,
    hospital_code: HOSPITAL,
    question_type: it.qType,
    status: it.status,
    origin: "PILOT_2026_10",
    spreadsheet_id: it.scope === "ROW" ? HMS_PRIVATE : null,
    tab_name: it.scope === "ROW" ? it.hmsTab : null,
    row_number: it.scope === "ROW" ? it.hmsRow : null,
    record_key: null,
    field_name: it.fieldName,
    scope: it.scope,
    question_text: it.questionText,
    source_file_id: sourceFileId,
    source_tab: it.sourceTab,
    source_question_no: it.questionNo,
    closed_reason: it.status === "RETURN_TO_HOSPITAL" ? "returned to hospital (25-Oct)" : it.status === "CONFLICT" ? "kept open until the end of the HMS clean" : null,
  };
}

export function answerRow(it: PilotItem, questionId: string, sourceFileId: string) {
  return {
    question_id: questionId,
    channel: "PILOT_WORKBOOK",
    answer_value: it.answerValue,
    typed_value: it.typedValue,
    note: it.note,
    answered_by_name: null,
    answered_on: null,
    outcome: it.outcome,
    source_file_id: sourceFileId,
    source_tab: it.sourceTab,
    source_row: it.sourceRow,
  };
}

export function d2Decision(answer: string | null): "ELIGIBLE" | "NOT_ELIGIBLE" | null {
  const a = norm(answer ?? "");
  if (/^final - hospital discount|^final - insurer deducted/.test(a)) return "ELIGIBLE";
  if (/^more money to come/.test(a)) return "NOT_ELIGIBLE";
  return null;
}

export function d2Row(it: PilotItem, answerId: string) {
  const decision = d2Decision(it.answerValue);
  if (it.tabNo !== 5 || !decision || !it.hmsTab || !it.hmsRow) return null;
  const amount = it.money.short_by;
  return {
    hospital_code: HOSPITAL,
    spreadsheet_id: HMS_PRIVATE,
    tab_name: it.hmsTab,
    row_number: it.hmsRow,
    discount_2_amount: amount && Number(amount) > 0 ? amount : null,
    decision,
    reason: `Staff answer in the pilot workbook: "${it.answerValue}"`,
    answer_id: answerId,
  };
}

/** Golden Test v1: only rows staff confirmed, never an OPEN, unclear or conflicting one. */
export function goldenRow(it: PilotItem, answerId: string) {
  if (it.open || !it.hmsTab || !it.hmsRow) return null;
  const base = { golden_set: "v1", hospital_code: HOSPITAL, spreadsheet_id: HMS_PRIVATE, tab_name: it.hmsTab, row_number: it.hmsRow, confirmed_from: "STAFF_ANSWER", answer_id: answerId, expected_rule_hits: [] as string[] };
  if (it.tabNo === 5 && it.outcome === "CONFIRMED" && d2Decision(it.answerValue) && it.money.short_by) {
    return {
      ...base,
      case_code: `GT1-D2-${it.questionNo.padStart(3, "0")}`,
      raw_input: { insurer: it.extra.insurer, approved: it.money.approved, received: it.money.received },
      expected: { discount_2_amount: it.money.short_by, discount_2_decision: d2Decision(it.answerValue) },
    };
  }
  if (it.tabNo === 4 && (it.outcome === "FIXED_AT_SOURCE" || it.outcome === "VALUE_GIVEN" || it.outcome === "CONFIRMED") && it.money.bill_amount) {
    return {
      ...base,
      case_code: `GT1-BC-${it.questionNo.padStart(3, "0")}`,
      raw_input: { insurer: it.extra.insurer, approved: it.money.approved, paid: it.money.paid, copay_cell: it.money.copay_cell },
      expected: { bill_amount: it.money.bill_amount, copay_amount: it.money.patient_copay },
    };
  }
  if (it.tabNo === 3 && it.outcome === "CONFIRMED") {
    return {
      ...base,
      case_code: `GT1-FX-${it.questionNo.padStart(3, "0")}`,
      raw_input: { issue: it.questionText, sheet_shows: it.extra.sheet_shows },
      expected: { value_is_correct: true },
    };
  }
  return null;
}

export interface ReturnQuestion {
  q_code: string;
  question_type: QType;
  scope: "ROW" | "TAB" | "HOSPITAL";
  tab_name: string | null;
  row_number: number | null;
  field_name: string | null;
  question_text: string;
}

/** Return-to-hospital questions for the HMS Question Sheet (QUEUED; at most 25 shown, D-052). */
export function returnQuestions(items: PilotItem[]): ReturnQuestion[] {
  const out: ReturnQuestion[] = [];
  const row = (it: PilotItem) => ({ scope: "ROW" as const, tab_name: it.hmsTab, row_number: it.hmsRow });
  for (const it of items.filter((i) => i.open === "APPROVED_VS_PAYMENT" && i.hmsRow).slice(0, 1)) {
    out.push({ q_code: "A-0001", question_type: "A", ...row(it), field_name: "approved_amount",
      question_text: "Approved amount is 4549 but the payment is 4459. Please check both in your sheet." });
  }
  if (items.some((i) => i.open === "TILL_AUG_2023_PAID_CELL")) {
    out.push({ q_code: "N-0001", question_type: "N", scope: "TAB", tab_name: "TILL AUG 2023", row_number: null, field_name: "settled_amount",
      question_text: "In tab TILL AUG 2023, is the paid amount the amount before TDS (gross) or the amount received in the bank (net)?" });
  }
  const parts = items.filter((i) => i.open === "PART_PAYMENT" && i.hmsRow);
  const seen = new Set<string>();
  for (const it of parts) {
    const k = `${it.hmsTab}|${it.hmsRow}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ q_code: `U-${String(seen.size).padStart(4, "0")}`, question_type: "U", ...row(it), field_name: "payments",
      question_text: "This claim was paid in parts. Please write each payment in your sheet: amount, date and UTR." });
  }
  if (items.some((i) => i.open === "DOCTOR_MAPPING")) {
    out.push({ q_code: "M-0001", question_type: "M", scope: "HOSPITAL", tab_name: null, row_number: null, field_name: "doctor_name",
      question_text: "Are Dr. Jaseem Abdulla and Dr. Jaseem Shamsudheen the same doctor?" });
  }
  items
    .filter((i) => i.open === "QUICK_CHECK_NOT_SURE")
    .forEach((it, k) =>
      out.push({ q_code: `R-${String(k + 1).padStart(4, "0")}`, question_type: "R", scope: "HOSPITAL", tab_name: null, row_number: null, field_name: null,
        question_text: it.questionText }),
    );
  return out;
}
