import Link from "next/link";
import { applyFilters, CLASSES, cleanFilters, PAGE_SIZE, STAGES, TABLE_COLUMNS, type ClaimFilters, type Filterable } from "@/lib/claims/query";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { timed, withTiming } from "@/lib/timing";
import { NoAccess, PageHead, Pill } from "../ui";
import { RunNow } from "./run-now";

// Cleaned data view and export (module H, D-051). ADMIN and APPROVER only; read-only;
// every export is logged in export_runs. Claims and payments are separate tables (D-047).
// Server-side paging (50 rows) and database filters (file 04 section 6).
const HMS_SHEET_KEY = "HOSP32P000107|PRIVATE";

type Row = Record<(typeof TABLE_COLUMNS)[number], string | number | string[] | null>;
// The part of the query builder used here (the full Supabase type is too deep for a column list).
type Query = Filterable<Query> & {
  order(col: string): Query;
  range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: { code: string } | null; count: number | null }>;
};
const SELECT: string = TABLE_COLUMNS.join(",");

const inr = (v: unknown) => (v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const day = (v: unknown) => (v ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

async function ClaimsPage({ searchParams }: { searchParams: Promise<ClaimFilters> }) {
  const me = await getMe();
  if (!can(me?.role, "see_cleaned_data")) return <NoAccess title="Claims & Payments" who="ADMIN or APPROVER" />;
  const f = cleanFilters(await searchParams);
  const supabase = await createClient();

  const from = (f.page - 1) * PAGE_SIZE;
  const [list, jobs, tabs] = await timed("claims queries", () =>
    Promise.all([
      applyFilters(supabase.from("claims_staging").select(SELECT, { count: "exact" }) as unknown as Query, f)
        .order("source_tab")
        .order("source_row")
        .range(from, from + PAGE_SIZE - 1),
      supabase
        .from("jobs")
        .select("id, status, mode, requested_at, started_at, finished_at, error, summary->result, summary->reconciliation->counts, summary->sync")
        .eq("sheet_key", HMS_SHEET_KEY)
        .order("requested_at", { ascending: false })
        .limit(3),
      supabase.from("sheet_tabs").select("tab_name, kind").eq("policy", "ALLOW").eq("kind", "DATA").order("tab_name"),
    ]),
  );
  const rows = list.data ?? [];
  const total = list.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (over: Partial<Record<string, string | number>>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...over })) if (v !== "" && v != null && !(k === "page" && v === 1)) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const exportQs = (format: string) => {
    const p = new URLSearchParams(qs({ page: "" }).slice(1));
    p.set("format", format);
    return `/claims/export?${p.toString()}`;
  };

  return (
    <div className="stack">
      <PageHead
        title="Claims & Payments"
        subtitle="Cleaned claims from the staging database. Read-only; every export is logged."
        actions={
          <>
            <a className="btn secondary" href={exportQs("xlsx")}>
              Export Excel
            </a>
            <a className="btn secondary" href={exportQs("csv")}>
              Export CSV
            </a>
          </>
        }
      />

      <RunNow sheetKey={HMS_SHEET_KEY} jobs={(jobs.data ?? []) as unknown as Parameters<typeof RunNow>[0]["jobs"]} canRun={can(me?.role, "approve_rules")} />

      {list.error && (
        <div className="notice warn" role="alert">
          <strong>Cannot load.</strong>
          <span>The cleaned data could not be read (code {list.error.code}). Migration 0008 may not be applied yet.</span>
        </div>
      )}

      <div className="card">
        <form className="filters" method="get">
          <label>
            Tab
            <select name="tab" defaultValue={f.tab}>
              <option value="">All tabs</option>
              {(tabs.data ?? []).map((t) => (
                <option key={t.tab_name} value={t.tab_name}>
                  {t.tab_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Row class
            <select name="cls" defaultValue={f.cls}>
              <option value="">All</option>
              {CLASSES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Stage
            <select name="stage" defaultValue={f.stage}>
              <option value="">All</option>
              {STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1 }}>
            Search
            <input name="q" defaultValue={f.q} placeholder="Claim no or patient name" />
          </label>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Tab / row</th>
                <th>Claim no</th>
                <th>Patient</th>
                <th>Admission</th>
                <th>Insurer / TPA</th>
                <th>Bill</th>
                <th>Approved</th>
                <th>Copay</th>
                <th>Discount 1</th>
                <th>TDS</th>
                <th>Settled</th>
                <th>Discount 2</th>
                <th>Stage</th>
                <th>Row class</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.record_uid)}>
                  <td className="muted">
                    {r.source_tab} / {r.source_row}
                  </td>
                  <td>{r.preauth_or_claim_no ?? "—"}</td>
                  <td>{r.patient_name ?? "—"}</td>
                  <td>{day(r.admission_date)}</td>
                  <td>{[r.insurer_name, r.tpa_name].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="num">{inr(r.bill_amount)}</td>
                  <td className="num">{inr(r.approved_amount)}</td>
                  <td className="num">{inr(r.copay_amount)}</td>
                  <td className="num">{inr(r.discount_1_amount)}</td>
                  <td className="num" title={r.tds_rate_source ? `TDS rate source: ${r.tds_rate_source}` : ""}>
                    {inr(r.tds_amount)}
                  </td>
                  <td className="num">{inr(r.settled_amount)}</td>
                  <td className="num">{inr(r.discount_2_amount)}</td>
                  <td title={`from ${r.status_source}`}>
                    <Pill value={String(r.claim_status)} />
                  </td>
                  <td>
                    <Pill value={String(r.row_class)} />
                  </td>
                  <td className="muted">{(r.issue_codes as string[] | null)?.join(", ") || ""}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={15} className="empty">
                    {total === 0 && !f.q && !f.cls && !f.stage && !f.tab ? "No cleaned claims yet. Use Run now above." : "No claims match the filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span className="muted">
            {total === 0 ? "0 claims" : `${from + 1} to ${Math.min(from + PAGE_SIZE, total)} of ${total.toLocaleString("en-IN")} claims`}
          </span>
          {f.page > 1 && <Link href={`/claims${qs({ page: f.page - 1 })}`}>‹ Previous</Link>}
          {f.page < pages && <Link href={`/claims${qs({ page: f.page + 1 })}`}>Next ›</Link>}
        </div>
      </div>
    </div>
  );
}

export default withTiming("/claims", ClaimsPage);
