// Reconciliation before every write (file 02 section 5). Pure code. Counts and sums only:
// the result is stored and reported with no patient data. An unexplained difference is a
// defect: the run stops and writes nothing.
import { Money, type CleanRow } from "@oksy/rules";
import type { RawTab, TabLayout } from "./sheet-data.ts";

type AmountKey = "bill" | "claimed" | "approved" | "copay" | "settled";
const AMOUNT_FIELD: Record<AmountKey, string> = {
  bill: "bill_amount",
  claimed: "claimed_amount",
  approved: "approved_amount",
  copay: "copay_amount",
  settled: "payment_amount",
};

export interface Reconciliation {
  result: "PASS" | "FAIL";
  counts: {
    sourceRows: number;
    byClass: Record<string, number>;
    perTab: Record<string, { sourceRows: number; byClass: Record<string, number> }>;
  };
  sums: Record<AmountKey, { source: string; cleaned: string; explained: string; unexplained: string }>;
  differences: Array<{ check: string; count: number; detail: string }>;
}

export function emptyReconciliation(): Reconciliation {
  const zero = { source: "0", cleaned: "0", explained: "0", unexplained: "0" };
  return {
    result: "PASS",
    counts: { sourceRows: 0, byClass: {}, perTab: {} },
    sums: { bill: zero, claimed: zero, approved: zero, copay: zero, settled: zero },
    differences: [],
  };
}

/** Independent of the cleaner: digits, one dot and a leading minus only. */
function looseAmount(text: string | null | undefined): InstanceType<typeof Money> | null {
  if (!text) return null;
  const s = text.replace(/[^\d.-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return new Money(s);
}

export function reconcile(tabs: RawTab[], layouts: TabLayout[], rows: CleanRow[]): Reconciliation {
  const differences: Reconciliation["differences"] = [];
  const byClass: Record<string, number> = {};
  const perTab: Reconciliation["counts"]["perTab"] = {};
  for (const r of rows) {
    byClass[r.rowClass] = (byClass[r.rowClass] ?? 0) + 1;
    const t = (perTab[r.tab] ??= { sourceRows: 0, byClass: {} });
    t.sourceRows++;
    t.byClass[r.rowClass] = (t.byClass[r.rowClass] ?? 0) + 1;
  }
  const sourceRows = rows.length;
  const classSum = Object.values(byClass).reduce((a, b) => a + b, 0);
  if (classSum !== sourceRows) differences.push({ check: "ROW_COUNT", count: sourceRows - classSum, detail: "source rows <> sum of classes" });

  // Sums: the raw cells of every data row (parsed independently) vs the cleaned values.
  const sums = {} as Reconciliation["sums"];
  const byTabRow = new Map(rows.map((r) => [`${r.tab}#${r.row}`, r]));
  for (const key of Object.keys(AMOUNT_FIELD) as AmountKey[]) {
    let source = new Money(0);
    let cleaned = new Money(0);
    let explained = new Money(0);
    let unexplainedRows = 0;
    for (const tab of tabs) {
      const layout = layouts.find((l) => l.tab === tab.name);
      const col = layout?.map.find((m) => m.field === AMOUNT_FIELD[key])?.column;
      if (layout?.headerRow == null || col === undefined) continue;
      for (let i = layout.headerRow + 1; i < tab.rows.length; i++) {
        const r = byTabRow.get(`${tab.name}#${i + 1}`);
        if (!r || r.rowClass === "NON_DATA_ROW") continue; // totals and banners are not claims
        const raw = tab.rows[i]?.[col];
        const src = typeof raw?.[1] === "number" ? new Money(String(raw[1])) : looseAmount(raw?.[0]);
        const out = r.sourceAmounts[key];
        if (src) source = source.plus(src);
        if (out !== null) cleaned = cleaned.plus(out);
        if (src && out === null) explained = explained.plus(src); // NULL with a reason code on the row
        else if (src && out !== null && !src.equals(out)) unexplainedRows++;
        else if (!src && out !== null) unexplainedRows++;
      }
    }
    const unexplained = source.minus(cleaned).minus(explained);
    sums[key] = { source: source.toFixed(2), cleaned: cleaned.toFixed(2), explained: explained.toFixed(2), unexplained: unexplained.toFixed(2) };
    if (!unexplained.isZero() || unexplainedRows > 0)
      differences.push({ check: `SUM_${key.toUpperCase()}`, count: unexplainedRows, detail: "source and cleaned differ without a reason code" });
  }

  // Settled on the claim = sum of its payments (D-047).
  let settledMismatch = 0;
  for (const r of rows) {
    if (!r.claim) continue;
    const pay = r.payments.reduce<InstanceType<typeof Money> | null>(
      (s, p) => (s === null || p.amountReceived === null ? null : s.plus(p.amountReceived)),
      r.payments.length ? new Money(0) : null,
    );
    const claimSettled = r.claim.settled_amount;
    if ((pay === null) !== (claimSettled === null) || (pay && claimSettled && !pay.equals(claimSettled))) settledMismatch++;
  }
  if (settledMismatch) differences.push({ check: "SETTLED_EQUALS_PAYMENTS", count: settledMismatch, detail: "claim settled amount <> sum of payments" });

  return { result: differences.length ? "FAIL" : "PASS", counts: { sourceRows, byClass, perTab }, sums, differences };
}
