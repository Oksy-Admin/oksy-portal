// Phase 0b: store the answered HMS pilot workbook (run by hand, never in CI):
//   PILOT_OPEN_FILE=<path> pnpm --filter @oksy/google pilot-answers-store -- --dry-run
//   PILOT_OPEN_FILE=<path> pnpm --filter @oksy/google pilot-answers-store
// Reads the workbook once (read-only client, logged in google_events), then stores
// questions, answers, Discount 2 proposals (PROPOSED only), Golden Test Set v1 and the
// return-to-hospital questions. Re-running stores nothing new. Prints counts and codes
// only, never a patient name or a free-text answer. PILOT_OPEN_FILE is a local JSON file
// outside Git with the match patterns for the OPEN rows (it holds names, so never commit it).
import { readFileSync } from "node:fs";
import { createReadPath, makeLogger, readClientsFromEnv, toEventRows, type GoogleEvent, type TabPolicy } from "../src/index.ts";
import { answerRow, d2Row, goldenRow, HOSPITAL, parseWorkbook, questionRow, returnQuestions, HMS_PRIVATE, type OpenMatchers } from "./pilot-lib.ts";

const ANSWER_FILE = "1SWqX3N8Cs0VXfjiHwz9r3sZ1ez6ROm7sWibfz6DpNXE";
const dryRun = process.argv.includes("--dry-run");

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const openFile = process.env.PILOT_OPEN_FILE ?? "";
if (!key || !openFile) {
  console.log(`env SUPABASE_SERVICE_ROLE_KEY: ${key ? "set" : "MISSING"}; PILOT_OPEN_FILE: ${openFile ? "set" : "MISSING"}`);
  process.exit(2);
}
const raw = JSON.parse(readFileSync(openFile, "utf8")) as Record<string, string | string[]>;
const rx = (k: string) => new RegExp(String(raw[k]), "i");
const matchers: OpenMatchers = {
  approvedVsPayment: rx("approvedVsPayment"),
  tillAug2023PaidCell: rx("tillAug2023PaidCell"),
  partPayment: rx("partPayment"),
  doctor: rx("doctor"),
  quickCheckNotSure: raw.quickCheckNotSure as string[],
};

const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
async function db<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = (body as { code?: string } | null)?.code ?? "?";
    throw new Error(`database ${init.method ?? "GET"} ${path.split("?")[0]} failed: status ${res.status}, code ${code}`);
  }
  return body as T;
}
const insert = (table: string, rows: object[], extra = "") =>
  rows.length === 0
    ? Promise.resolve([] as Array<Record<string, string>>)
    : db<Array<Record<string, string>>>(`${table}${extra}`, { method: "POST", body: JSON.stringify(rows), headers: { Prefer: "return=representation" } });

// 1. Read once, log the read.
const events: Array<GoogleEvent & { at: string }> = [];
const read = createReadPath(readClientsFromEnv().sheets, makeLogger((e) => events.push(e)));
const tabs = await read.listTabs(ANSWER_FILE, {});
const saved: Record<string, TabPolicy> = Object.fromEntries(tabs.map((t) => [t.title, "ALLOW" as TabPolicy]));
const data = await read.readAllowedTabs(ANSWER_FILE, saved);
await db("google_events", { method: "POST", body: JSON.stringify(toEventRows(events)), headers: { Prefer: "return=minimal" } });
console.log(`read logged: ${events.length} google_events (${events.filter((e) => e.kind === "READ_TAB").length} READ_TAB of the answer workbook)`);

// 2. Parse.
const items = parseWorkbook(data, matchers);
const count = <T>(xs: T[], f: (x: T) => string) => [...xs.reduce((m, x) => m.set(f(x), (m.get(f(x)) ?? 0) + 1), new Map<string, number>())].map(([k, v]) => `${k} ${v}`).join(", ");
console.log(`questions parsed: ${items.length} | by tab: ${count(items, (i) => `T${i.tabNo}`)}`);
console.log(`outcomes: ${count(items, (i) => i.outcome ?? "NOT_ANSWERED")}`);
console.log(`status: ${count(items, (i) => i.status)}`);
console.log(`open items: ${count(items.filter((i) => i.open), (i) => `${i.open}`)}`);
console.log(`open by question: ${items.filter((i) => i.open).map((i) => `${i.qCode}=${i.open}`).join(", ")}`);
const dupCodes = items.length - new Set(items.map((i) => i.qCode)).size;
if (dupCodes) {
  console.log(`STOP: ${dupCodes} duplicate question codes`);
  process.exit(2);
}

// 3. What already exists (so a re-run stores nothing new).
const existingQ = await db<Array<{ id: string; q_code: string }>>(`questions?select=id,q_code&hospital_code=eq.${HOSPITAL}`);
const qId = new Map(existingQ.map((q) => [q.q_code, q.id]));
const existingA = await db<Array<{ id: string; source_tab: string; source_row: number }>>(`answers?select=id,source_tab,source_row&source_file_id=eq.${ANSWER_FILE}`);
const aId = new Map(existingA.map((a) => [`${a.source_tab}|${a.source_row}`, a.id]));
const existingD2 = await db<Array<{ tab_name: string; row_number: number }>>(`discount2_decisions?select=tab_name,row_number&spreadsheet_id=eq.${HMS_PRIVATE}`);
const d2Seen = new Set(existingD2.map((d) => `${d.tab_name}|${d.row_number}`));
const existingG = await db<Array<{ case_code: string }>>(`golden_tests?select=case_code&golden_set=eq.v1`);
const gSeen = new Set(existingG.map((g) => g.case_code));

const newQ = items.filter((i) => !qId.has(i.qCode));
const answered = items.filter((i) => i.outcome !== null);
const newA = answered.filter((i) => !aId.has(`${i.sourceTab}|${i.sourceRow}`));
const ret = returnQuestions(items).filter((r) => !qId.has(r.q_code));
console.log(`would store: questions ${newQ.length} (+ return-to-hospital ${ret.length}), answers ${newA.length}`);

if (dryRun) {
  // D2 and Golden counts need answer ids; count what would be built.
  const d2 = items.filter((i) => d2Row(i, "x") && !d2Seen.has(`${i.hmsTab}|${i.hmsRow}`));
  const g = items.filter((i) => i.outcome && goldenRow(i, "x") && !gSeen.has(goldenRow(i, "x")!.case_code));
  console.log(`would store: D2 proposals ${d2.length} (${count(d2, (i) => d2Row(i, "x")!.decision)}), golden tests ${g.length} (${count(g, (i) => goldenRow(i, "x")!.case_code.slice(0, 6))})`);
  // Answer wordings per tab (dropdown text only, cut to 40 characters; typed values and
  // notes are never printed) and the row references of the return-to-hospital questions.
  for (const t of [1, 2, 3, 4, 5, 6]) {
    const xs = items.filter((i) => i.tabNo === t && i.answerValue);
    console.log(`T${t} answer wordings: ${count(xs, (i) => `"${(i.answerValue ?? "").slice(0, 40)}"->${i.outcome}`)}`);
  }
  console.log(`part-payment items: ${items.filter((i) => i.open === "PART_PAYMENT").map((i) => `${i.qCode}@${i.hmsTab}:${i.hmsRow}="${(i.answerValue ?? "").slice(0, 30)}"`).join(", ")}`);
  console.log(`NORKA rows: ${items.filter((i) => i.tabNo === 3 && /norka/i.test(i.questionText)).length} mentioned, ${items.filter((i) => i.open === "NORKA_CONFLICT").length} conflict`);
  console.log(`return-to-hospital: ${returnQuestions(items).map((q) => `${q.q_code}@${q.tab_name ?? "-"}:${q.row_number ?? "-"}`).join(", ")}`);
  console.log("DRY RUN: nothing stored");
  process.exit(0);
}

// 4. Store questions, then answers.
for (const q of await insert("questions", newQ.map((i) => questionRow(i, ANSWER_FILE)))) qId.set(q.q_code!, q.id!);
for (const a of await insert("answers", newA.map((i) => answerRow(i, qId.get(i.qCode)!, ANSWER_FILE)))) aId.set(`${a.source_tab}|${a.source_row}`, a.id!);

// 5. Discount 2 proposals (PROPOSED by default; nothing confirmed).
const d2Rows = items
  .map((i) => (i.outcome ? d2Row(i, aId.get(`${i.sourceTab}|${i.sourceRow}`)!) : null))
  .filter((r): r is NonNullable<typeof r> => r !== null && !d2Seen.has(`${r.tab_name}|${r.row_number}`));
const d2 = await insert("discount2_decisions", d2Rows);

// 6. Golden Test Set v1.
const gRows = items
  .map((i) => (i.outcome ? goldenRow(i, aId.get(`${i.sourceTab}|${i.sourceRow}`)!) : null))
  .filter((r): r is NonNullable<typeof r> => r !== null && !gSeen.has(r.case_code));
const g = await insert("golden_tests", gRows);

// 7. Return-to-hospital questions (QUEUED; the Question Sheet shows at most 25, D-052).
const r = await insert(
  "questions",
  ret.map((q) => ({ ...q, hospital_code: HOSPITAL, status: "QUEUED", origin: "DAILY", spreadsheet_id: q.scope === "ROW" ? HMS_PRIVATE : null })),
);

console.log(`stored: questions ${newQ.length}, answers ${newA.length}, D2 proposals ${d2.length} (${count(d2, (x) => x.decision!)}), golden tests ${g.length}, return-to-hospital ${r.length} (${r.map((x) => x.q_code).join(", ")})`);
