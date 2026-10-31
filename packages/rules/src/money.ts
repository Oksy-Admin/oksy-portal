// Money helper (decisions.md section 8, requirements.md section 11; rewritten Stage 2a:
// the old Discount 1 / Discount 2 / TDS-path model is retired). Pure code: no database, no
// Google. Every amount is a Decimal, never a JavaScript number (hard rule 7). Source amounts
// are never rounded; computed fields are separate values. TDS is never filled in by this
// code: Total TDS is the sum of what the hospital stated per payment, or NULL (hard rule 6).
import Decimal from "decimal.js";

// Own Decimal settings so no other code can change the precision used for money.
export const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Money = InstanceType<typeof Money>;

/** Amount as read from the sheet after normalisation (file 04 section 4.3): a plain decimal string, or NULL. */
export type AmountInput = string | null;

export type NullReason = "INPUT_MISSING" | "INPUT_INVALID" | "NO_TDS_RATE";

/** A computed field: a value, or NULL with a reason code (hard rule 6). */
export interface Field {
  value: Money | null;
  reason: NullReason | null;
}

export type TdsRateSource = "DEFAULT" | "RULE" | "CONFIRMED";

/** The TDS rate chosen for a row (see resolveTdsRate in selection.ts), used only to check the
 * hospital's stated TDS against the normal rate (R-F03); the portal never derives TDS from it. */
export interface TdsChoice {
  rate: string;
  source: TdsRateSource;
  ruleId: string | null;
}

export interface PaymentInput {
  amount: AmountInput;
  date: string | null; // ISO YYYY-MM-DD
  utr: string | null;
  tdsStated: AmountInput; // as the hospital wrote it; never computed
}

export interface MoneyInput {
  bill: AmountInput;
  approved: AmountInput; // the final approved amount (D-028)
  copay: AmountInput; // empty copay = unknown, never zero
  discountStated: AmountInput; // the hospital's own "Discount" column (decisions section 8)
  payments: PaymentInput[]; // one row per payment received (D-047)
  tdsRate: TdsChoice | null;
}

export interface MoneyResult {
  /** Deduction (C) = Bill - Approved - Co-pay (column-dictionary section 4). */
  deduction: Field;
  /** Total Settled (C): sum of the payments. */
  totalSettled: Field;
  /** Total TDS (C): sum of the hospital's stated TDS per payment. NULL if any paid payment has none. */
  totalTds: Field;
  settlementDate: string | null; // latest payment date
  utrs: string[]; // display only
  /** Expected TDS = Approved x the normal rate, for comparison only (R-F03), never written as fact. */
  expectedTdsAmount: Field;
  /** Expected settlement (C) = Approved - Total TDS. */
  expectedSettlement: Field;
  /** Balance Amount (C) = Approved - Total TDS - Total Settled. Zero allowed, negative is an Error (R-F06). */
  balance: Field;
  tdsRateSource: TdsRateSource | null;
}

const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

function ok(value: Money): Field {
  return { value, reason: null };
}

function nul(reason: NullReason): Field {
  return { value: null, reason };
}

/** Reads a normalised amount. Anything that is not a plain decimal string is INPUT_INVALID. */
export function parseAmount(input: AmountInput): Field {
  if (input === null || input.trim() === "") return nul("INPUT_MISSING");
  const s = input.trim();
  if (!PLAIN_DECIMAL.test(s)) return nul("INPUT_INVALID");
  return ok(new Money(s));
}

/** Combines the inputs of a computed field: the first missing or invalid input decides the reason. */
function need(...fields: Field[]): NullReason | null {
  for (const f of fields) if (f.value === null) return f.reason ?? "INPUT_MISSING";
  return null;
}

function derive(inputs: Field[], fn: (...v: Money[]) => Money): Field {
  const reason = need(...inputs);
  if (reason) return nul(reason);
  return ok(fn(...inputs.map((f) => f.value as Money)));
}

/** Sum of the payments' amounts. No payments at all = unknown (not yet settled), never zero. */
function settledFrom(payments: PaymentInput[]): Field {
  if (payments.length === 0) return nul("INPUT_MISSING");
  let sum = new Money(0);
  for (const p of payments) {
    const a = parseAmount(p.amount);
    if (a.value === null) return nul(a.reason ?? "INPUT_MISSING"); // never a guessed sum
    sum = sum.plus(a.value);
  }
  return ok(sum);
}

/**
 * Sum of the hospital's stated TDS per payment (decisions section 8: TDS is never filled in
 * by the portal). A payment with an amount but no stated TDS makes the total unknown, not zero.
 */
function totalTdsFrom(payments: PaymentInput[]): Field {
  if (payments.length === 0) return nul("INPUT_MISSING");
  let sum = new Money(0);
  for (const p of payments) {
    const amt = parseAmount(p.amount);
    if (amt.value === null) continue; // no payment amount: its TDS is not expected either
    const t = parseAmount(p.tdsStated);
    if (t.value === null) return nul("INPUT_MISSING");
    sum = sum.plus(t.value);
  }
  return ok(sum);
}

function tdsRate(choice: TdsChoice | null): Field {
  if (!choice) return nul("NO_TDS_RATE");
  const r = parseAmount(choice.rate);
  if (r.value === null) return nul("INPUT_INVALID");
  if (r.value.isNegative() || r.value.gte(1)) return nul("INPUT_INVALID");
  return r;
}

export function computeMoney(input: MoneyInput): MoneyResult {
  const bill = parseAmount(input.bill);
  const approved = parseAmount(input.approved);
  const copay = parseAmount(input.copay);

  // Deduction = Bill - Approved - Co-pay (decisions section 8; compared with the hospital's
  // stated Discount by rule R-F01, not here).
  const deduction = derive([bill, approved, copay], (b, a, c) => b.minus(a).minus(c));

  const totalSettled = settledFrom(input.payments);
  const dates = input.payments.map((p) => p.date).filter((d): d is string => !!d);
  const settlementDate = dates.length ? dates.reduce((x, y) => (y > x ? y : x)) : null;
  const utrs = input.payments.map((p) => p.utr).filter((u): u is string => !!u);

  const totalTds = totalTdsFrom(input.payments);
  const rate = tdsRate(input.tdsRate);
  const expectedTdsAmount = derive([approved, rate], (a, r) => a.times(r));
  const expectedSettlement = derive([approved, totalTds], (a, t) => a.minus(t));
  const balance = derive([approved, totalTds, totalSettled], (a, t, s) => a.minus(t).minus(s));

  return {
    deduction,
    totalSettled,
    totalTds,
    settlementDate,
    utrs,
    expectedTdsAmount,
    expectedSettlement,
    balance,
    tdsRateSource: input.tdsRate && rate.value ? input.tdsRate.source : null,
  };
}
