import { describe, expect, it } from "vitest";
import { computeMoney, type MoneyInput } from "../src/index.ts";

// Decisions.md section 8, requirements.md section 11 (rewritten Stage 2a: TDS is never
// derived by the portal, only what the hospital stated per payment). Amounts are strings:
// money never passes through a JavaScript number (hard rule 7).
const tds10 = { rate: "0.10", source: "DEFAULT" as const, ruleId: "R-T01" };

function base(over: Partial<MoneyInput> = {}): MoneyInput {
  return {
    bill: "120000",
    approved: "100000",
    copay: "5000",
    discountStated: "15000",
    payments: [{ amount: "90000", date: "2026-08-10", utr: "UTIB000111", tdsStated: "10000" }],
    tdsRate: tds10,
    ...over,
  };
}

describe("money helper: the worked example", () => {
  const m = computeMoney(base());

  it("Deduction = bill - approved - copay = 15000", () => {
    expect(m.deduction.value?.toFixed(2)).toBe("15000.00");
  });

  it("Total Settled, Total TDS and Expected TDS", () => {
    expect(m.totalSettled.value?.toFixed(2)).toBe("90000.00");
    expect(m.totalTds.value?.toFixed(2)).toBe("10000.00");
    expect(m.expectedTdsAmount.value?.toFixed(2)).toBe("10000.00"); // 10% of 100000
  });

  it("Expected settlement = approved - total TDS; Balance = approved - TDS - settled", () => {
    expect(m.expectedSettlement.value?.toFixed(2)).toBe("90000.00");
    expect(m.balance.value?.toFixed(2)).toBe("0.00");
  });

  it("stores the TDS rate source", () => {
    expect(m.tdsRateSource).toBe("DEFAULT");
  });
});

describe("money helper: missing and invalid inputs (never zero, never invented)", () => {
  it("an empty copay gives NULL Deduction with INPUT_MISSING", () => {
    const m = computeMoney(base({ copay: null }));
    expect(m.deduction.value).toBeNull();
    expect(m.deduction.reason).toBe("INPUT_MISSING");
  });

  it("a non-number amount gives INPUT_INVALID", () => {
    const m = computeMoney(base({ bill: "1.2 L" }));
    expect(m.deduction.value).toBeNull();
    expect(m.deduction.reason).toBe("INPUT_INVALID");
  });

  it("no payments: Total Settled and Total TDS are NULL (not yet settled, never zero)", () => {
    const m = computeMoney(base({ payments: [] }));
    expect(m.totalSettled.value).toBeNull();
    expect(m.totalSettled.reason).toBe("INPUT_MISSING");
    expect(m.totalTds.value).toBeNull();
    expect(m.expectedSettlement.value).toBeNull();
    expect(m.balance.value).toBeNull();
  });

  it("a payment with an amount but no stated TDS makes Total TDS NULL, never a guessed rate", () => {
    const m = computeMoney(base({ payments: [{ amount: "90000", date: "2026-08-10", utr: "U1", tdsStated: null }] }));
    expect(m.totalTds.value).toBeNull();
    expect(m.totalTds.reason).toBe("INPUT_MISSING");
    expect(m.totalSettled.value?.toFixed(2)).toBe("90000.00"); // settled does not need TDS
  });

  it("no TDS rate chosen: expected TDS is NULL with NO_TDS_RATE (Total TDS is unaffected)", () => {
    const m = computeMoney(base({ tdsRate: null }));
    expect(m.expectedTdsAmount.value).toBeNull();
    expect(m.expectedTdsAmount.reason).toBe("NO_TDS_RATE");
    expect(m.totalTds.value?.toFixed(2)).toBe("10000.00");
    expect(m.tdsRateSource).toBeNull();
  });

  it("source amounts are never rounded", () => {
    const m = computeMoney(base({ bill: "120000.555" }));
    expect(m.deduction.value?.toString()).toBe("15000.555");
  });

  it("a rate of 100% or more is invalid", () => {
    const m = computeMoney(base({ tdsRate: { rate: "1", source: "RULE", ruleId: "R-T90" } }));
    expect(m.expectedTdsAmount.value).toBeNull();
    expect(m.expectedTdsAmount.reason).toBe("INPUT_INVALID");
  });
});

describe("money helper: payments, several per claim (D-047)", () => {
  const m = computeMoney(
    base({
      payments: [
        { amount: "50000", date: "2026-07-01", utr: "UTIB000111", tdsStated: "5000" },
        { amount: "40000", date: "2026-09-15", utr: "SBIN000222", tdsStated: "5000" },
      ],
    }),
  );

  it("Total Settled and Total TDS are both sums; latest date; both UTRs listed", () => {
    expect(m.totalSettled.value?.toFixed(2)).toBe("90000.00");
    expect(m.totalTds.value?.toFixed(2)).toBe("10000.00");
    expect(m.settlementDate).toBe("2026-09-15");
    expect(m.utrs).toEqual(["UTIB000111", "SBIN000222"]);
  });

  it("a payment with a missing amount makes Total Settled NULL, never a guessed sum", () => {
    const p = computeMoney(
      base({
        payments: [
          { amount: "50000", date: "2026-07-01", utr: "U1", tdsStated: "5000" },
          { amount: null, date: "2026-07-02", utr: "U2", tdsStated: null },
        ],
      }),
    );
    expect(p.totalSettled.value).toBeNull();
    expect(p.totalSettled.reason).toBe("INPUT_MISSING");
  });
});

describe("money helper: TDS rate source (D-050), for comparison only", () => {
  it("RULE when a more specific rule set the rate", () => {
    const m = computeMoney(base({ tdsRate: { rate: "0", source: "RULE", ruleId: "R-T90" } }));
    expect(m.tdsRateSource).toBe("RULE");
    expect(m.expectedTdsAmount.value?.isZero()).toBe(true);
  });

  it("CONFIRMED when the hospital or an approver confirmed the row's rate", () => {
    const m = computeMoney(base({ tdsRate: { rate: "0.01", source: "CONFIRMED", ruleId: null } }));
    expect(m.tdsRateSource).toBe("CONFIRMED");
  });
});
