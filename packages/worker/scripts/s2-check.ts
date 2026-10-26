// S2 exit test, read-only:
//   pnpm --filter @oksy/worker s2-check
// Checks Rule Library catalogue counts, status (ACTIVE vs PROPOSED vs RETIRED),
// and reconciliation integrity.
import { Money } from "@oksy/rules";
import { dbFromEnv } from "../src/db.ts";
import { HMS_CODE } from "../src/hms-profile.ts";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const db = dbFromEnv();
const line = (ok: boolean, what: string, detail: string) => console.log(`${ok ? "PASS" : "FAIL"} | ${what} | ${detail}`);

// 1. Check Rule Library counts
const rules = await db.select<{ rule_id: string; rule_type: string; title: string }>(
  "rules?select=rule_id,rule_type,title",
);
const versions = await db.select<{ rule_id: string; version: number; status: string }>(
  "rule_versions?select=rule_id,version,status",
);

const activeCatalogue = versions.filter((v) => v.status === "ACTIVE" && !v.rule_id.startsWith("R-H"));
const proposedCatalogue = versions.filter((v) => v.status === "PROPOSED" && !v.rule_id.startsWith("R-H"));
const retiredCatalogue = versions.filter((v) => v.status === "RETIRED");

console.log(`Rules in DB: ${rules.length}; Versions in DB: ${versions.length}`);
console.log(`Catalogue rules: ${activeCatalogue.length} ACTIVE, ${proposedCatalogue.length} PROPOSED, ${retiredCatalogue.length} RETIRED`);

line(rules.length >= 53, "At least 53 catalogue rules seeded", `${rules.length} rules found`);
line(activeCatalogue.length === 31, "31 ACTIVE catalogue rules", `found ${activeCatalogue.length}`);
line(proposedCatalogue.length === 16, "16 PROPOSED catalogue rules", `found ${proposedCatalogue.length}`);
line(retiredCatalogue.length === 6, "6 RETIRED catalogue rules", `found ${retiredCatalogue.length}`);

// 2. Reconciliation & Payments check for latest HMS run
const [latestJob] = await db.select<{
  id: string;
  summary: {
    reconciliation?: {
      counts?: { sourceRows: number; byClass: Record<string, number> };
      sums?: Record<string, { source: string; cleaned: string; unexplained: string }>;
      differences?: Array<{ check: string; count: number }>;
      result?: string;
    };
  };
}>(
  `jobs?sheet_key=eq.${HMS_CODE}%7CPRIVATE&status=eq.SUCCEEDED&mode=eq.WRITE&order=finished_at.desc&limit=1&select=id,summary`,
);

const rec = latestJob?.summary.reconciliation;
line(rec?.result === "PASS", "Latest HMS run reconciliation PASS", `result: ${rec?.result ?? "none"}`);
line((rec?.differences?.length ?? 0) === 0, "0 unexplained reconciliation differences", `${rec?.differences?.length ?? 0} differences`);

const claims = await db.select<{ record_uid: string; settled_amount: string | null }>(
  `claims_staging?hospital_code=eq.${HMS_CODE}&missing_since=is.null&select=record_uid,settled_amount::text`,
);
const payments = await db.select<{ record_uid: string; amount_received: string | null }>(
  `payments?hospital_code=eq.${HMS_CODE}&missing_since=is.null&select=record_uid,amount_received::text`,
);

const paysBy = new Map<string, Array<string | null>>();
for (const p of payments) paysBy.set(p.record_uid, [...(paysBy.get(p.record_uid) ?? []), p.amount_received]);

let settledDiff = 0;
for (const c of claims) {
  const ps = paysBy.get(c.record_uid) ?? [];
  const total = ps.length && ps.every((a) => a !== null) ? ps.reduce((s, a) => s.plus(a!), new Money(0)) : null;
  const stored = c.settled_amount == null ? null : new Money(String(c.settled_amount));
  if ((total === null) !== (stored === null) || (total && stored && !total.equals(stored))) settledDiff++;
}
line(settledDiff === 0, "settled_amount equals sum of payments", `${settledDiff} mismatches across ${claims.length} claims`);
