import Link from "next/link";
import { applyFilters, CLASSES, cleanFilters, PAGE_SIZE, STAGES, TABLE_COLUMNS, type ClaimFilters, type Filterable } from "@/lib/claims/query";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { timed, withTiming } from "@/lib/timing";
import { NoAccess, PageHead, Pill } from "../ui";
import { latestJobAction } from "./actions";
import { RunNow } from "./run-now";

// Cleaned data view and export (module H, D-051). ADMIN and APPROVER only; read-only;
// every export is logged in export_runs. Claims and payments are separate tables (D-047).
// Server-side paging (50 rows) and database filters (file 04 section 6).

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
  const [list, hospitals, sheets] = await timed("claims queries", () =>
    Promise.all([
      applyFilters(supabase.from("claims_staging").select(SELECT, { count: "exact" }) as unknown as Query, f)
        .order("source_tab")
        .order("source_row")
        .range(from, from + PAGE_SIZE - 1),
      supabase.from("hospitals").select("hospital_code, hospital_name").is("missing_from_register_since", null).order("hospital_name"),
      supabase.from("hospital_sheets").select("sheet_key, hospital_code, spreadsheet_id").is("missing_from_register_since", null),
    ]),
  );
  const rows = list.data ?? [];
  const total = list.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Hospital dropdown (All / each hospital) replaces the old hard-coded HMS sheet key; Run
  // now, Check only, the Tab dropdown and the claims list all follow the selection (f.hospital).
  const hospitalRows = hospitals.data ?? [];
  const sheetRows = sheets.data ?? [];
  const hospitalNameByCode = new Map(hospitalRows.map((h) => [h.hospital_code, h.hospital_name]));
  // One sheet per hospital for the pilots (all PRIVATE scheme); the first linked sheet is used
  // if a hospital ever has more than one.
  const sheetByHospital = new Map<string, { sheet_key: string; spreadsheet_id: string | null }>();
  for (const s of sheetRows) if (!sheetByHospital.has(s.hospital_code)) sheetByHospital.set(s.hospital_code, s);
  const selectedSheet = f.hospital ? sheetByHospital.get(f.hospital) : undefined;

  // Tab dropdown: only the ALLOW/DATA tabs of the spreadsheet(s) in scope (the selected
  // hospital's sheet, or every linked sheet for "All"), deduplicated by tab name - this is
  // the fix for the duplicate-key console error (two hospitals both having a "CANCELLED" tab).
  const spreadsheetIds = [
    ...new Set((f.hospital ? sheetRows.filter((s) => s.hospital_code === f.hospital) : sheetRows).map((s) => s.spreadsheet_id).filter((id): id is string => !!id)),
  ];
  const tabsRes = spreadsheetIds.length
    ? await supabase.from("sheet_tabs").select("tab_name").eq("policy", "ALLOW").eq("kind", "DATA").in("spreadsheet_id", spreadsheetIds).order("tab_name")
    : { data: [] as Array<{ tab_name: string }> };
  const tabNames = [...new Set((tabsRes.data ?? []).map((t) => t.tab_name))].sort();

  const initialJob = selectedSheet ? await latestJobAction(selectedSheet.sheet_key) : null;

  // Stage 2c, decisions.md section 9: "every issue shows the rule's message with the values
  // involved (amounts and dates only, never names)" - detail is built that way already
  // (clean.ts / identity.ts never put a name in it), so it is safe to show as-is.
  const recordUids = rows.map((r) => String(r.record_uid));
  const issuesRes = recordUids.length
    ? await supabase.from("issues").select("record_uid, rule_id, detail, status").in("record_uid", recordUids).in("status", ["OPEN", "CONFIRMED"])
    : { data: [] };
  const issuesByRecord = new Map<string, Array<{ rule_id: string; detail: string | null; status: string }>>();
  for (const i of issuesRes.data ?? []) {
    const list = issuesByRecord.get(i.record_uid) ?? [];
    list.push({ rule_id: i.rule_id, detail: i.detail, status: i.status });
    issuesByRecord.set(i.record_uid, list);
  }
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

      {selectedSheet ? (
        <RunNow
          key={selectedSheet.sheet_key}
          hospitalName={hospitalNameByCode.get(f.hospital) ?? f.hospital}
          sheetKey={selectedSheet.sheet_key}
          initialJob={initialJob}
          canRun={can(me?.role, "approve_rules")}
        />
      ) : (
        <div className="card muted">
          {f.hospital
            ? "No sheet is linked for this hospital (see the Hospitals page)."
            : "Select a hospital above to Run now or Check only its sheet."}
        </div>
      )}

      {list.error && (
        <div className="notice warn" role="alert">
          <strong>Cannot load.</strong>
          <span>The cleaned data could not be read (code {list.error.code}). Migration 0008 may not be applied yet.</span>
        </div>
      )}

      <div className="card">
        <form className="filters" method="get">
          <label>
            Hospital
            <select name="hospital" defaultValue={f.hospital}>
              <option value="">All hospitals</option>
              {hospitalRows.map((h) => (
                <option key={h.hospital_code} value={h.hospital_code}>
                  {h.hospital_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tab
            <select name="tab" defaultValue={f.tab}>
              <option value="">All tabs</option>
              {tabNames.map((t) => (
                <option key={t} value={t}>
                  {t}
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
                <th>Deduction</th>
                <th>Total TDS</th>
                <th>Settled</th>
                <th>Balance</th>
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
                  <td className="num">{inr(r.deduction_amount)}</td>
                  <td className="num" title={r.tds_rate_source ? `TDS rate source: ${r.tds_rate_source}` : ""}>
                    {inr(r.tds_amount)}
                  </td>
                  <td className="num">{inr(r.settled_amount)}</td>
                  <td className="num">{inr(r.balance_amount)}</td>
                  <td title={`from ${r.status_source}`}>
                    <Pill value={String(r.claim_status)} />
                  </td>
                  <td>
                    <Pill value={String(r.row_class)} />
                  </td>
                  <td className="muted">
                    {(issuesByRecord.get(String(r.record_uid)) ?? []).map((i, idx) => (
                      <span key={`${i.rule_id}-${idx}`} title={i.detail ?? i.rule_id}>
                        {idx > 0 ? ", " : ""}
                        {i.rule_id}
                        {i.status === "CONFIRMED" ? " (confirmed)" : ""}
                      </span>
                    ))}
                  </td>
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
