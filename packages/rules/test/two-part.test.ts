import { describe, expect, it } from "vitest";
import { cleanRow, combineTwoPart, findTwoPartCandidates, INITIAL_RULES, markPending, type HospitalProfile, type RuleVersion, type SourceRow } from "../src/index.ts";

// Two-part approval (Stage 2c, decisions.md section 7, 1-Nov): first part approved and paid,
// then a second approval and payment, same claim identity, same Approved Amount, a real and
// different UTR on each. Fake patients, fake claim numbers.
const TODAY = "2026-12-01";
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
const profile: HospitalProfile = {
  hospitalCode: "HOSP32P900001",
  scheme: "PRIVATE",
  tabStage: {},
  statusWords: { claimapproved: "APPROVED", settled: "SETTLED" },
  colourLegend: {},
  doctorAliases: {},
  insurerAliases: {},
  tpaAliases: {},
  departmentAliases: {},
  tpaCellMayHoldInsurer: false,
  insurerKeys: [],
  paidMeaningOpenTabs: [],
  podStartDate: null,
};
const opts = { today: TODAY, dateOrder: "DMY" as const, ruleVersions: SEED_RULE_VERSIONS };
const c = (text: string) => ({ text });

function part(row: number, approved: string, paid: string, utr: string, paymentDate: string, over: SourceRow["cells"] = {}): SourceRow {
  return {
    tab: "PENDING",
    row,
    extra: {},
    rowColour: null,
    cells: {
      patient_name: c("Fake Patient Ten"),
      preauth_or_claim_no: c("CLM010"),
      admission_date: c("01/10/2026"),
      discharge_date: c("05/10/2026"),
      status_text: c("Claim Approved"),
      department: c("Ortho"),
      treatment_or_surgery: c("Fake procedure"),
      doctor_name: c("Dr Fake"),
      policy_holder_name: c("Fake Holder"),
      approved_amount: c(approved),
      bill_amount: c("60000"),
      copay_amount: c("5000"),
      payment_amount: c(paid),
      payment_utr: c(utr),
      payment_date: c(paymentDate),
      ...over,
    },
  };
}

const sourceA = part(2, "40000", "20000", "FAKEUTR00010", "10/11/2026");
const sourceB = part(3, "40000", "15000", "FAKEUTR00011", "20/11/2026");
const partA = () => cleanRow(profile, sourceA, opts);
const partB = () => cleanRow(profile, sourceB, opts);

describe("findTwoPartCandidates", () => {
  it("matches: same claim identity, both Approved, same Approved Amount, different UTR", () => {
    const candidates = findTwoPartCandidates([partA(), partB()]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.primary.claim?.utr_no).toEqual(["FAKEUTR00010"]); // the earlier payment date is primary
    expect(candidates[0]!.secondary.claim?.utr_no).toEqual(["FAKEUTR00011"]);
  });

  it("no match: different Approved Amounts", () => {
    const b = cleanRow(profile, part(3, "41000", "15000", "FAKEUTR00011", "20/11/2026"), opts);
    expect(findTwoPartCandidates([partA(), b])).toEqual([]);
  });

  it("no match: the same UTR on both rows (a duplicate, not two parts)", () => {
    const b = cleanRow(profile, part(3, "40000", "15000", "FAKEUTR00010", "20/11/2026"), opts);
    expect(findTwoPartCandidates([partA(), b])).toEqual([]);
  });

  it("no match: one row is not Approved", () => {
    const b = cleanRow(profile, part(3, "40000", "15000", "FAKEUTR00011", "20/11/2026", { status_text: c("Settled") }), opts);
    expect(findTwoPartCandidates([partA(), b])).toEqual([]);
  });

  it("no match: three rows share the identity (out of scope - falls to the normal conflict check instead)", () => {
    const c3 = cleanRow(profile, part(4, "40000", "5000", "FAKEUTR00012", "25/11/2026"), opts);
    expect(findTwoPartCandidates([partA(), partB(), c3])).toEqual([]);
  });
});

describe("markPending", () => {
  it("suffixes the secondary key and flags both rows, without adding a conflict issue (R-K02)", () => {
    const [a, b] = [partA(), partB()];
    const beforeA = [...a.issues];
    const beforeB = [...b.issues];
    const [candidate] = findTwoPartCandidates([a, b]);
    markPending(candidate!);
    expect(b.recordKey).toBe(`${candidate!.key}#2`);
    expect(a.flags).toContain("TWO_PART_PENDING");
    expect(b.flags).toContain("TWO_PART_PENDING");
    // markPending only suffixes the key and flags both rows; it never touches issues itself -
    // whatever each part's own cleanRow already found (unrelated to the pair) is unchanged.
    expect(a.issues).toEqual(beforeA);
    expect(b.issues).toEqual(beforeB);
    expect([...a.issues, ...b.issues].map((i) => i.ruleId)).not.toContain("R-K02");
  });
});

describe("combineTwoPart", () => {
  it("merges both parts' payments: Settled Amount summed, UTR combined, remarks show the breakdown", () => {
    const [a, b] = [partA(), partB()];
    const [candidate] = findTwoPartCandidates([a, b]);
    const { primary, secondary } = combineTwoPart(candidate!, sourceA, profile, opts);
    expect(primary.claim?.settled_amount).toBe("35000.00");
    expect(primary.claim?.utr_no).toEqual(["FAKEUTR00010", "FAKEUTR00011"]);
    expect(primary.claim?.remarks).toContain("Two-part payment");
    expect(primary.claim?.remarks).toContain("20000.00");
    expect(primary.claim?.remarks).toContain("15000.00");
    expect(primary.flags).toContain("TWO_PART_PRIMARY");
    expect(secondary.flags).toContain("TWO_PART_SECONDARY");
    expect(secondary.recordKey).toBe(`${candidate!.key}#2`);
  });

  it("the combined claim has no money-rule Error (Approved - TDS - Settled reconciles; neither part's own, smaller total looked negative or wrong)", () => {
    const [a, b] = [partA(), partB()];
    const [candidate] = findTwoPartCandidates([a, b]);
    const { primary } = combineTwoPart(candidate!, sourceA, profile, opts);
    const ruleIds = primary.issues.filter((i) => !i.shadow).map((i) => i.ruleId);
    expect(ruleIds).not.toContain("R-F06"); // Balance negative (Error) - would mean the combine under-counted settled
    expect(ruleIds).not.toContain("R-A03"); // Settled greater than approved (Error) - would mean it over-counted
    // Approved 40000, TDS stated empty on both parts (no tds_amount_stated cell): a payment
    // with empty TDS is asked (R-F02). Status stays Approved while a settled amount is now
    // present (R-S03): a real, correct side effect of this scenario, not a combine bug.
    expect([...ruleIds].sort()).toEqual(["R-F02", "R-S03"]);
  });

  it("the secondary part's own claim-level money issues are removed (they attach to the combined claim only)", () => {
    const [a, b] = [partA(), partB()];
    const [candidate] = findTwoPartCandidates([a, b]);
    const { secondary } = combineTwoPart(candidate!, sourceA, profile, opts);
    expect(secondary.issues.some((i) => ["settled_amount", "balance_amount", "tds_amount_stated"].includes(i.field))).toBe(false);
  });
});
