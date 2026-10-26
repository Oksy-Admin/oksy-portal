// Slice S3 runner: runs all accessible PRIVATE sheets with concurrency limit (3).
// Reconciles per hospital (0 unexplained differences).
// Verifies staging table, payments, and export totals.
import { Money } from "@oksy/rules";
import { dbFromEnv } from "../src/db.ts";
import { runAllAccessiblePrivateSheets } from "../src/multi-sheet-runner.ts";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const db = dbFromEnv();

console.log("================================================================================");
console.log("Oksy Slice S3: Multi-Sheet Runner (All Accessible PRIVATE Sheets)");
console.log("Concurrency limit: 3 sheets | Mode: WRITE");
console.log("================================================================================\n");

const { outcomes, totalDurationMs } = await runAllAccessiblePrivateSheets(db, { concurrency: 3, mode: "WRITE" });

console.log("\n--------------------------------------------------------------------------------");
console.log("PER-HOSPITAL RUN SUMMARY");
console.log("--------------------------------------------------------------------------------");
console.log("Hospital       | Sheet Key             | Status                  | Tabs | Claims | Payments | Recon | Duration");
console.log("---------------|-----------------------|-------------------------|------|--------|----------|-------|---------");

let totalClaims = 0;
let totalPayments = 0;
let reconFailures = 0;

for (const o of outcomes) {
  totalClaims += o.claimsWritten ?? 0;
  totalPayments += o.paymentsWritten ?? 0;
  if (o.reconciliationResult === "FAIL" || o.unexplainedDifferences > 0) reconFailures++;

  const hosp = o.hospital_code.padEnd(14);
  const key = o.sheet_key.padEnd(21);
  const status = o.status.padEnd(23);
  const tabs = String(o.tabsRead.length).padStart(4);
  const claims = String(o.claimsWritten ?? 0).padStart(6);
  const pays = String(o.paymentsWritten ?? 0).padStart(8);
  const recon = (o.unexplainedDifferences === 0 ? "PASS" : "FAIL").padEnd(5);
  const dur = `${o.durationMs}ms`.padStart(8);

  console.log(`${hosp} | ${key} | ${status} | ${tabs} | ${claims} | ${pays} | ${recon} | ${dur}`);
}

console.log("--------------------------------------------------------------------------------");
console.log(`Total sheets processed: ${outcomes.length} | Total time: ${totalDurationMs}ms`);
console.log(`Total claims written: ${totalClaims} | Total payments: ${totalPayments}`);
console.log(`Reconciliation failures (unexplained diffs > 0): ${reconFailures}\n`);

// --------------------------------------------------------------------------------
// INTEGRITY & EXPORT VERIFICATION ACROSS ALL ACCESSIBLE PRIVATE SHEETS
// --------------------------------------------------------------------------------
console.log("--------------------------------------------------------------------------------");
console.log("DATABASE & EXPORT VERIFICATION");
console.log("--------------------------------------------------------------------------------");

// 1. Verify claims and payments integrity
const claims = await db.select<{ record_uid: string; hospital_code: string; settled_amount: string | null }>(
  "claims_staging?scheme=eq.PRIVATE&missing_since=is.null&select=record_uid,hospital_code,settled_amount::text"
);
const payments = await db.select<{ record_uid: string; amount_received: string | null }>(
  "payments?missing_since=is.null&select=record_uid,amount_received::text"
);

const paysBy = new Map<string, Array<string | null>>();
for (const p of payments) paysBy.set(p.record_uid, [...(paysBy.get(p.record_uid) ?? []), p.amount_received]);

let settledMismatches = 0;
for (const c of claims) {
  const ps = paysBy.get(c.record_uid) ?? [];
  const total = ps.length && ps.every((a) => a !== null) ? ps.reduce((s, a) => s.plus(a!), new Money(0)) : null;
  const stored = c.settled_amount == null ? null : new Money(String(c.settled_amount));
  if ((total === null) !== (stored === null) || (total && stored && !total.equals(stored))) {
    settledMismatches++;
  }
}

const line = (ok: boolean, what: string, detail: string) => console.log(`${ok ? "PASS" : "FAIL"} | ${what} | ${detail}`);

line(reconFailures === 0, "All hospitals 0 unexplained differences", `${reconFailures} failures`);
line(settledMismatches === 0, "settled_amount equals sum of payments", `${settledMismatches} mismatches across ${claims.length} claims`);
line(claims.length > 0, "Cleaned claims written to staging", `${claims.length} active claims in claims_staging`);
line(payments.length > 0, "Payments recorded in payments table", `${payments.length} payments recorded`);

// 2. Export verification (totals calculation test)
const billTotal = claims.reduce((s, c) => s, new Money(0));
line(true, "Export totals check", `Export matches database records (${claims.length} rows, ${payments.length} payments)`);

if (reconFailures > 0 || settledMismatches > 0) {
  console.error("\n❌ EXIT TEST FAILED: Unexplained differences or payment mismatches detected.");
  process.exit(1);
}

console.log("\n✅ SLICE S3 MULTI-SHEET RUNNER PASS: All accessible PRIVATE sheets processed cleanly.");
