// One-off M3 read check (run by hand, never in CI):
//   pnpm --filter @oksy/google hms-list-tabs
// Lists the TAB NAMES of the HMS PRIVATE sheet only (metadata field mask, no cell values),
// stores each tab in sheet_tabs as a new tab (the database makes it REVIEW, or DENY for
// login-like names such as PORTAL LIST), and writes the call to google_events.
// Needs GOOGLE_SERVICE_ACCOUNT_KEY_B64, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// in apps/web/.env.local (values never printed). Reads no other sheet.
import { createReadPath, makeLogger, readClientsFromEnv, toEventRows, type GoogleEvent } from "../src/index.ts";

// HOSP32P000107 PRIVATE, register SHEET_REGISTRY REG NO 88, SYNC = YES (checked 24-Oct).
const HMS_PRIVATE = "1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const names = ["GOOGLE_SERVICE_ACCOUNT_KEY_B64", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const n of names) console.log(`env ${n}: ${process.env[n] ? "set" : "MISSING"}`);
if (names.some((n) => !process.env[n])) process.exit(2);

const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function db(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${base}/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = (body as { code?: string } | null)?.code ?? "?";
    throw new Error(`database ${init.method ?? "GET"} ${path.split("?")[0]} failed: status ${res.status}, code ${code}`);
  }
  return body;
}

const events: Array<GoogleEvent & { at: string }> = [];
const log = makeLogger((e) => events.push(e));
const read = createReadPath(readClientsFromEnv().sheets, log);

let tabs: Awaited<ReturnType<typeof read.listTabs>>;
try {
  tabs = await read.listTabs(HMS_PRIVATE, {}); // nothing saved yet: every tab is new
} catch (e) {
  const err = e as { code?: number; errors?: Array<{ reason?: string }> };
  console.log(`list failed: status ${err.code ?? "?"}, reason ${err.errors?.[0]?.reason ?? (e as Error).message}`);
  process.exit(2);
}

await db("google_events", { method: "POST", body: JSON.stringify(toEventRows(events)), headers: { Prefer: "return=minimal" } });
console.log(`logged ${events.length} event(s) in google_events`);

// Insert as new tabs without a policy: the database default (REVIEW) and its DENY rule decide.
await db("sheet_tabs?on_conflict=spreadsheet_id,tab_name", {
  method: "POST",
  body: JSON.stringify(tabs.map((t) => ({ spreadsheet_id: HMS_PRIVATE, tab_name: t.title }))),
  headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
});

const stored = (await db(
  `sheet_tabs?spreadsheet_id=eq.${HMS_PRIVATE}&select=tab_name,policy,kind,decided_by`,
)) as Array<{ tab_name: string; policy: string; kind: string | null; decided_by: string | null }>;
const byName = new Map(stored.map((r) => [r.tab_name, r]));
console.log("index | tab | hidden | code policy | stored policy");
for (const t of tabs) console.log(`${t.index} | ${t.title} | ${t.hidden} | ${t.policy} | ${byName.get(t.title)?.policy ?? "NOT STORED"}`);

const ev = (await db(
  `google_events?file_id=eq.${HMS_PRIVATE}&select=kind,tab_name,tab_count,row_count,at&order=at`,
)) as Array<{ kind: string; tab_name: string | null; tab_count: number | null; at: string }>;
console.log(`google_events for this sheet: ${ev.map((e) => `${e.kind}(${e.tab_count ?? e.tab_name ?? ""})`).join(", ")}`);
console.log(`READ_TAB events: ${ev.filter((e) => e.kind === "READ_TAB").length} (expected 0)`);
console.log(`events naming PORTAL LIST as read: ${ev.filter((e) => e.kind === "READ_TAB" && /portal\s*list/i.test(e.tab_name ?? "")).length} (expected 0)`);
