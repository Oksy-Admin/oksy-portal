// Re-runs mapping and cleaning on the LATEST stored snapshot, with no Google call and no
// write: counts per tab, class and rule, and the colours seen. Prints no cell value.
//   pnpm --filter @oksy/worker snapshot-analyse
import { cleanRow, detectDateOrder, isEmptyRow, parseDate } from "@oksy/rules";
import { dbFromEnv } from "../src/db.ts";
import { doctorAliasesFrom, HMS_CODE, HMS_HEADERS, hmsProfile } from "../src/hms-profile.ts";
import { reconcile } from "../src/reconcile.ts";
import { layoutOf, legendFrom, sourceRows, type RawTab } from "../src/sheet-data.ts";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const db = dbFromEnv();
const [snap] = await db.select<{ id: string; raw: RawTab[]; taken_at: string }>(`snapshots?hospital_code=eq.${HMS_CODE}&order=taken_at.desc&limit=1&select=id,raw,taken_at`);
if (!snap) throw new Error("no snapshot");
const kind = Object.fromEntries((await db.select<{ tab_name: string; kind: string }>(`sheet_tabs?select=tab_name,kind`)).map((t) => [t.tab_name, t.kind]));
const qs = await db.select<{ id: string; question_text: string; status: string }>(`questions?hospital_code=eq.${HMS_CODE}&question_type=eq.M&scope=eq.HOSPITAL&select=id,question_text,status`);
const conf = new Set((await db.select<{ question_id: string }>(`answers?outcome=eq.CONFIRMED&question_id=in.(${qs.map((q) => q.id).join(",")})&select=question_id`)).map((a) => a.question_id));
const legend = legendFrom(snap.raw.find((t) => kind[t.name] === "LEGEND"));
const profile = hmsProfile(legend, doctorAliasesFrom(qs.map((q) => ({ ...q, confirmed: conf.has(q.id) }))));
console.log(`snapshot ${snap.taken_at}; legend: ${JSON.stringify(legend)}; doctor aliases: ${Object.keys(profile.doctorAliases).length}`);
const data = snap.raw.filter((t) => kind[t.name] === "DATA");
const layouts = data.map((t) => layoutOf(t, HMS_HEADERS));
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const src = data.flatMap((t) => sourceRows(t, layouts.find((l) => l.tab === t.name)!).filter((r) => !isEmptyRow(r)));
const order = detectDateOrder(src.flatMap((r) => (["admission_date", "discharge_date", "payment_date", "casesheet_sent_date"] as const).map((f) => parseDate(r.cells[f], today).parts)));
const rows = src.map((r) => cleanRow(profile, r, { today, dateOrder: order }));
const rec = reconcile(data, layouts, rows);
console.log(`date order ${order}; reconciliation ${rec.result}; ${JSON.stringify(rec.counts.byClass)}`);
const colours: Record<string, Record<string, number>> = {};
const perTab: Record<string, Record<string, number>> = {};
rows.forEach((r, i) => {
  const colour = src[i]?.rowColour ?? "none";
  const c = (colours[r.tab] ??= {});
  c[colour] = (c[colour] ?? 0) + 1;
  const t = (perTab[r.tab] ??= {});
  t[`class:${r.rowClass}`] = (t[`class:${r.rowClass}`] ?? 0) + 1;
  for (const i of r.issues) if (!i.shadow && i.ruleId !== "R-C01") t[`${i.ruleId}:${i.field}`] = (t[`${i.ruleId}:${i.field}`] ?? 0) + 1;
  if (r.claim) t[`stage:${r.claim.claim_status}/${r.claim.status_source}`] = (t[`stage:${r.claim.claim_status}/${r.claim.status_source}`] ?? 0) + 1;
  for (const rule of new Set(r.changes.map((x) => x.ruleId))) t[`fix:${rule}`] = (t[`fix:${rule}`] ?? 0) + 1;
});
for (const [tab, m] of Object.entries(perTab)) console.log(`\n[${tab}] colours ${JSON.stringify(colours[tab])}\n  ${Object.entries(m).sort().map(([k, v]) => `${k}=${v}`).join("  ")}`);
const statusWords: Record<string, number> = {};
for (const r of src) { const w = r.cells.status_text?.text?.trim(); if (w) statusWords[w.toUpperCase().slice(0, 30)] = (statusWords[w.toUpperCase().slice(0, 30)] ?? 0) + 1; }
console.log(`\nstatus words seen (CLAIM STATUS column, word counts): ${JSON.stringify(statusWords)}`);
