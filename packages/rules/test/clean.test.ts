import { describe, expect, it } from "vitest";
import { cleanRow, findHeaderRow, headerFingerprint, mapHeaders, type HospitalProfile, type SourceRow } from "../src/index.ts";

// Fake hospital, fake rows. The worked example of file 01 section 7 runs through the whole
// row cleaner, not only the money helper.
const TODAY = "2026-10-26";
const profile: HospitalProfile = {
  hospitalCode: "HOSP32P900001",
  scheme: "PRIVATE",
  tabStage: { PAID: "SETTLED" },
  statusWords: { paid: "SETTLED", settled: "SETTLED", claimapproved: "APPROVED", na: "NOT_WRITTEN" },
  colourLegend: { "#ff9900": "PAID", "#00ff00": "CLAIM_SUBMITTED", "#ff0000": "REJECTED_OR_CANCELLED" },
  doctorAliases: { drfakedoctor: "Dr. Fake Doctor" },
  tpaCellMayHoldInsurer: true,
  insurerKeys: ["fakeinsurance"],
  paidMeaningOpenTabs: ["OLD"],
};
const c = (text: string) => ({ text });

function row(over: Partial<SourceRow> = {}, cells: SourceRow["cells"] = {}): SourceRow {
  return {
    tab: "PAID",
    row: 5,
    extra: {},
    rowColour: null,
    cells: {
      patient_name: c("Fake Patient"),
      preauth_or_claim_no: c("clm 001"),
      admission_date: c("01/08/2026"),
      discharge_date: c("05/08/2026"),
      insurer_name: c("Fake Insurance Co"),
      department: c("Ortho"),
      treatment_or_surgery: c("Fake procedure"),
      doctor_name: c("Dr Fake Doctor"),
      bill_amount: c("1,20,000"),
      approved_amount: c("100000"),
      copay_amount: c("5000"),
      payment_amount: c("85500"),
      payment_date: c("10/09/2026"),
      payment_utr: c("FAKEUTR00001"),
      ...cells,
    },
    ...over,
  };
}

describe("worked example in the stored row values", () => {
  const r = cleanRow(profile, row(), { today: TODAY, dateOrder: "DMY" });
  it("Discount 1 15000, gross 95000, TDS 9500, Discount 2 5000, source DEFAULT (R-T01)", () => {
    expect(r.claim).toMatchObject({
      bill_amount: "120000",
      approved_amount: "100000",
      copay_amount: "5000",
      settled_amount: "85500.00",
      discount_1_amount: "15000.00",
      gross_amount: "95000.00",
      tds_amount: "9500.00",
      discount_2_amount: "5000.00",
      discount_2_pct: "5.00",
      tds_rate_source: "DEFAULT",
      tds_rule_id: "R-T01",
      discount_2_resolution: "OPEN",
      claim_status: "SETTLED",
      status_source: "tab",
    });
  });
  it("one payment, record key from the claim no, doctor name standardised (tier B = AUTO_FIXED)", () => {
    expect(r.payments).toHaveLength(1);
    expect(r.recordKey).toBe("HOSP32P900001|PRIVATE|C:CLM001");
    expect(r.claim?.doctor_name).toBe("Dr. Fake Doctor");
    expect(r.changes.map((x) => x.ruleId)).toEqual(["M-ALIAS-DOCTOR"]);
    expect(r.rowClass).toBe("AUTO_FIXED");
  });
});

describe("classification", () => {
  it("a complete row with nothing changed is CLEAN", () => {
    const r = cleanRow(profile, row({}, { doctor_name: c("Dr. Fake Doctor") }), { today: TODAY, dateOrder: "DMY" });
    expect(r.rowClass).toBe("CLEAN");
    expect(r.issues.filter((i) => !i.shadow)).toEqual([]);
  });
  it("settled without a UTR needs staff input (R-S01)", () => {
    const r = cleanRow(profile, row({}, { payment_utr: c("") }), { today: TODAY, dateOrder: "DMY" });
    expect(r.rowClass).toBe("NEEDS_STAFF_INPUT");
    expect(r.issues.map((i) => i.ruleId)).toContain("R-S01");
  });
  it("a PROPOSED rule never changes the class (shadow)", () => {
    const r = cleanRow(profile, row({}, { doctor_name: c("Dr. Fake Doctor"), approved_amount: c("130000"), payment_amount: c("117000") }), {
      today: TODAY,
      dateOrder: "DMY",
    });
    expect(r.issues.find((i) => i.ruleId === "R-A07")?.shadow).toBe(true);
    expect(r.rowClass).toBe("CLEAN");
  });
  it("a row without patient, claim no or admission date is a NON_DATA_ROW (R-C01)", () => {
    const r = cleanRow(profile, row({}, { patient_name: c(""), preauth_or_claim_no: c(""), admission_date: c("") }), {
      today: TODAY,
      dateOrder: "DMY",
    });
    expect(r.rowClass).toBe("NON_DATA_ROW");
    expect(r.claim).toBeNull();
  });
});

describe("rows without an identity", () => {
  it("are kept under their row reference and need staff input (never dropped)", () => {
    const r = cleanRow(profile, row({ tab: "PENDING", row: 9 }, { preauth_or_claim_no: c(""), patient_name: c("") }), { today: TODAY, dateOrder: "DMY" });
    expect(r.recordKey).toBe("HOSP32P900001|PRIVATE|ROW:PENDING#9");
    expect(r.rowClass).toBe("NEEDS_STAFF_INPUT");
  });
});

describe("status", () => {
  const opts = { today: TODAY, dateOrder: "DMY" as const };
  it("outside the PAID tab: a confirmed status word decides", () => {
    const r = cleanRow(profile, row({ tab: "PENDING" }, { status_text: c("Claim Approved"), payment_amount: c(""), payment_utr: c(""), payment_date: c("") }), opts);
    expect(r.claim).toMatchObject({ claim_status: "APPROVED", status_source: "column" });
  });
  it("a colour with a confirmed meaning sets the stage; green with an approved amount = APPROVED", () => {
    const r = cleanRow(profile, row({ tab: "PENDING", rowColour: "#00ff00" }, { payment_amount: c(""), payment_utr: c(""), payment_date: c("") }), opts);
    expect(r.claim).toMatchObject({ claim_status: "APPROVED", status_source: "colour" });
  });
  it("an unconfirmed colour is UNKNOWN with R-S07; red alone is asked (R-S06)", () => {
    const a = cleanRow(profile, row({ tab: "PENDING", rowColour: "#123456" }), opts);
    expect(a.claim?.claim_status).toBe("UNKNOWN");
    expect(a.issues.map((i) => i.ruleId)).toContain("R-S07");
    const b = cleanRow(profile, row({ tab: "PENDING", rowColour: "#ff0000" }), opts);
    expect(b.issues.map((i) => i.ruleId)).toContain("R-S06");
  });
});

describe("payments, TPA and open questions", () => {
  const opts = { today: TODAY, dateOrder: "DMY" as const };
  it("two UTRs in one cell: ONE payment holding the total, flag AMOUNT_SPLIT_UNKNOWN, never split", () => {
    const r = cleanRow(profile, row({}, { payment_utr: c("FAKEUTR00001, FAKEUTR00002") }), opts);
    expect(r.payments).toHaveLength(1);
    expect(r.payments[0]).toMatchObject({ amountReceived: "85500", utrNo: ["FAKEUTR00001", "FAKEUTR00002"], flags: ["AMOUNT_SPLIT_UNKNOWN"] });
  });
  it("an insurer name in the TPA cell means no separate TPA (confirmed)", () => {
    const r = cleanRow(profile, row({}, { insurer_name: c(""), tpa_name: c("FAKE INSURANCE CO") }), opts);
    expect(r.claim).toMatchObject({ insurer_name: "FAKE INSURANCE CO", tpa_name: null });
    expect(r.nullReasons.tpa_name).toBe("NO_SEPARATE_TPA");
  });
  it("a tab whose paid meaning is an open question gets no Discount 2", () => {
    const r = cleanRow(profile, row({ tab: "OLD" }, { status_text: c("PAID") }), opts);
    expect(r.claim?.discount_2_amount).toBeNull();
    expect(r.nullReasons.discount_2_amount).toBe("OPEN_QUESTION");
    expect(r.claim?.discount_1_amount).toBe("15000.00");
  });
  it("a cell that cannot be read keeps its original text in extra_fields", () => {
    const r = cleanRow(profile, row({}, { casesheet_sent_date: c("CLAIM REJECTED (fake reason)") }), opts);
    expect(r.claim?.casesheet_sent_date).toBeNull();
    expect(r.extra["casesheet_sent_date (as entered)"]).toBe("CLAIM REJECTED (fake reason)");
  });
  it("missing copay gives NULL Discount 1, never zero", () => {
    const r = cleanRow(profile, row({}, { copay_amount: c("") }), opts);
    expect(r.claim?.discount_1_amount).toBeNull();
    expect(r.nullReasons.discount_1_amount).toBe("INPUT_MISSING");
  });
});

describe("mapping", () => {
  it("maps by header name, keeps the first of a repeated header, never maps 'Amount' alone", () => {
    const m = mapHeaders(["Sl No", "Patient Name", "DOA", "BILL \nAMOUNT", "FINAL\nAPPROVED \nAMOUNT", "CO-PAY", "Amount", "DOA", "UTR"]);
    expect(m.map((x) => x.field)).toEqual([
      "serial_no", "patient_name", "admission_date", "bill_amount", "approved_amount", "copay_amount", null, null, "payment_utr",
    ]);
    expect(m[7]?.method).toBe("DUPLICATE_HEADER");
  });
  it("HMS headers seen on 26-Oct", () => {
    const m = mapHeaders(["PAYMENT RECEIVED DATE", "PROCEDURE/TREATMENT", "POLICY / CARD NUMBER", "MRD/ UHID/ IP NUMBER", "HOSPITAL BILL AMOUNT", "BALANCE AMOUNT"]);
    expect(m.map((x) => x.field)).toEqual(["payment_date", "treatment_or_surgery", "policy_or_card_no", "patient_ip_no", "bill_amount", null]);
  });
  it("header row and fingerprint", () => {
    expect(findHeaderRow([["OCTOBER 2026"], ["Sl No", "Patient Name", "DOA", "DOD", "BILL"], ["1", "x", "1/1/26", "2/1/26", "5"]])).toBe(1);
    expect(headerFingerprint(["Sl No", "Patient Name", null])).toBe("slno|patientname");
  });
});

describe("dynamic rule status lifecycle (PROPOSED -> ACTIVE -> RETIRED)", () => {
  const rowWithApprovedAboveBill = row({}, {
    doctor_name: c("Dr. Fake Doctor"),
    bill_amount: c("100000"),
    approved_amount: c("120000"),
    payment_amount: c("108000"),
  });

  it("PROPOSED rule: shadow = true, rowClass stays CLEAN", () => {
    const r = cleanRow(profile, rowWithApprovedAboveBill, {
      today: TODAY,
      dateOrder: "DMY",
      ruleVersions: [{ ruleId: "R-A07", version: 1, type: "CHECK", status: "PROPOSED" }],
    });
    const a07 = r.issues.find((i) => i.ruleId === "R-A07");
    expect(a07).toBeDefined();
    expect(a07?.shadow).toBe(true);
    expect(r.rowClass).toBe("CLEAN");
  });

  it("ACTIVE rule: shadow = false, causes NEEDS_STAFF_INPUT", () => {
    const r = cleanRow(profile, rowWithApprovedAboveBill, {
      today: TODAY,
      dateOrder: "DMY",
      ruleVersions: [{ ruleId: "R-A07", version: 1, type: "CHECK", status: "ACTIVE" }],
    });
    const a07 = r.issues.find((i) => i.ruleId === "R-A07");
    expect(a07).toBeDefined();
    expect(a07?.shadow).toBe(false);
    expect(r.rowClass).toBe("NEEDS_STAFF_INPUT");
  });

  it("RETIRED rule: not evaluated, 0 issues raised for this rule", () => {
    const r = cleanRow(profile, rowWithApprovedAboveBill, {
      today: TODAY,
      dateOrder: "DMY",
      ruleVersions: [{ ruleId: "R-A07", version: 1, type: "CHECK", status: "RETIRED" }],
    });
    expect(r.issues.find((i) => i.ruleId === "R-A07")).toBeUndefined();
    expect(r.rowClass).toBe("CLEAN");
  });

  it("empty rule library: same result as no rule versions (live starts with 0 rules)", () => {
    const none = cleanRow(profile, rowWithApprovedAboveBill, { today: TODAY, dateOrder: "DMY" });
    const empty = cleanRow(profile, rowWithApprovedAboveBill, { today: TODAY, dateOrder: "DMY", ruleVersions: [] });
    expect(empty).toEqual(none);
    expect(empty.claim?.tds_rate_source ?? null).toBe(none.claim?.tds_rate_source ?? null);
  });

  it("REFERENCE rule: not evaluated, 0 issues raised for this rule", () => {
    const r = cleanRow(profile, rowWithApprovedAboveBill, {
      today: TODAY,
      dateOrder: "DMY",
      ruleVersions: [{ ruleId: "R-A07", version: 1, type: "CHECK", status: "REFERENCE" }],
    });
    expect(r.issues.find((i) => i.ruleId === "R-A07")).toBeUndefined();
    expect(r.rowClass).toBe("CLEAN");
  });
});

