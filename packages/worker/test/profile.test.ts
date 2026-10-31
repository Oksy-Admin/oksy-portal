import { describe, expect, it } from "vitest";
import { buildHospitalProfile, type DictionaryRow } from "../src/profile.ts";

// Stage 2b: the profile is built only from CONFIRMED rows (decisions.md section 9, lane 1).
// A SUGGESTED or REJECTED row must never be applied without a person deciding it.
const facts = { tab_stage_facts: { PAID: "SETTLED" as const }, tpa_cell_may_hold_insurer: true, paid_meaning_open_tabs: ["OLD"] };

function row(over: Partial<DictionaryRow>): DictionaryRow {
  return { kind: "STATUS_WORD", scheme: "PRIVATE", hospital_code: "HOSP32P000107", spelling_key: "paid", standard_value: "SETTLED", status: "CONFIRMED", ...over };
}

describe("buildHospitalProfile", () => {
  it("applies only CONFIRMED rows, scoped to this hospital for status words and doctors", () => {
    const rows: DictionaryRow[] = [
      row({ kind: "STATUS_WORD", spelling_key: "paid", standard_value: "SETTLED", status: "CONFIRMED" }),
      row({ kind: "STATUS_WORD", spelling_key: "na", standard_value: "NOT_WRITTEN", status: "SUGGESTED" }),
      row({ kind: "STATUS_WORD", spelling_key: "settled", standard_value: "SETTLED", hospital_code: "HOSP32P000001", status: "CONFIRMED" }),
      row({ kind: "DOCTOR", spelling_key: "drrajesh", standard_value: "Dr. Rajesh", status: "CONFIRMED" }),
    ];
    const p = buildHospitalProfile("HOSP32P000107", "PRIVATE", facts, rows);
    expect(p.statusWords).toEqual({ paid: "SETTLED" });
    expect(p.doctorAliases).toEqual({ drrajesh: "Dr. Rajesh" });
  });

  it("insurer, TPA and department lists are scheme-wide (hospital_code null), not per hospital", () => {
    const rows: DictionaryRow[] = [
      { kind: "INSURER", scheme: "PRIVATE", hospital_code: null, spelling_key: "starhealth", standard_value: "Star Health", status: "CONFIRMED" },
      { kind: "TPA", scheme: "PRIVATE", hospital_code: null, spelling_key: "vidal", standard_value: "Vidal", status: "CONFIRMED" },
      { kind: "DEPARTMENT", scheme: "PRIVATE", hospital_code: null, spelling_key: "cardiology", standard_value: "Cardiology", status: "CONFIRMED" },
    ];
    const p = buildHospitalProfile("HOSP32P000003", "PRIVATE", facts, rows);
    expect(p.insurerAliases).toEqual({ starhealth: "Star Health" });
    expect(p.insurerKeys).toEqual(["starhealth"]);
    expect(p.tpaAliases).toEqual({ vidal: "Vidal" });
    expect(p.departmentAliases).toEqual({ cardiology: "Cardiology" });
  });

  it("carries the hospital's own confirmed setup facts, not a hard-coded default", () => {
    const p = buildHospitalProfile("HOSP32P000107", "PRIVATE", facts, []);
    expect(p.tabStage).toEqual({ PAID: "SETTLED" });
    expect(p.tpaCellMayHoldInsurer).toBe(true);
    expect(p.paidMeaningOpenTabs).toEqual(["OLD"]);
  });

  it("a different scheme's rows never leak in", () => {
    const rows: DictionaryRow[] = [row({ scheme: "KASP", status: "CONFIRMED" })];
    const p = buildHospitalProfile("HOSP32P000107", "PRIVATE", facts, rows);
    expect(p.statusWords).toEqual({});
  });
});
