import { describe, expect, it } from "vitest";
import type { CleanClaim, CleanRow } from "@oksy/rules";
import { checkSameClaims, checkSameUtr, dedupeExactRows } from "../src/identity.ts";

// Same claim inside one run (decision sections 7 and 9). Invented patients and claim numbers.
function row(n: number, claim: Partial<CleanClaim>, key: string, keyType: CleanRow["keyType"] = "CLAIM_NO"): CleanRow {
  return {
    tab: "OCT 2026", row: n, rowClass: "CLEAN", recordKey: key, keyType,
    claim: { patient_name: "Fake Patient", admission_date: "2026-10-01", ...claim } as CleanClaim,
    payments: [], nullReasons: {}, flags: [], issues: [], changes: [], extra: {},
    sourceAmounts: { bill: null, claimed: null, approved: null, copay: null, settled: null },
  };
}
const K = (claim: string) => `HOSPTEST0001|PRIVATE|C:${claim}|2026-10-01|2026-10-04`;

describe("same claim inside one run", () => {
  it("an exact repeat is a duplicate: stored once, counted, not flagged", () => {
    const a = row(2, { bill_amount: "1000.00" }, K("FAKE1"));
    const b = row(9, { bill_amount: "1000.00" }, K("FAKE1"));
    const r = checkSameClaims([a, b], "PRIVATE");
    expect([...r.duplicates]).toEqual([b]);
    expect(r.conflicting).toBe(0);
    expect(a.issues).toEqual([]);
  });

  it("the same claim with different values is flagged on both rows (R-K02, split off from R-Y03 on 1-Nov); both kept, linked by #2", () => {
    const a = row(2, { bill_amount: "1000.00" }, K("FAKE2"));
    const b = row(9, { bill_amount: "1200.00" }, K("FAKE2"));
    const r = checkSameClaims([a, b], "PRIVATE");
    expect(r.conflicting).toBe(1);
    expect(r.duplicates.size).toBe(0);
    expect([a.recordKey, b.recordKey]).toEqual([K("FAKE2"), `${K("FAKE2")}#2`]);
    expect([a, b].map((x) => [x.rowClass, x.issues.map((i) => i.ruleId)])).toEqual([["NEEDS_STAFF_INPUT", ["R-K02"]], ["NEEDS_STAFF_INPUT", ["R-K02"]]]);
  });

  it("Rule Library wording (severity, message) is read from the caller's rules, not hard-coded", () => {
    const a = row(2, { bill_amount: "1000.00" }, K("FAKE2B"));
    const b = row(9, { bill_amount: "1200.00" }, K("FAKE2B"));
    checkSameClaims([a, b], "PRIVATE", { "R-K02": { severity: "E", staffMessage: "Custom conflict wording." } });
    expect(a.issues[0]).toMatchObject({ ruleId: "R-K02", severity: "E", detail: "Custom conflict wording." });
  });

  it("a rule made Inactive (missing from the caller's rules) never fires", () => {
    const a = row(2, { bill_amount: "1000.00" }, K("FAKE2C"));
    const b = row(9, { bill_amount: "1200.00" }, K("FAKE2C"));
    const r = checkSameClaims([a, b], "PRIVATE", { "R-K02": undefined });
    expect(r.conflicting).toBe(1); // still counted; just not shown as an issue
    expect([...a.issues, ...b.issues]).toEqual([]);
  });

  it("the same patient with the same admission date under two claim numbers is a warning", () => {
    const a = row(2, {}, K("FAKE3"));
    const b = row(3, {}, K("FAKE4"));
    const r = checkSameClaims([a, b], "PRIVATE");
    expect(r.samePatientSameDay).toBe(2);
    expect(a.issues[0]).toMatchObject({ ruleId: "R-Y03", severity: "W", detail: "Same patient with the same admission date under another claim number." });
  });

  it("KASP Dialysis: repeat sessions are not duplicates", () => {
    const a = row(2, {}, K("FAKE5"));
    const b = row(3, {}, K("FAKE6"));
    expect(checkSameClaims([a, b], "KASP_DIALYSIS").samePatientSameDay).toBe(0);
    expect(a.issues).toEqual([]);
  });

  it("the same IP number with another claim number and another date is a repeat treatment, not an error", () => {
    const a = row(2, { patient_ip_no: "FAKEIP1" }, K("FAKE7"));
    const b = row(3, { patient_ip_no: "FAKEIP1", admission_date: "2026-10-20" }, "HOSPTEST0001|PRIVATE|C:FAKE8|2026-10-20|2026-10-22");
    const r = checkSameClaims([a, b], "PRIVATE");
    expect([r.duplicates.size, r.conflicting, r.samePatientSameDay]).toEqual([0, 0, 0]);
    expect([...a.issues, ...b.issues]).toEqual([]);
  });
});

describe("dedupeExactRows", () => {
  it("drops an exact repeat, keeps a row that differs under the same key", () => {
    const a = row(2, { bill_amount: "1000.00" }, K("FAKE9"));
    const b = row(9, { bill_amount: "1000.00" }, K("FAKE9"));
    const c = row(3, { bill_amount: "2000.00" }, K("FAKE9"));
    const { kept, duplicates } = dedupeExactRows([a, b, c]);
    expect(kept).toEqual([a, c]);
    expect([...duplicates]).toEqual([b]);
  });
});

describe("checkSameUtr (decisions.md section 7, 1-Nov; R-K01)", () => {
  it("flags both claims when the same UTR is used on two different claims", () => {
    const a = row(2, { utr_no: ["FAKEUTR0001"] }, K("FAKE10"));
    const b = row(3, { utr_no: ["FAKEUTR0001"] }, K("FAKE11"));
    const r = checkSameUtr([a, b]);
    expect(r.flagged).toBe(2);
    expect(a.issues).toMatchObject([{ ruleId: "R-K01", severity: "W", field: "payment_utr" }]);
    expect(b.issues).toMatchObject([{ ruleId: "R-K01", severity: "W", field: "payment_utr" }]);
  });

  it("a combined two-part claim's own two UTRs never flag itself (base key, #2 suffix stripped)", () => {
    const primary = row(2, { utr_no: ["FAKEUTR0010", "FAKEUTR0011"] }, K("FAKE12"));
    const secondary = row(3, { utr_no: ["FAKEUTR0011"] }, `${K("FAKE12")}#2`);
    const r = checkSameUtr([primary, secondary]);
    expect(r.flagged).toBe(0);
  });

  it("different UTRs on different claims: no flag", () => {
    const a = row(2, { utr_no: ["FAKEUTR0001"] }, K("FAKE13"));
    const b = row(3, { utr_no: ["FAKEUTR0002"] }, K("FAKE14"));
    expect(checkSameUtr([a, b]).flagged).toBe(0);
  });

  it("a rule made Inactive (missing from the caller's rules) never fires", () => {
    const a = row(2, { utr_no: ["FAKEUTR0001"] }, K("FAKE15"));
    const b = row(3, { utr_no: ["FAKEUTR0001"] }, K("FAKE16"));
    const r = checkSameUtr([a, b], { "R-K01": undefined });
    expect(r.flagged).toBe(2); // still counted; just not shown as an issue
    expect([...a.issues, ...b.issues]).toEqual([]);
  });
});
