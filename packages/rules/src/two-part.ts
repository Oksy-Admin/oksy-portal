// Two-part approval (Stage 2c, decisions.md section 7, 1-Nov): first part approved and paid,
// then a second approval and payment, same claim number + admission + discharge date, same
// Approved Amount, different UTR. Combined only after a person confirms (claim_links,
// packages/worker/src/sheet-run.ts); never guessed, never automatic. Pure code: the caller
// (the worker) reads and writes claim_links; this module only matches rows and recombines.
import type { CleanOptions, CleanRow, HospitalProfile, SourceRow } from "./clean.ts";
import { cleanRow } from "./clean.ts";
import { Money } from "./money.ts";

export interface TwoPartCandidate {
  /** The claim identity both rows share (decisions.md section 7), before any "#2" suffix. */
  key: string;
  primary: CleanRow;
  secondary: CleanRow;
}

function amountsEqual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return new Money(a).equals(new Money(b));
}

function sameUtrs(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((u, i) => u === b[i]);
}

/** Deterministic: the part with the earlier settlement date (or, failing that, the earlier source row) is primary. */
function orderParts(x: CleanRow, y: CleanRow): [CleanRow, CleanRow] {
  const dx = x.claim!.settlement_date;
  const dy = y.claim!.settlement_date;
  if (dx && dy && dx !== dy) return dx < dy ? [x, y] : [y, x];
  if (dx && !dy) return [x, y];
  if (dy && !dx) return [y, x];
  if (x.tab !== y.tab) return x.tab < y.tab ? [x, y] : [y, x];
  return x.row < y.row ? [x, y] : [y, x];
}

/**
 * Candidate pairs among this run's cleaned rows, before any duplicate removal or "same claim,
 * different values" conflict flagging (packages/worker/src/identity.ts runs after this, and
 * skips a key this function returns). Exactly two rows sharing a claim-number key, both
 * Approved, the same Approved Amount, a real and different UTR on each.
 */
export function findTwoPartCandidates(rows: CleanRow[]): TwoPartCandidate[] {
  const byKey = new Map<string, CleanRow[]>();
  for (const r of rows) {
    if (!r.recordKey || !r.claim || r.keyType !== "CLAIM_NO" || r.rowClass === "NON_DATA_ROW") continue;
    byKey.set(r.recordKey, [...(byKey.get(r.recordKey) ?? []), r]);
  }
  const out: TwoPartCandidate[] = [];
  for (const [key, list] of byKey) {
    if (list.length !== 2) continue;
    const [x, y] = list as [CleanRow, CleanRow];
    if (x.claim!.claim_status !== "APPROVED" || y.claim!.claim_status !== "APPROVED") continue;
    if (!amountsEqual(x.claim!.approved_amount, y.claim!.approved_amount)) continue;
    if (x.claim!.utr_no.length === 0 || y.claim!.utr_no.length === 0) continue;
    if (sameUtrs(x.claim!.utr_no, y.claim!.utr_no)) continue; // identical UTRs: a duplicate, not two parts
    const [primary, secondary] = orderParts(x, y);
    out.push({ key, primary, secondary });
  }
  return out;
}

/** Claim-level money fields (column-dictionary.md section 4): attach to the combined claim only, never to a part on its own. */
const MONEY_ISSUE_FIELDS = new Set(["settled_amount", "balance_amount", "tds_amount_stated", "discount_amount"]);

function formatAmount(claim: CleanRow["claim"]): string {
  return claim?.settled_amount ?? "0";
}

function formatPartRemark(label: string, row: CleanRow): string {
  const date = row.claim?.settlement_date ?? row.claim?.admission_date ?? "?";
  return `${label}: Rs ${formatAmount(row.claim)} (${date})`;
}

/**
 * A candidate with no CONFIRMED or REJECTED decision yet: suffixed the same way a conflict
 * would be (so both rows persist as their own claims_staging row - decisions.md section 7,
 * "parts stay as rows, never deleted") but with no issue raised, since it is not yet known to
 * be a real conflict or a real two-part match. Mutates both rows in place.
 */
export function markPending(candidate: TwoPartCandidate): void {
  candidate.primary.flags.push("TWO_PART_PENDING");
  candidate.secondary.flags.push("TWO_PART_PENDING");
  candidate.secondary.recordKey = `${candidate.key}#2`;
}

export interface CombineResult {
  /** Replaces the primary row in the run's row list. */
  primary: CleanRow;
  /** The secondary row, mutated in place: flagged, re-keyed, its claim-level money issues removed. */
  secondary: CleanRow;
}

/**
 * Applies a CONFIRMED claim_links decision: re-cleans the primary row with the secondary's
 * payments merged in (so Total Settled / Total TDS / Balance and every money rule are
 * computed over both parts together, by the one trusted cleanRow function, never by
 * duplicating its logic here), and marks the secondary so it is never listed as its own claim.
 */
export function combineTwoPart(candidate: TwoPartCandidate, primarySource: SourceRow, profile: HospitalProfile, options: Omit<CleanOptions, "extraPayments" | "remarksSuffix">): CombineResult {
  const { primary, secondary } = candidate;
  const remarksSuffix = `Two-part payment - ${formatPartRemark("Part 1", primary)} | ${formatPartRemark("Part 2", secondary)}`;
  const extraPayments = secondary.payments.map((p) => ({
    amount: p.amountReceived,
    date: p.paymentDate,
    utr: p.utrNo.join("|") || null,
    tdsStated: p.tdsAmountStated,
  }));

  const combinedPrimary = cleanRow(profile, primarySource, { ...options, extraPayments, remarksSuffix });

  secondary.flags.push("TWO_PART_SECONDARY");
  secondary.recordKey = `${candidate.key}#2`;
  secondary.issues = secondary.issues.filter((i) => !MONEY_ISSUE_FIELDS.has(i.field));
  const blocking = secondary.issues.some((i) => !i.shadow && i.severity === "E");
  secondary.rowClass = blocking ? "NEEDS_STAFF_INPUT" : secondary.changes.length > 0 ? "AUTO_FIXED" : "CLEAN";

  combinedPrimary.flags.push("TWO_PART_PRIMARY");
  return { primary: combinedPrimary, secondary };
}
