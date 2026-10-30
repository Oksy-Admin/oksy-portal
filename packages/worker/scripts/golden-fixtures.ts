// Golden fixtures of the 3 pilot sheets (decision 31-Oct): per month tab, the header row and,
// per column, how many cells have each value shape (blank, date, number, ...). No cell value,
// patient name, phone or policy number is kept or printed. Read-only: one read of the ALLOW
// tabs per sheet (the robot's read scope), plus the hospital's header decisions.
//   node packages/worker/scripts/golden-fixtures.ts
import { writeFileSync } from "node:fs";
import { createReadPath, readClientsFromEnv, type TabPolicy } from "@oksy/google";
import { headerKey, valueShape, VALUE_SHAPES, type ValueShape } from "@oksy/rules";
import { dbFromEnv } from "../src/db.ts";
import { HMS_HEADERS, HMS_SHEET } from "../src/hms-profile.ts";
import { layoutOf, toRawTabs } from "../src/sheet-data.ts";

process.loadEnvFile(new URL("../../../apps/web/.env.local", import.meta.url).pathname);
const db = dbFromEnv();
const read = createReadPath(readClientsFromEnv().sheets, () => {});
const enc = encodeURIComponent;
const OUT = new URL("../../rules/test/fixtures/pilots/", import.meta.url);

const sheets = await db.select<{ hospital_code: string; scheme: string; spreadsheet_id: string }>(
  "hospital_sheets?sync=eq.YES&read_skip_reason=is.null&select=hospital_code,scheme,spreadsheet_id&order=hospital_code",
);
for (const sheet of sheets) {
  const tabRows = await db.select<{ tab_name: string; policy: TabPolicy; kind: string | null }>(
    `sheet_tabs?spreadsheet_id=eq.${enc(sheet.spreadsheet_id)}&missing_since=is.null&select=tab_name,policy,kind`,
  );
  const saved = Object.fromEntries(tabRows.map((t) => [t.tab_name, t.policy]));
  const dataTabs = new Set(tabRows.filter((t) => t.kind === "DATA").map((t) => t.tab_name));
  const raw = toRawTabs(await read.readAllowedTabs(sheet.spreadsheet_id, saved)).filter((t) => dataTabs.has(t.name));
  const extra = sheet.spreadsheet_id === HMS_SHEET ? HMS_HEADERS : {};

  const tabs = raw
    .map((t) => {
      const l = layoutOf(t, extra);
      const body = l.headerRow === null ? [] : t.rows.slice(l.headerRow + 1);
      return {
        tab: t.name,
        header_row: l.headerRow,
        columns: l.headers.map((header, column) => {
          const shapes = Object.fromEntries(VALUE_SHAPES.map((s) => [s, 0])) as Record<ValueShape, number>;
          for (const r of body) shapes[valueShape(r[column]?.[0])]++;
          return { column, header, shapes };
        }),
      };
    })
    .sort((a, b) => a.tab.localeCompare(b.tab));

  const decisions = (
    await db.select<{ scheme: string; header_key: string; canonical_field: string | null }>(
      `header_decisions?hospital_code=eq.${enc(sheet.hospital_code)}&withdrawn_at=is.null&select=scheme,header_key,canonical_field`,
    ).catch(() =>
      // Before migration 20261031100000 (no withdrawn_at yet): every row is in force.
      db.select<{ scheme: string; header_key: string; canonical_field: string | null }>(
        `header_decisions?hospital_code=eq.${enc(sheet.hospital_code)}&select=scheme,header_key,canonical_field`,
      ),
    )
  ).sort((a, b) => a.header_key.localeCompare(b.header_key));

  const fixture = { hospital_code: sheet.hospital_code, scheme: sheet.scheme, note: "Headers and value-shape counts only; no cell values.", tabs, decisions };
  const file = new URL(`${sheet.hospital_code}.json`, OUT);
  writeFileSync(file, `${JSON.stringify(fixture, null, 1)}\n`);
  const keys = new Set(tabs.flatMap((t) => t.columns.map((c) => headerKey(c.header)).filter(Boolean)));
  console.log(`${sheet.hospital_code}: ${tabs.length} tabs, ${keys.size} distinct headers, ${decisions.length} decisions -> ${file.pathname.split("/").slice(-2).join("/")}`);
}
