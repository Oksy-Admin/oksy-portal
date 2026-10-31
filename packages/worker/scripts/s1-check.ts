// S1 exit test, read-only (run by hand after a live run):
//   pnpm --filter @oksy/worker s1-check
// Prints counts, sums and pass/fail lines only: never a patient name, claim no or UTR
// (hard rule 10). Uses the worker key from apps/web/.env.local (never printed).
import { computeMoney, Money } from "@oksy/rules";
import { dbFromEnv } from "../src/db.ts";
import { HMS_CODE } from "../src/hms-profile.ts";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const db = dbFromEnv();
const line = (ok: boolean, what: string, detail: string) => console.log(`${ok ? "PASS" : "FAIL"} | ${what} | ${detail}`);

type Claim = Record<string, string | number | null> & { record_uid: string; record_key: string };
const claims = await db.select<Claim>(
  `claims_staging?hospital_code=eq.${HMS_CODE}&missing_since=is.null&select=record_uid,record_key,source_tab,row_class,claim_status,bill_amount::text,approved_amount::text,copay_amount::text,settled_amount::text,deduction_amount::text,tds_amount::text,balance_amount::text,tds_rate_used::text,tds_rate_source`,
);
const payments = await db.select<{ record_uid: string; amount_received: string | null; tds_amount_stated: string | null }>(
  `payments?hospital_code=eq.${HMS_CODE}&missing_since=is.null&select=record_uid,amount_received::text,tds_amount_stated::text`,
);
const [job] = await db.select<{ id: string; summary: { reconciliation?: { counts?: { sourceRows: number; byClass: Record<string, number>; perTab: Record<string, unknown> }; result?: string } } }>(
  `jobs?sheet_key=eq.${HMS_CODE}%7CPRIVATE&status=eq.SUCCEEDED&mode=eq.WRITE&order=finished_at.desc&limit=1&select=id,summary`,
);

// 1. Counts (pilot reference: 354 data rows, 6 data tabs; CLEAN 140, AUTO_FIXED 12, NEEDS_STAFF_INPUT 202).
const byClass: Record<string, number> = {};
const byTab: Record<string, number> = {};
for (const c of claims) {
  byClass[String(c.row_class)] = (byClass[String(c.row_class)] ?? 0) + 1;
  byTab[String(c.source_tab)] = (byTab[String(c.source_tab)] ?? 0) + 1;
}
const counts = job?.summary.reconciliation?.counts;
const nonData = counts?.byClass?.NON_DATA_ROW ?? 0;
console.log(`claims stored: ${claims.length}; per tab: ${JSON.stringify(byTab)}; per class: ${JSON.stringify(byClass)}`);
console.log(`last run: source rows ${counts?.sourceRows ?? "?"} (NON_DATA_ROW ${nonData}); reconciliation ${job?.summary.reconciliation?.result ?? "?"}`);
line(claims.length === 354, "354 data rows (pilot)", `stored ${claims.length}`);
line(Object.keys(byTab).length === 6, "6 data tabs (pilot)", `stored ${Object.keys(byTab).length}`);
const sum = Object.values(byClass).reduce((a, b) => a + b, 0) + nonData;
line(counts?.sourceRows === sum, "source rows = classes + NON_DATA_ROW", `${counts?.sourceRows} vs ${sum}`);

// 2. Money in the stored rows recomputed independently (decisions.md section 8, Stage 2a).
let moneyMismatch = 0;
const paysBy = new Map<string, Array<{ amount: string | null; tdsStated: string | null }>>();
for (const p of payments) paysBy.set(p.record_uid, [...(paysBy.get(p.record_uid) ?? []), { amount: p.amount_received, tdsStated: p.tds_amount_stated }]);
for (const c of claims) {
  const m = computeMoney({
    bill: c.bill_amount as string | null,
    approved: c.approved_amount as string | null,
    copay: c.copay_amount as string | null,
    discountStated: null,
    payments: (paysBy.get(c.record_uid) ?? []).map((p) => ({ amount: p.amount, date: null, utr: null, tdsStated: p.tdsStated })),
    tdsRate: c.tds_rate_used ? { rate: String(c.tds_rate_used), source: "DEFAULT", ruleId: "R-T01" } : null,
  });
  const same = (stored: unknown, f: { value: InstanceType<typeof Money> | null }) =>
    (stored == null && f.value === null) || (stored != null && f.value !== null && new Money(String(stored)).equals(f.value.toFixed(2)));
  const paidMeaningOpen = c.source_tab === "TILL AUG 2023"; // N-0001: balance held back, see clean.ts
  if (!same(c.deduction_amount, m.deduction) || !same(c.tds_amount, m.totalTds) || (!paidMeaningOpen && !same(c.balance_amount, m.balance))) moneyMismatch++;
}
line(moneyMismatch === 0, "stored Deduction, Total TDS, Balance = recomputed", `${moneyMismatch} rows differ`);
const ex = computeMoney({
  bill: "120000",
  approved: "100000",
  copay: "5000",
  discountStated: "15000",
  payments: [{ amount: "90000", date: null, utr: null, tdsStated: "10000" }],
  tdsRate: { rate: "0.10", source: "DEFAULT", ruleId: "R-T01" },
});
line(
  ex.deduction.value?.toFixed(2) === "15000.00" && ex.totalTds.value?.toFixed(2) === "10000.00" && ex.balance.value?.toFixed(2) === "0.00",
  "worked example in code",
  "Deduction 15000, Total TDS 10000, Balance 0",
);

// 3. settled_amount = sum of payments.
let settledMismatch = 0;
for (const c of claims) {
  const ps = paysBy.get(c.record_uid) ?? [];
  const total = ps.length && ps.every((p) => p.amount !== null) ? ps.reduce((s, p) => s.plus(p.amount!), new Money(0)) : null;
  const stored = c.settled_amount == null ? null : new Money(String(c.settled_amount));
  if ((total === null) !== (stored === null) || (total && stored && !total.equals(stored))) settledMismatch++;
}
line(settledMismatch === 0, "settled_amount = sum of payments", `${settledMismatch} claims differ`);

// 4. No duplicates: one row per record key (also a unique index).
line(new Set(claims.map((c) => c.record_key)).size === claims.length, "no duplicate record keys", `${claims.length} rows`);

// 5. Database totals, to compare with the totals of an export (the export log is ADMIN/APPROVER
//    only, so the worker key cannot read it; compare in the portal or the exported file).
const dbTotals: Record<string, string> = {};
for (const k of ["bill_amount", "approved_amount", "copay_amount", "settled_amount", "deduction_amount", "balance_amount"])
  dbTotals[k] = claims.reduce((s, c) => (c[k] == null ? s : s.plus(String(c[k]))), new Money(0)).toFixed(2);
console.log(`database totals (${claims.length} rows): ${JSON.stringify(dbTotals)}`);
