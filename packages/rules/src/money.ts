// Money helper (file 04 section 3, D-024, D-028, D-035, D-047, D-050, D-061).
// Pure code: no database, no Google. Every amount is a Decimal, never a JavaScript number
// (hard rule 7). Source amounts are never rounded; computed fields are separate values.
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

/** The TDS rate chosen for a row (see resolveTdsRate in selection.ts). */
export interface TdsChoice {
  rate: string;
  source: TdsRateSource;
  ruleId: string | null;
}

export interface PaymentInput {
  amount: AmountInput;
  date: string | null; // ISO YYYY-MM-DD
  utr: string | null;
}

export interface MoneyInput {
  bill: AmountInput;
  approved: AmountInput; // the final approved amount (D-028)
  copay: AmountInput; // empty copay = unknown, never zero
  payments: PaymentInput[]; // one row per payment received (D-047)
  tds: TdsChoice | null;
}

export type TdsPath = "TDS_ON_PAID" | "TDS_ON_APPROVED" | "NEITHER";

export interface TdsPathResult {
  path: TdsPath;
  /** Only for TDS_ON_APPROVED: tds = approved x rate, and the rest as another deduction. */
  tdsOnApproved: Money | null;
  otherDeduction: Money | null;
}

/** Flags the validation rules turn into issues (R-A08, R-A09, R-A12). The helper never raises issues itself. */
export type MoneyFlag = "DISCOUNT1_NEGATIVE" | "DISCOUNT2_BELOW_TOLERANCE" | "TDS_PATH_ON_APPROVED" | "TDS_PATH_NEITHER";

export interface MoneyResult {
  discount1: Field;
  discount1Pct: Field;
  settled: Field; // sum of the payments
  settlementDate: string | null; // latest payment date
  utrs: string[]; // display only
  gross: Field;
  tds: Field;
  /** Discount 2 before the D-035 tolerance. */
  discount2Raw: Field;
  /** Discount 2 with a value from minus INR 2 to 0 counted as 0 (D-035). */
  discount2: Field;
  discount2Pct: Field;
  tdsRateSource: TdsRateSource | null;
  tdsPath: TdsPathResult;
  /** false when neither TDS path fits (R-A12): Discount 2 is shown as unconfirmed. */
  discount2Confirmed: boolean;
  flags: MoneyFlag[];
}

/** Discount 2 between minus this and 0 counts as 0 (D-035). */
export const DISCOUNT2_TOLERANCE = new Money("2");

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

function pct(part: Field, whole: Field): Field {
  const reason = need(part, whole);
  if (reason) return nul(reason);
  if ((whole.value as Money).isZero()) return nul("INPUT_INVALID");
  return ok((part.value as Money).div(whole.value as Money).times(100));
}

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

function tdsRate(choice: TdsChoice | null): Field {
  if (!choice) return nul("NO_TDS_RATE");
  const r = parseAmount(choice.rate);
  if (r.value === null) return nul("INPUT_INVALID");
  if (r.value.isNegative() || r.value.gte(1)) return nul("INPUT_INVALID");
  return r;
}

/**
 * R-A12 TDS path check (file 04 section 3, condition 9). The paid-amount path fits when
 * settled / (1 - rate) is a whole rupee amount; otherwise "TDS on approved" is tested:
 * tds = approved x rate, the rest a separate deduction, both whole rupees.
 * The whole-rupee tolerance starts at 0; it is set from the shadow results by an approver.
 */
export function tdsPathCheck(approved: string, settled: string, rate: string, tolerance = "0"): TdsPathResult {
  const a = new Money(approved);
  const s = new Money(settled);
  const r = new Money(rate);
  const tol = new Money(tolerance);
  const whole = (x: Money) => x.minus(x.round()).abs().lte(tol);

  if (whole(s.div(new Money(1).minus(r)))) return { path: "TDS_ON_PAID", tdsOnApproved: null, otherDeduction: null };
  const tdsA = a.times(r);
  const other = a.minus(tdsA).minus(s);
  if (whole(tdsA) && whole(other) && !other.isNegative()) {
    return { path: "TDS_ON_APPROVED", tdsOnApproved: tdsA, otherDeduction: other };
  }
  return { path: "NEITHER", tdsOnApproved: null, otherDeduction: null };
}

export function computeMoney(input: MoneyInput): MoneyResult {
  const flags: MoneyFlag[] = [];
  const bill = parseAmount(input.bill);
  const approved = parseAmount(input.approved);
  const copay = parseAmount(input.copay);

  // Discount 1 = bill - approved - copay (D-028). A negative value is kept for R-A08.
  const discount1 = derive([bill, approved, copay], (b, a, c) => b.minus(a).minus(c));
  if (discount1.value?.isNegative()) flags.push("DISCOUNT1_NEGATIVE");
  const discount1Pct = pct(discount1, bill);

  // Payments (D-047): settled = sum, settlement date = latest, UTRs listed.
  const settled = settledFrom(input.payments);
  const dates = input.payments.map((p) => p.date).filter((d): d is string => !!d);
  const settlementDate = dates.length ? dates.reduce((x, y) => (y > x ? y : x)) : null;
  const utrs = input.payments.map((p) => p.utr).filter((u): u is string => !!u);

  // gross = settled / (1 - tds_rate); tds = gross - settled (D-024).
  const rate = tdsRate(input.tds);
  const gross = derive([settled, rate], (s, r) => s.div(new Money(1).minus(r)));
  const tds = derive([gross, settled], (g, s) => g.minus(s));

  // Discount 2 = approved - tds - settled (D-028), with the INR 2 tolerance (D-035).
  const discount2Raw = derive([approved, tds, settled], (a, t, s) => a.minus(t).minus(s));
  let discount2 = discount2Raw;
  if (discount2Raw.value?.isNegative()) {
    if (discount2Raw.value.gte(DISCOUNT2_TOLERANCE.neg())) discount2 = ok(new Money(0));
    else flags.push("DISCOUNT2_BELOW_TOLERANCE");
  }
  const discount2Pct = pct(discount2, approved);

  let tdsPath: TdsPathResult = { path: "NEITHER", tdsOnApproved: null, otherDeduction: null };
  let discount2Confirmed = false;
  if (approved.value && settled.value && rate.value) {
    tdsPath = tdsPathCheck(approved.value.toString(), settled.value.toString(), rate.value.toString());
    if (tdsPath.path === "TDS_ON_APPROVED") flags.push("TDS_PATH_ON_APPROVED");
    if (tdsPath.path === "NEITHER") flags.push("TDS_PATH_NEITHER");
    discount2Confirmed = tdsPath.path !== "NEITHER";
  }

  return {
    discount1,
    discount1Pct,
    settled,
    settlementDate,
    utrs,
    gross,
    tds,
    discount2Raw,
    discount2,
    discount2Pct,
    tdsRateSource: input.tds && rate.value ? input.tds.source : null,
    tdsPath,
    discount2Confirmed,
    flags,
  };
}
