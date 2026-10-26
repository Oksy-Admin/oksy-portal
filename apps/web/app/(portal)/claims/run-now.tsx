"use client";

import { useActionState } from "react";
import { Pill } from "../ui";
import { runNow, type RunResult } from "./actions";

type JobRow = {
  id: string;
  status: string;
  mode: string;
  requested_at: string;
  finished_at: string | null;
  error: string | null;
  result: string | null;
  counts: { sourceRows?: number; byClass?: Record<string, number> } | null;
  sync: { new: number; changed: number; unchanged: number; missing: number } | null;
};

const when = (v: string | null) => (v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

// The HMS pilot sheet's run panel: Run now (queues a job) and the last runs with counts only.
export function RunNow({ sheetKey, jobs, canRun }: { sheetKey: string; jobs: JobRow[]; canRun: boolean }) {
  const [state, action, pending] = useActionState<RunResult | null, FormData>(runNow, null);
  const busy = jobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING");
  return (
    <div className="card">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <strong>HMS Kottakkal, PRIVATE sheet</strong>
        <form action={action} style={{ display: "flex", gap: 8 }}>
          <input type="hidden" name="sheet_key" value={sheetKey} />
          <button className="btn" type="submit" name="mode" value="WRITE" disabled={!canRun || pending || busy}>
            Run now
          </button>
          <button className="btn secondary" type="submit" name="mode" value="DRY_RUN" disabled={!canRun || pending || busy}>
            Check only
          </button>
        </form>
        {state && <span className={state.ok ? "muted" : ""} role="status">{state.message}</span>}
        {busy && <span className="muted">A run is waiting or running. Refresh to see the result.</span>}
      </div>
      {jobs.length > 0 && (
        <table className="data" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Requested</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Result</th>
              <th>Rows</th>
              <th>New / changed / unchanged / missing</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{when(j.requested_at)}</td>
                <td>{j.mode === "DRY_RUN" ? "Check only" : "Read and write"}</td>
                <td>
                  <Pill value={j.status} />
                </td>
                <td className="muted">{j.result ?? j.error ?? "—"}</td>
                <td className="muted">
                  {j.counts?.sourceRows != null
                    ? `${j.counts.sourceRows} (${Object.entries(j.counts.byClass ?? {})
                        .map(([k, v]) => `${k} ${v}`)
                        .join(", ")})`
                    : "—"}
                </td>
                <td className="muted">{j.sync ? `${j.sync.new} / ${j.sync.changed} / ${j.sync.unchanged} / ${j.sync.missing}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
