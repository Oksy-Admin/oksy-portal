// One-off Phase 0b step (run by hand, never in CI):
//   pnpm --filter @oksy/google pilot-answers-structure
// Reads the answered HMS pilot question workbook (owned by admin@oksy.in, robot = Editor,
// read here with the READ-ONLY client) and prints its STRUCTURE only: tab names, column
// headers, row counts, and the spread of short dropdown answers. Never prints a patient
// name, claim no or free-text note. Each Google call is logged in google_events.
// The full answers are stored only after migration 0005 is live (pilot-answers-store).
import { createReadPath, makeLogger, readClientsFromEnv, toEventRows, type GoogleEvent, type TabPolicy } from "../src/index.ts";

export const PILOT_ANSWERS_FILE = "1SWqX3N8Cs0VXfjiHwz9r3sZ1ez6ROm7sWibfz6DpNXE";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!key) {
  console.log("env SUPABASE_SERVICE_ROLE_KEY: MISSING");
  process.exit(2);
}

const events: Array<GoogleEvent & { at: string }> = [];
const read = createReadPath(readClientsFromEnv().sheets, makeLogger((e) => events.push(e)));

async function flushEvents(): Promise<void> {
  if (events.length === 0) return;
  const res = await fetch(`${base}/google_events`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(toEventRows(events.splice(0))),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    console.log(`google_events write failed: status ${res.status}, code ${body?.code ?? "?"}`);
    process.exit(2);
  }
}

// Our own question workbook: every tab is read except login-like names, which the policy
// code keeps DENY whatever is passed here.
const tabs = await read.listTabs(PILOT_ANSWERS_FILE, {});
const saved: Record<string, TabPolicy> = Object.fromEntries(tabs.map((t) => [t.title, "ALLOW" as TabPolicy]));
const data = await read.readAllowedTabs(PILOT_ANSWERS_FILE, saved);
await flushEvents();

const SHORT = 40;
for (const [tab, rows] of data) {
  const cells = rows.map((r) => r.map((c) => (c.formattedValue ?? "").trim()));
  const headerIdx = cells.findIndex((r) => r.filter((v) => v !== "").length >= 3);
  const header = (headerIdx >= 0 ? cells[headerIdx] : undefined) ?? [];
  const body = headerIdx >= 0 ? cells.slice(headerIdx + 1).filter((r) => r.some((v) => v !== "")) : [];
  console.log(`\n## tab "${tab}": ${rows.length} rows read, header at row ${headerIdx + 1}, ${body.length} data rows`);
  header.forEach((h, i) => {
    const values = body.map((r) => r[i] ?? "").filter((v) => v !== "");
    const distinct = new Map<string, number>();
    for (const v of values) distinct.set(v, (distinct.get(v) ?? 0) + 1);
    // Dropdown-like answer columns only: few distinct short values. Never names or notes.
    const isAnswer = /answer|eligible|final|status|yes|confirm|choose/i.test(h);
    const dropdown = isAnswer && distinct.size <= 12 && [...distinct.keys()].every((v) => v.length <= SHORT);
    const spread = dropdown ? " | " + [...distinct].map(([v, n]) => `${v}: ${n}`).join(", ") : "";
    console.log(`  col ${i + 1} "${h.slice(0, 60)}": ${values.length} filled${spread}`);
  });
}
