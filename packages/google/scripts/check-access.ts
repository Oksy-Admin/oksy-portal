// M4 access check (brief A7.5), run by hand until the worker schedules it (M9):
//   pnpm --filter @oksy/google check-access                    PRIVATE sheets (the fast track)
//   pnpm --filter @oksy/google check-access -- --all           every SYNC = YES sheet
//   pnpm --filter @oksy/google check-access -- --sheet-key=HOSP32P000107|PRIVATE
// One metadata call per Google Sheet (spreadsheet ID only: no title, tabs or cells), result
// stored in hospital_sheets (access columns only), every call logged in google_events.
// SYNC = HOLD / NA rows and rows read under another hospital (D-046) are never called.
// Needs GOOGLE_SERVICE_ACCOUNT_KEY_B64, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// in apps/web/.env.local (values never printed).
import { accessStatusAfter, createReadPath, makeLogger, readClientsFromEnv, toEventRows, type GoogleEvent } from "../src/index.ts";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const names = ["GOOGLE_SERVICE_ACCOUNT_KEY_B64", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const n of names) console.log(`env ${n}: ${process.env[n] ? "set" : "MISSING"}`);
if (names.some((n) => !process.env[n])) process.exit(2);

const args = process.argv.slice(2);
const all = args.includes("--all");
const oneKey = args.find((a) => a.startsWith("--sheet-key="))?.split("=")[1];

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

interface Row {
  sheet_key: string;
  scheme: string;
  spreadsheet_id: string | null;
  sync: string;
  read_skip_reason: string | null;
  last_ok_at: string | null;
}

const scope = oneKey
  ? `sheet_key=eq.${encodeURIComponent(oneKey)}`
  : all
    ? "sheet_status=eq.LINKED"
    : "scheme=eq.PRIVATE";
const rows = (await db(
  `hospital_sheets?${scope}&missing_from_register_since=is.null&select=sheet_key,scheme,spreadsheet_id,sync,read_skip_reason,last_ok_at&order=sheet_key`,
)) as Row[];

const readable = rows.filter((r) => r.sync === "YES" && !r.read_skip_reason && r.spreadsheet_id);
const notRead = rows.filter((r) => !readable.includes(r));
console.log(`scope: ${oneKey ?? (all ? "all linked sheets" : "PRIVATE")} | rows ${rows.length} | to check ${readable.length} | never called ${notRead.length}`);
for (const r of notRead) console.log(`  not called: ${r.sheet_key} (${r.sync !== "YES" ? `SYNC = ${r.sync}` : (r.read_skip_reason ?? "no sheet")})`);

const events: Array<GoogleEvent & { at: string }> = [];
const read = createReadPath(readClientsFromEnv().sheets, makeLogger((e) => events.push(e)));

const byId = new Map<string, Row[]>();
for (const r of readable) byId.set(r.spreadsheet_id!, [...(byId.get(r.spreadsheet_id!) ?? []), r]);

const tally: Record<string, number> = { OK: 0, ACCESS_PENDING: 0, READ_FAILED: 0 };
const problems: string[] = [];
try {
  for (const [id, group] of byId) {
    const first = group[0]!;
    const result = await read.checkAccess({ spreadsheetId: id, sync: first.sync, readSkipReason: first.read_skip_reason });
    const everOk = group.some((r) => r.last_ok_at);
    const status = accessStatusAfter(result, everOk);
    const now = new Date().toISOString();
    const patch = result.ok
      ? { access_status: status, access_error: null, last_checked_at: now, last_ok_at: now }
      : { access_status: status, access_error: `${result.status ?? "no status"} ${result.reason}`, last_checked_at: now };
    await db(`hospital_sheets?spreadsheet_id=eq.${id}&sync=eq.YES&read_skip_reason=is.null`, {
      method: "PATCH",
      body: JSON.stringify(patch),
      headers: { Prefer: "return=minimal" },
    });
    tally[status] = (tally[status] ?? 0) + group.length;
    if (!result.ok) problems.push(`  ${status}: ${group.map((r) => r.sheet_key).join(", ")} (…${id.slice(-6)}, ${patch.access_error})`);
  }
} finally {
  // The log is written even if a later step failed, so every Google call is on record.
  if (events.length) {
    await db("google_events", { method: "POST", body: JSON.stringify(toEventRows(events)), headers: { Prefer: "return=minimal" } });
  }
  console.log(`Google calls: ${events.length}, logged in google_events`);
}

console.log(`result (rows): OK ${tally.OK} | ACCESS_PENDING ${tally.ACCESS_PENDING} | READ_FAILED ${tally.READ_FAILED}`);
for (const p of problems) console.log(p);
