import * as XLSX from "xlsx";
import { applyFilters, cleanFilters, EXPORT_COLUMNS, filtersForLog, TOTAL_COLUMNS, type Filterable } from "@/lib/claims/query";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { logTiming } from "@/lib/timing";

// Excel / CSV export of the cleaned claims (D-051, hard rule 10): ADMIN and APPROVER only,
// the same filters as the table, built on the server. The export is logged in export_runs
// (who, filters, row count, totals) BEFORE the file is sent; no log, no file.
// Totals use exact decimal strings; no floating point (hard rule 7).
const FETCH = 1000;

type Row = Record<string, unknown>;
// The part of the query builder used here (the full Supabase type is too deep for a column list built at run time).
type Query = Filterable<Query> & {
  order(col: string): Query;
  range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: { code: string } | null }>;
};

function addDecimal(a: string, b: string): string {
  // Fixed-point sum in paise with BigInt: exact for any INR amount.
  const toPaise = (s: string) => {
    const neg = s.startsWith("-");
    const [i = "0", f = ""] = s.replace("-", "").split(".");
    const v = BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
    return neg ? -v : v;
  };
  const p = toPaise(a) + toPaise(b);
  const abs = p < 0n ? -p : p;
  return `${p < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.join("|") : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Formula injection guard for spreadsheet apps; then RFC 4180 quoting.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(request: Request) {
  const started = performance.now();
  const me = await getMe();
  if (!can(me?.role, "see_cleaned_data")) return new Response("Only ADMIN or APPROVER can export.", { status: 403 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "XLSX" : "CSV";
  const f = cleanFilters(Object.fromEntries(url.searchParams));
  const supabase = await createClient();

  // Every matching row, in pages (numeric columns come back as strings: amounts stay exact).
  const rows: Row[] = [];
  const columns: string = EXPORT_COLUMNS.map((c) => (TOTAL_COLUMNS.includes(c as never) ? `${c}::text` : c)).join(",");
  for (let from = 0; ; from += FETCH) {
    const { data, error } = await applyFilters(supabase.from("claims_staging").select(columns) as unknown as Query, f)
      .order("source_tab")
      .order("source_row")
      .range(from, from + FETCH - 1);
    if (error) return new Response(`Export failed (code ${error.code}).`, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < FETCH) break;
  }

  const totals: Record<string, string> = {};
  for (const c of TOTAL_COLUMNS) totals[c] = rows.reduce((s, r) => (r[c] == null ? s : addDecimal(s, String(r[c]))), "0.00");

  const { error: logError } = await supabase
    .from("export_runs")
    .insert({ format, filters: filtersForLog(f), row_count: rows.length, totals });
  if (logError) return new Response(`Export not logged (code ${logError.code}); no file sent.`, { status: 500 });

  const stamp = new Date().toISOString().slice(0, 10);
  logTiming(`export ${format} rows=${rows.length}`, started);
  if (format === "XLSX") {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...EXPORT_COLUMNS],
      ...rows.map((r) => EXPORT_COLUMNS.map((c) => {
        const v = r[c];
        if (v == null) return null;
        if (Array.isArray(v)) return v.join("|");
        // Amounts as numbers so Excel can total them; identifiers stay text.
        return TOTAL_COLUMNS.includes(c as never) || /_(amount|pct)$/.test(c) ? Number(v) : typeof v === "object" ? JSON.stringify(v) : v;
      })),
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Claims");
    const totalsSheet = XLSX.utils.aoa_to_sheet([["column", "total"], ...Object.entries(totals), ["rows", rows.length]]);
    XLSX.utils.book_append_sheet(book, totalsSheet, "Totals");
    const buf = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="oksy-claims-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // CSV streamed row by row.
  const enc = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i === 0) controller.enqueue(enc.encode(`${EXPORT_COLUMNS.join(",")}\r\n`));
      const end = Math.min(i + 200, rows.length);
      for (; i < end; i++) controller.enqueue(enc.encode(`${EXPORT_COLUMNS.map((c) => csvCell(rows[i]![c])).join(",")}\r\n`));
      if (i >= rows.length) controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="oksy-claims-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
