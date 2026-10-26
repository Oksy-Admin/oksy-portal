import { describe, expect, it } from "vitest";
import { computeMoney, tdsPathCheck, type MoneyInput } from "../src/index.ts";

// File 04 sections 3 and 11, file 12 A6. Amounts are strings: money never passes through
// a JavaScript number (hard rule 7).
const tds10 = { rate: "0.10", source: "DEFAULT" as const, ruleId: "R-T01" };

function base(over: Partial<MoneyInput> = {}): MoneyInput {
  return {
    bill: "120000",
    approved: "100000",
    copay: "5000",
    payments: [{ amount: "85500", date: "2026-08-10", utr: "UTIB000111" }],
    tds: tds10,
    ...over,
  };
}

describe("money helper: the file 04 worked example", () => {
  const m = computeMoney(base());

  it("Discount 1 = bill - approved - copay = 15000 (12.5% of bill)", () => {
    expect(m.discount1.value?.toFixed(2)).toBe("15000.00");
    expect(m.discount1Pct.value?.toFixed(2)).toBe("12.50");
  });

  it("gross 95000, TDS 9500, Discount 2 5000 (5% of approved)", () => {
    expect(m.gross.value?.toFixed(2)).toBe("95000.00");
    expect(m.tds.value?.toFixed(2)).toBe("9500.00");
    expect(m.discount2.value?.toFixed(2)).toBe("5000.00");
    expect(m.discount2Pct.value?.toFixed(2)).toBe("5.00");
  });

  it("stores the TDS rate source and the paid-amount path", () => {
    expect(m.tdsRateSource).toBe("DEFAULT");
    expect(m.tdsPath.path).toBe("TDS_ON_PAID");
    expect(m.discount2Confirmed).toBe(true);
  });
});

describe("money helper: missing and invalid inputs (never zero, never invented)", () => {
  it("an empty copay gives NULL Discount 1 with INPUT_MISSING", () => {
    const m = computeMoney(base({ copay: null }));
    expect(m.discount1.value).toBeNull();
    expect(m.discount1.reason).toBe("INPUT_MISSING");
    expect(m.discount2.value?.toFixed(2)).toBe("5000.00"); // Discount 2 does not need copay
  });

  it("a non-number amount gives INPUT_INVALID", () => {
    const m = computeMoney(base({ bill: "1.2 L" }));
    expect(m.discount1.value).toBeNull();
    expect(m.discount1.reason).toBe("INPUT_INVALID");
  });

  it("no payments: settled, gross, TDS and Discount 2 are NULL", () => {
    const m = computeMoney(base({ payments: [] }));
    expect(m.settled.value).toBeNull();
    expect(m.settled.reason).toBe("INPUT_MISSING");
    expect(m.gross.value).toBeNull();
    expect(m.discount2.value).toBeNull();
  });

  it("no TDS rate chosen: gross and Discount 2 are NULL with NO_TDS_RATE", () => {
    const m = computeMoney(base({ tds: null }));
    expect(m.gross.value).toBeNull();
    expect(m.gross.reason).toBe("NO_TDS_RATE");
    expect(m.discount2.reason).toBe("NO_TDS_RATE");
    expect(m.tdsRateSource).toBeNull();
  });

  it("source amounts are never rounded", () => {
    const m = computeMoney(base({ bill: "120000.555" }));
    expect(m.discount1.value?.toString()).toBe("15000.555");
  });
});

describe("money helper: Discount 1 edge cases", () => {
  it("approved = bill with no copay gives Discount 1 exactly zero", () => {
    const m = computeMoney(base({ bill: "100000", copay: "0" }));
    expect(m.discount1.value?.isZero()).toBe(true);
    expect(m.flags).not.toContain("DISCOUNT1_NEGATIVE");
  });

  it("approved + copay above bill is flagged DISCOUNT1_NEGATIVE (R-A08), value kept", () => {
    const m = computeMoney(base({ bill: "100000", copay: "5000" }));
    expect(m.discount1.value?.toFixed(2)).toBe("-5000.00");
    expect(m.flags).toContain("DISCOUNT1_NEGATIVE");
  });
});

describe("money helper: Discount 2 tolerance (D-035)", () => {
  it("Discount 2 exactly zero", () => {
    const m = computeMoney(base({ payments: [{ amount: "90000", date: "2026-08-10", utr: "U1" }] }));
    expect(m.discount2.value?.isZero()).toBe(true);
  });

  it("between minus INR 2 and 0 counts as 0, the raw value is kept", () => {
    // 90001.20 / 0.90 = 100001.333..., Discount 2 raw = -1.333...
    const m = computeMoney(base({ payments: [{ amount: "90001.20", date: "2026-08-10", utr: "U1" }] }));
    expect(m.discount2Raw.value?.toFixed(2)).toBe("-1.33");
    expect(m.discount2.value?.isZero()).toBe(true);
    expect(m.flags).not.toContain("DISCOUNT2_BELOW_TOLERANCE");
  });

  it("exactly minus INR 2 still counts as 0", () => {
    const m = computeMoney(base({ payments: [{ amount: "90001.80", date: "2026-08-10", utr: "U1" }] }));
    expect(m.discount2Raw.value?.toFixed(2)).toBe("-2.00");
    expect(m.discount2.value?.isZero()).toBe(true);
  });

  it("below minus INR 2 is flagged (R-A09) and not set to zero", () => {
    const m = computeMoney(base({ payments: [{ amount: "90009", date: "2026-08-10", utr: "U1" }] }));
    expect(m.discount2.value?.toFixed(2)).toBe("-10.00");
    expect(m.flags).toContain("DISCOUNT2_BELOW_TOLERANCE");
  });
});

describe("money helper: payments (D-047)", () => {
  const m = computeMoney(
    base({
      payments: [
        { amount: "50000", date: "2026-07-01", utr: "UTIB000111" },
        { amount: "35500", date: "2026-09-15", utr: "SBIN000222" },
      ],
    }),
  );

  it("settled = sum of the payments, latest date, both UTRs listed", () => {
    expect(m.settled.value?.toFixed(2)).toBe("85500.00");
    expect(m.settlementDate).toBe("2026-09-15");
    expect(m.utrs).toEqual(["UTIB000111", "SBIN000222"]);
  });

  it("Discount 2 uses the sum", () => {
    expect(m.discount2.value?.toFixed(2)).toBe("5000.00");
  });

  it("a part payment gives Discount 2 as the balance still not received", () => {
    const p = computeMoney(base({ payments: [{ amount: "45000", date: "2026-07-01", utr: "U1" }] }));
    expect(p.discount2.value?.toFixed(2)).toBe("50000.00");
  });

  it("a payment with a missing amount makes settled NULL, never a guessed sum", () => {
    const p = computeMoney(
      base({
        payments: [
          { amount: "50000", date: "2026-07-01", utr: "U1" },
          { amount: null, date: "2026-07-02", utr: "U2" },
        ],
      }),
    );
    expect(p.settled.value).toBeNull();
    expect(p.settled.reason).toBe("INPUT_MISSING");
  });
});

describe("money helper: TDS rate source (D-050)", () => {
  it("RULE when a more specific rule set the rate, e.g. TDS 0%", () => {
    const m = computeMoney(
      base({
        tds: { rate: "0", source: "RULE", ruleId: "R-T90" },
        payments: [{ amount: "95000", date: "2026-08-10", utr: "U1" }],
      }),
    );
    expect(m.tdsRateSource).toBe("RULE");
    expect(m.gross.value?.toFixed(2)).toBe("95000.00");
    expect(m.tds.value?.isZero()).toBe(true);
    expect(m.discount2.value?.toFixed(2)).toBe("5000.00");
  });

  it("CONFIRMED when the hospital or an approver confirmed the row's rate", () => {
    const m = computeMoney(base({ tds: { rate: "0.01", source: "CONFIRMED", ruleId: null } }));
    expect(m.tdsRateSource).toBe("CONFIRMED");
  });

  it("a rate of 100% or more is invalid", () => {
    const m = computeMoney(base({ tds: { rate: "1", source: "RULE", ruleId: "R-T90" } }));
    expect(m.gross.value).toBeNull();
    expect(m.gross.reason).toBe("INPUT_INVALID");
  });
});

describe("TDS path check (R-A12, D-050)", () => {
  it("approved 100000, settled 85000: names the TDS-on-approved path (TDS 10000, other 5000)", () => {
    const r = tdsPathCheck("100000", "85000", "0.10");
    expect(r.path).toBe("TDS_ON_APPROVED");
    expect(r.tdsOnApproved?.toFixed(2)).toBe("10000.00");
    expect(r.otherDeduction?.toFixed(2)).toBe("5000.00");
  });

  it("the computed fields stay as in D-024, and Discount 2 is confirmed only on a fitting path", () => {
    const m = computeMoney(base({ payments: [{ amount: "85000", date: "2026-08-10", utr: "U1" }] }));
    expect(m.gross.value?.toFixed(2)).toBe("94444.44");
    expect(m.tdsPath.path).toBe("TDS_ON_APPROVED");
    expect(m.flags).toContain("TDS_PATH_ON_APPROVED");
    expect(m.discount2Confirmed).toBe(true);
  });

  it("neither path fits: warning, Discount 2 unconfirmed", () => {
    const m = computeMoney(base({ approved: "100000.50", payments: [{ amount: "85000.25", date: "2026-08-10", utr: "U1" }] }));
    expect(m.tdsPath.path).toBe("NEITHER");
    expect(m.flags).toContain("TDS_PATH_NEITHER");
    expect(m.discount2Confirmed).toBe(false);
  });
});
