import { describe, expect, it } from "vitest";
import { cleanRow, cleanTdsAmountStated, cleanTdsRate, findHeaderRow, headerFingerprint, INITIAL_RULES, mapHeaders, type HospitalProfile, type RuleVersion, type SourceRow } from "../src/index.ts";

// Fake hospital, fake rows. The worked example of file 01 section 7 runs through the whole
// row cleaner, not only the money helper.
const TODAY = "2026-10-26";

// The Stage 2a seed, as a worker would load it (version 1 for every rule: these fixtures
// never need history). Using the one real list (initial-rules.ts) instead of hand-written
// fixtures means these tests fail the moment the seed and the engine drift apart.
const SEED_RULE_VERSIONS: RuleVersion[] = INITIAL_RULES.filter((r) => r.type === "CHECK").map((r) => ({
  ruleId: r.ruleId,
  version: 1,
  type: "CHECK",
  status: r.status,
  severity: r.severity ?? null,
  checkDefinition: r.checkDefinition ?? null,
  action: r.action ?? null,
  staffMessage: r.staffMessage ?? null,
}));
/** One real rule's definition, for the dynamic-status tests below (varies only `status`). */
const ruleVersionFor = (ruleId: string, status: RuleVersion["status"]): RuleVersion => {
  const seed = INITIAL_RULES.find((r) => r.ruleId === ruleId)!;
  return { ruleId, version: 1, type: "CHECK", status, severity: seed.severity ?? null, checkDefinition: seed.checkDefinition ?? null, action: seed.action ?? null, staffMessage: seed.staffMessage ?? null };
};
const profile: HospitalProfile = {
  hospitalCode: "HOSP32P900001",
  scheme: "PRIVATE",
  tabStage: { PAID: "SETTLED" },
  statusWords: { paid: "SETTLED", settled: "SETTLED", claimapproved: "APPROVED", na: "NOT_WRITTEN" },
  colourLegend: { "#ff9900": "PAID", "#00ff00": "CLAIM_SUBMITTED", "#ff0000": "REJECTED_OR_CANCELLED" },
  doctorAliases: { drfakedoctor: "Dr. Fake Doctor" },
  insurerAliases: {},
  tpaAliases: {},
  departmentAliases: {},
  tpaCellMayHoldInsurer: true,
  insurerKeys: ["fakeinsurance"],
  paidMeaningOpenTabs: ["OLD"],
  podStartDate: null,
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
      payment_amount: c("90000"),
      payment_date: c("10/09/2026"),
      payment_utr: c("FAKEUTR00001"),
      tds_amount_stated: c("10000"),
      policy_holder_name: c("Fake Holder"),
      ...cells,
    },
    ...over,
  };
}
const opts = { today: TODAY, dateOrder: "DMY" as const, ruleVersions: SEED_RULE_VERSIONS };

describe("worked example in the stored row values", () => {
  const r = cleanRow(profile, row(), opts);
  it("Deduction 15000, Total TDS 10000 (stated), Expected settlement 90000, Balance 0, source DEFAULT (R-T01)", () => {
    expect(r.claim).toMatchObject({
      bill_amount: "120000",
      approved_amount: "100000",
      copay_amount: "5000",
      settled_amount: "90000.00",
      deduction_amount: "15000.00",
      tds_amount: "10000.00",
      expected_tds_amount: "10000.00",
      expected_settlement_amount: "90000.00",
      balance_amount: "0.00",
      tds_rate_source: "DEFAULT",
      tds_rule_id: "R-T01",
      claim_status: "SETTLED",
      status_source: "tab",
    });
    expect(r.issues.filter((i) => !i.shadow)).toEqual([]); // a reconciled claim raises nothing
  });
  it("one payment, record key from the claim no, doctor name standardised (tier B = AUTO_FIXED)", () => {
    expect(r.payments).toHaveLength(1);
    expect(r.recordKey).toBe("HOSP32P900001|PRIVATE|C:CLM001|2026-08-01|2026-08-05"); // claim no + DOA + DOD (decision section 7)
    expect(r.claim?.doctor_name).toBe("Dr. Fake Doctor");
    expect(r.changes.map((x) => x.ruleId)).toEqual(["M-ALIAS-DOCTOR"]);
    expect(r.rowClass).toBe("AUTO_FIXED");
  });
});

describe("classification", () => {
  it("a complete row with nothing changed is CLEAN", () => {
    const r = cleanRow(profile, row({}, { doctor_name: c("Dr. Fake Doctor") }), opts);
    expect(r.rowClass).toBe("CLEAN");
    expect(r.issues.filter((i) => !i.shadow)).toEqual([]);
  });
  it("settled without a UTR needs staff input (R-S01)", () => {
    const r = cleanRow(profile, row({}, { payment_utr: c("") }), opts);
    expect(r.rowClass).toBe("NEEDS_STAFF_INPUT");
    expect(r.issues.map((i) => i.ruleId)).toContain("R-S01");
  });
  it("a row without patient, claim no or admission date is a NON_DATA_ROW (R-C01)", () => {
    const r = cleanRow(profile, row({}, { patient_name: c(""), preauth_or_claim_no: c(""), admission_date: c("") }), opts);
    expect(r.rowClass).toBe("NON_DATA_ROW");
    expect(r.claim).toBeNull();
  });
});

describe("rows without an identity", () => {
  it("are kept under their row reference and need staff input (never dropped)", () => {
    const r = cleanRow(profile, row({ tab: "PENDING", row: 9 }, { preauth_or_claim_no: c(""), patient_name: c("") }), opts);
    expect(r.recordKey).toBe("HOSP32P900001|PRIVATE|ROW:PENDING#9");
    expect(r.rowClass).toBe("NEEDS_STAFF_INPUT");
  });
});

describe("status", () => {
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
  it("two UTRs in one cell: ONE payment holding the total, flag AMOUNT_SPLIT_UNKNOWN, never split", () => {
    const r = cleanRow(profile, row({}, { payment_utr: c("FAKEUTR00001, FAKEUTR00002") }), opts);
    expect(r.payments).toHaveLength(1);
    expect(r.payments[0]).toMatchObject({ amountReceived: "90000", utrNo: ["FAKEUTR00001", "FAKEUTR00002"], flags: ["AMOUNT_SPLIT_UNKNOWN"] });
  });
  it("an insurer name in the TPA cell means no separate TPA (confirmed)", () => {
    const r = cleanRow(profile, row({}, { insurer_name: c(""), tpa_name: c("FAKE INSURANCE CO") }), opts);
    expect(r.claim).toMatchObject({ insurer_name: "FAKE INSURANCE CO", tpa_name: null });
    expect(r.nullReasons.tpa_name).toBe("NO_SEPARATE_TPA");
  });
  it("a tab whose paid meaning is an open question holds back the Balance, not the Deduction", () => {
    const r = cleanRow(profile, row({ tab: "OLD" }, { status_text: c("PAID") }), opts);
    expect(r.claim?.balance_amount).toBeNull();
    expect(r.nullReasons.balance_amount).toBe("OPEN_QUESTION");
    expect(r.claim?.deduction_amount).toBe("15000.00");
  });
  it("a cell that cannot be read keeps its original text in extra_fields", () => {
    const r = cleanRow(profile, row({}, { casesheet_sent_date: c("CLAIM REJECTED (fake reason)") }), opts);
    expect(r.claim?.casesheet_sent_date).toBeNull();
    expect(r.extra["casesheet_sent_date (as entered)"]).toBe("CLAIM REJECTED (fake reason)");
  });
  it("missing copay gives NULL Deduction, never zero", () => {
    const r = cleanRow(profile, row({}, { copay_amount: c("") }), opts);
    expect(r.claim?.deduction_amount).toBeNull();
    expect(r.nullReasons.deduction_amount).toBe("INPUT_MISSING");
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
      ruleVersions: [ruleVersionFor("R-A07", "PROPOSED")],
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
      ruleVersions: [ruleVersionFor("R-A07", "ACTIVE")],
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
      ruleVersions: [ruleVersionFor("R-A07", "RETIRED")],
    });
    expect(r.issues.find((i) => i.ruleId === "R-A07")).toBeUndefined();
    expect(r.rowClass).toBe("CLEAN");
  });

  it("empty rule library: same result as no rule versions (a fresh hospital, zero rules)", () => {
    const none = cleanRow(profile, rowWithApprovedAboveBill, { today: TODAY, dateOrder: "DMY" });
    const empty = cleanRow(profile, rowWithApprovedAboveBill, { today: TODAY, dateOrder: "DMY", ruleVersions: [] });
    expect(empty).toEqual(none);
    expect(empty.claim?.tds_rate_source ?? null).toBe(none.claim?.tds_rate_source ?? null);
  });

  it("REFERENCE rule: not evaluated, 0 issues raised for this rule", () => {
    const r = cleanRow(profile, rowWithApprovedAboveBill, {
      today: TODAY,
      dateOrder: "DMY",
      ruleVersions: [ruleVersionFor("R-A07", "REFERENCE")],
    });
    expect(r.issues.find((i) => i.ruleId === "R-A07")).toBeUndefined();
    expect(r.rowClass).toBe("CLEAN");
  });
});

// Stage 2c, 1-Nov: phone_number, policy_holder_name and courier_no (POD Number) were mappable
// fields (fields.ts) that cleanRow never actually read or stored before - found while building
// R-K04/R-K05/R-K06, fixed on the way (same pattern as 2a's discount_amount fix).
describe("Stage 2c: fields clean.ts did not read before", () => {
  it("phone_number, policy_holder_name and courier_no are stored and exposed to the engine", () => {
    const r = cleanRow(profile, row({}, { phone_number: c("9876543210"), policy_holder_name: c("Fake Holder"), courier_no: c("POD123") }), opts);
    expect(r.claim).toMatchObject({ phone_number: "9876543210", policy_holder_name: "Fake Holder", courier_no: "POD123" });
  });

  it("R-K04: policy number equal to phone number is asked", () => {
    const r = cleanRow(profile, row({}, { policy_or_card_no: c("9876543210"), phone_number: c("9876543210") }), opts);
    expect(r.issues.map((i) => i.ruleId)).toContain("R-K04");
  });

  it("R-K04: a different policy number and phone number: no issue", () => {
    const r = cleanRow(profile, row({}, { policy_or_card_no: c("POLICY001"), phone_number: c("9876543210") }), opts);
    expect(r.issues.map((i) => i.ruleId)).not.toContain("R-K04");
  });

  it("R-K05: Policy Holder Name empty while a claim number is present", () => {
    const r = cleanRow(profile, row({}, { policy_holder_name: undefined }), opts);
    expect(r.issues.map((i) => i.ruleId)).toContain("R-K05");
  });

  it("R-K06: POD Number empty while Hardcopy Sent Date is present, only from the hospital's POD Start Date", () => {
    const withCasesheet = (cells: Parameters<typeof row>[1] = {}) => row({}, { casesheet_sent_date: c("20/09/2026"), courier_no: undefined, ...cells });
    const noPodStart = cleanRow(profile, withCasesheet(), opts);
    expect(noPodStart.issues.map((i) => i.ruleId)).not.toContain("R-K06"); // no POD Start Date set: the rule never runs

    const withPodStart: HospitalProfile = { ...profile, podStartDate: "2026-09-01" };
    const afterStart = cleanRow(withPodStart, withCasesheet(), opts);
    expect(afterStart.issues.map((i) => i.ruleId)).toContain("R-K06"); // hardcopy sent after POD Start Date, POD Number still empty

    const beforeStart = cleanRow({ ...withPodStart, podStartDate: "2026-10-01" }, withCasesheet(), opts);
    expect(beforeStart.issues.map((i) => i.ruleId)).not.toContain("R-K06"); // hardcopy sent before POD Start Date
  });
});

describe("TDS rate format (extra field `tds`, decisions.md section 9, 1-Nov)", () => {
  it.each([
    ["10.0", "10"],
    ["9.0", "9"],
    ["10.0%", "10"],
    ["8.8978978999", "8.8"],
    ["9.45674433456", "9.4"],
  ])("%s -> %s", (raw, cleaned) => {
    expect(cleanTdsRate(raw)).toBe(cleaned);
  });

  it("a value already at one decimal, or a plain whole number, is left as it is (no change)", () => {
    expect(cleanTdsRate("8.8")).toBeNull();
    expect(cleanTdsRate("10")).toBeNull();
  });

  it("not a plain number is left as it is", () => {
    expect(cleanTdsRate("ten percent")).toBeNull();
  });

  it("cleanRow truncates the tds extra field, tags the change, and keeps the original", () => {
    const r = cleanRow(profile, row({ extra: { tds: "8.8978978999" } }), opts);
    expect(r.extra.tds).toBe("8.8");
    expect(r.extra["tds (as entered)"]).toBe("8.8978978999");
    expect(r.changes).toContainEqual({ field: "tds", oldValue: "8.8978978999", newValue: "8.8", ruleId: "M-TDS-RATE-FORMAT", tier: "B" });
    // Never touches tds_amount_stated or any bill/approved/settled amount.
    expect(r.claim?.bill_amount).toBe("120000");
    expect(r.claim?.approved_amount).toBe("100000");
    expect(r.claim?.settled_amount).toBe("90000.00");
  });

  it("cleanRow leaves an already-clean tds value untouched, with no change logged", () => {
    const r = cleanRow(profile, row({ extra: { tds: "10" } }), opts);
    expect(r.extra.tds).toBe("10");
    expect(r.extra["tds (as entered)"]).toBeUndefined();
    expect(r.changes.some((c) => c.field === "tds")).toBe(false);
  });
});

describe("tds_amount_stated rounding (decisions.md section 9, 1-Nov)", () => {
  it.each([
    ["1234.4", "1234"],
    ["1234.5", "1235"],
  ])("%s -> %s", (raw, cleaned) => {
    expect(cleanTdsAmountStated(raw)).toBe(cleaned);
  });

  it("an already-whole value is left as it is (no change)", () => {
    expect(cleanTdsAmountStated("1234")).toBeNull();
  });

  it("not a plain number is left as it is", () => {
    expect(cleanTdsAmountStated("pending")).toBeNull();
  });

  it("cleanRow rounds tds_amount_stated, tags the change, and keeps the original", () => {
    const r = cleanRow(profile, row({}, { tds_amount_stated: c("1234.5") }), opts);
    expect(r.claim?.tds_amount).toBe("1235.00"); // Total TDS: sum of the (now-rounded) stated TDS
    expect(r.extra["tds_amount_stated (as entered)"]).toBe("1234.5");
    expect(r.changes).toContainEqual({ field: "tds_amount_stated", oldValue: "1234.5", newValue: "1235", ruleId: "M-TDS-AMOUNT-ROUND", tier: "B" });
    // Never touches bill, approved, settled, co-pay or discount.
    expect(r.claim?.bill_amount).toBe("120000");
    expect(r.claim?.approved_amount).toBe("100000");
    expect(r.claim?.copay_amount).toBe("5000");
    expect(r.claim?.settled_amount).toBe("90000.00");
    expect(r.claim?.discount_amount).toBeNull();
  });

  it("cleanRow leaves an already-whole tds_amount_stated untouched, with no change logged", () => {
    const r = cleanRow(profile, row({}, { tds_amount_stated: c("10000") }), opts);
    expect(r.claim?.tds_amount).toBe("10000.00");
    expect(r.extra["tds_amount_stated (as entered)"]).toBeUndefined();
    expect(r.changes.some((ch) => ch.field === "tds_amount_stated")).toBe(false);
  });
});

describe("amount rounding to 2dp half-up (decisions.md section 8, 10-Nov)", () => {
  it("cleanRow rounds a bill amount read with float noise, tags the change, and keeps the original", () => {
    const r = cleanRow(profile, row({}, { bill_amount: c("120000.104") }), opts);
    expect(r.claim?.bill_amount).toBe("120000.10");
    expect(r.extra["bill_amount (as entered)"]).toBe("120000.104");
    expect(r.changes).toContainEqual({ field: "bill_amount", oldValue: "120000.104", newValue: "120000.10", ruleId: "M-AMOUNT-ROUND-2DP", tier: "B" });
  });

  it("cleanRow leaves an already-2dp amount untouched, with no change logged", () => {
    const r = cleanRow(profile, row({}, { bill_amount: c("120000") }), opts);
    expect(r.claim?.bill_amount).toBe("120000");
    expect(r.extra["bill_amount (as entered)"]).toBeUndefined();
    expect(r.changes.some((ch) => ch.field === "bill_amount")).toBe(false);
  });
});

