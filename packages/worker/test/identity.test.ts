import { describe, expect, it } from "vitest";
import type { CleanClaim, CleanRow } from "@oksy/rules";
import { checkSameClaims } from "../src/identity.ts";

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

  it("the same claim with different values is flagged on both rows; both kept, linked by #2", () => {
    const a = row(2, { bill_amount: "1000.00" }, K("FAKE2"));
    const b = row(9, { bill_amount: "1200.00" }, K("FAKE2"));
    const r = checkSameClaims([a, b], "PRIVATE");
    expect(r.conflicting).toBe(1);
    expect(r.duplicates.size).toBe(0);
    expect([a.recordKey, b.recordKey]).toEqual([K("FAKE2"), `${K("FAKE2")}#2`]);
    expect([a, b].map((x) => [x.rowClass, x.issues.map((i) => i.ruleId)])).toEqual([["NEEDS_STAFF_INPUT", ["R-Y03"]], ["NEEDS_STAFF_INPUT", ["R-Y03"]]]);
  });

  it("the same patient with the same admission date under two claim numbers is a warning", () => {
    const a = row(2, {}, K("FAKE3"));
    const b = row(3, {}, K("FAKE4"));
    const r = checkSameClaims([a, b], "PRIVATE");
    expect(r.samePatientSameDay).toBe(2);
    expect(a.issues[0]).toMatchObject({ ruleId: "R-Y03", severity: "W", detail: "Same patient with the same admission date under another claim number" });
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
