import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { NoAccess, PageHead, Pill } from "../ui";
import { withTiming } from "@/lib/timing";

interface ReconciliationRecord {
  id: string;
  job_id: string;
  hospital_code: string;
  sheet_key: string;
  created_at: string;
  result: "PASS" | "FAIL";
  counts: {
    sourceRows: number;
    byClass: Record<string, number>;
    perTab?: Record<string, { sourceRows: number; byClass: Record<string, number> }>;
    date_order?: string;
    layout_problems?: string[];
  };
  sums: Record<
    "bill" | "claimed" | "approved" | "copay" | "settled",
    { source: string; cleaned: string; explained: string; unexplained: string }
  >;
  differences: Array<{ check: string; count: number; detail: string }>;
}

// Reports & Reconciliation (file 02 section 5, file 04 section 5 slice S2).
// ADMIN and APPROVER only. Report totals must equal database totals.
// An unexplained reconciliation difference is a defect (hard rule).
async function ReportsPage() {
  const me = await getMe();
  if (!can(me?.role, "see_cleaned_data")) {
    return <NoAccess title="Reports & Reconciliation" who="ADMIN or APPROVER" />;
  }

  const supabase = await createClient();

  // Load latest reconciliations
  const { data: recData, error } = await supabase
    .from("reconciliations")
    .select("id, job_id, hospital_code, sheet_key, created_at, counts, sums, differences, result")
    .order("created_at", { ascending: false })
    .limit(10);

  const reconciliations = (recData as unknown as ReconciliationRecord[]) ?? [];
  const latest = reconciliations[0];

  return (
    <>
      <PageHead
        title="Reconciliation & Reports"
        subtitle="Batch audit verification: source rows vs cleaned row classes, financial sum integrity, and payments check (0 unexplained differences required before write)."
      />

      {error ? (
        <p role="alert">Could not load reconciliation records: {error.message}</p>
      ) : latest ? (
        <>
          {/* Latest Run Status Banner */}
          <div
            className="card"
            style={{
              marginBottom: 20,
              borderLeft: `5px solid ${latest.result === "PASS" ? "var(--color-green, #16a34a)" : "var(--color-red, #dc2626)"}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 style={{ margin: 0 }}>Latest Reconciliation: {latest.hospital_code}</h2>
                  <Pill value={latest.result === "PASS" ? "OK" : "HOLD"} />
                </div>
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  Sheet: <strong>{latest.sheet_key}</strong> | Run at:{" "}
                  {new Date(latest.created_at).toLocaleString("en-IN")}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  Unexplained Differences
                </span>
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 700,
                    color: latest.differences.length === 0 ? "var(--color-green, #16a34a)" : "var(--color-red, #dc2626)",
                  }}
                >
                  {latest.differences.length === 0 ? "0 (Clean)" : `${latest.differences.length} Defects`}
                </div>
              </div>
            </div>

            {/* Row Counts by Class */}
            <h3 style={{ margin: "16px 0 8px", fontSize: "1rem" }}>Row Counts (Source vs Cleaned)</h3>
            <div className="grid grid-5" style={{ gap: 10 }}>
              <div style={{ padding: "8px 12px", background: "var(--color-bg-subtle, #f9fafb)", borderRadius: 6 }}>
                <div className="muted" style={{ fontSize: "0.75rem" }}>Total Source Rows</div>
                <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{latest.counts.sourceRows}</div>
              </div>
              <div style={{ padding: "8px 12px", background: "var(--color-bg-subtle, #f9fafb)", borderRadius: 6 }}>
                <div className="muted" style={{ fontSize: "0.75rem" }}>Clean Rows</div>
                <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--color-green, #16a34a)" }}>
                  {latest.counts.byClass?.CLEAN ?? 0}
                </div>
              </div>
              <div style={{ padding: "8px 12px", background: "var(--color-bg-subtle, #f9fafb)", borderRadius: 6 }}>
                <div className="muted" style={{ fontSize: "0.75rem" }}>Auto-Fixed (Tier B)</div>
                <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--color-blue, #2563eb)" }}>
                  {latest.counts.byClass?.AUTO_FIXED ?? 0}
                </div>
              </div>
              <div style={{ padding: "8px 12px", background: "var(--color-bg-subtle, #f9fafb)", borderRadius: 6 }}>
                <div className="muted" style={{ fontSize: "0.75rem" }}>Needs Staff Input</div>
                <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--color-amber, #d97706)" }}>
                  {latest.counts.byClass?.NEEDS_STAFF_INPUT ?? 0}
                </div>
              </div>
              <div style={{ padding: "8px 12px", background: "var(--color-bg-subtle, #f9fafb)", borderRadius: 6 }}>
                <div className="muted" style={{ fontSize: "0.75rem" }}>Non-Data (Headers/Totals)</div>
                <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--color-grey, #6b7280)" }}>
                  {latest.counts.byClass?.NON_DATA_ROW ?? 0}
                </div>
              </div>
            </div>

            {/* Sums Check Table */}
            <h3 style={{ margin: "20px 0 8px", fontSize: "1rem" }}>Financial Integrity (Source vs Cleaned)</h3>
            <div className="table-wrap" style={{ padding: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Amount Field</th>
                    <th style={{ textAlign: "right" }}>Source Raw (₹)</th>
                    <th style={{ textAlign: "right" }}>Cleaned Output (₹)</th>
                    <th style={{ textAlign: "right" }}>Explained (₹)</th>
                    <th style={{ textAlign: "right" }}>Unexplained (₹)</th>
                    <th style={{ width: 90, textAlign: "center" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(["bill", "claimed", "approved", "copay", "settled"] as const).map((key) => {
                    const row = latest.sums?.[key] ?? {
                      source: "0.00",
                      cleaned: "0.00",
                      explained: "0.00",
                      unexplained: "0.00",
                    };
                    const isOk = row.unexplained === "0.00";
                    return (
                      <tr key={key}>
                        <td style={{ textTransform: "capitalize", fontWeight: 600 }}>{key} Amount</td>
                        <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                          {Number(row.source).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                          {Number(row.cleaned).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                          {Number(row.explained).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            fontFamily: "monospace",
                            fontWeight: 700,
                            color: isOk ? "inherit" : "var(--color-red, #dc2626)",
                          }}
                        >
                          {Number(row.unexplained).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <Pill value={isOk ? "OK" : "HOLD"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Discrepancies (if any) */}
            {latest.differences?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ margin: "0 0 6px", color: "var(--color-red, #dc2626)" }}>Unexplained Differences:</h4>
                <ul className="list-plain" style={{ paddingLeft: 0 }}>
                  {latest.differences.map((diff, i) => (
                    <li key={i} style={{ color: "var(--color-red, #dc2626)", fontSize: "0.9rem" }}>
                      • <strong>{diff.check}</strong>: {diff.detail} ({diff.count} items)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Historical Reconciliations */}
          <h3>Reconciliation History</h3>
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Run Date</th>
                  <th>Hospital</th>
                  <th>Sheet Key</th>
                  <th>Source Rows</th>
                  <th>Clean / Auto-fix / Needs Staff</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {reconciliations.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString("en-IN")}</td>
                    <td><strong>{r.hospital_code}</strong></td>
                    <td>{r.sheet_key}</td>
                    <td>{r.counts.sourceRows}</td>
                    <td>
                      {r.counts.byClass?.CLEAN ?? 0} / {r.counts.byClass?.AUTO_FIXED ?? 0} /{" "}
                      {r.counts.byClass?.NEEDS_STAFF_INPUT ?? 0}
                    </td>
                    <td>
                      <Pill value={r.result === "PASS" ? "OK" : "HOLD"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No reconciliation runs recorded yet. Reconciliations are generated automatically on every sheet run.
          </p>
        </div>
      )}
    </>
  );
}

export default withTiming("/reports", ReportsPage);
