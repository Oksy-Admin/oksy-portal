"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { latestJobAction, runNow, type JobStatus, type RunResult } from "./actions";

const POLL_MS = 3000;

/** One plain status line (section 10: no manual refresh). */
function statusLine(job: JobStatus | null): string | null {
  if (!job) return null;
  if (job.status === "QUEUED") return "Queued — waiting for the runner.";
  if (job.status === "RUNNING") return "Running…";
  if (job.status === "SUCCEEDED") return "Finished.";
  if (job.status === "FAILED") return `Failed: ${job.error ?? "unknown error"}.`;
  if (job.status === "STOPPED") {
    if (job.result === "STOPPED_LAYOUT") {
      const n = job.layoutProblems?.length ?? 0;
      return `Stopped: ${n} header${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} a decision — open Column Mappings.`;
    }
    if (job.result === "STOPPED_RECONCILIATION") return "Stopped: the run's totals did not reconcile — check the run detail.";
    return `Stopped: ${job.error ?? job.result ?? "unknown reason"}.`;
  }
  return null;
}

// Run now / Check only for one hospital's sheet (claims page). Polls every ~3s while a run
// for this sheet is queued or running, so the button and status line update on their own —
// no manual refresh, and the button is never left stuck disabled after a run ends.
export function RunNow({
  hospitalName,
  sheetKey,
  initialJob,
  canRun,
}: {
  hospitalName: string;
  sheetKey: string;
  initialJob: JobStatus | null;
  canRun: boolean;
}) {
  const [state, action, pending] = useActionState<RunResult | null, FormData>(runNow, null);
  const [job, setJob] = useState<JobStatus | null>(initialJob);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const busy = job?.status === "QUEUED" || job?.status === "RUNNING";

  // Optimistic: the instant "Run now"/"Check only" is submitted, mark busy so polling starts
  // right away, without waiting for the first 3s tick. (Caller remounts with key={sheetKey}
  // on hospital change, so initialJob never needs re-syncing via an effect.)
  const onSubmit = () =>
    setJob((j) => ({
      ...(j ?? { id: "", mode: "WRITE", error: null, result: null, layoutProblems: null, requestedAt: new Date().toISOString(), finishedAt: null }),
      status: "QUEUED",
    }));

  useEffect(() => {
    if (!busy) {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
      return;
    }
    if (timer.current) return;
    timer.current = setInterval(() => {
      latestJobAction(sheetKey).then(setJob);
    }, POLL_MS);
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [busy, sheetKey]);

  const line = statusLine(job);

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <strong>{hospitalName}</strong>
        <form action={action} onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
          <input type="hidden" name="sheet_key" value={sheetKey} />
          <button className="btn" type="submit" name="mode" value="WRITE" disabled={!canRun || pending || busy}>
            Run now
          </button>
          <button className="btn secondary" type="submit" name="mode" value="DRY_RUN" disabled={!canRun || pending || busy}>
            Check only
          </button>
        </form>
        {line && <span className={job?.status === "SUCCEEDED" ? "muted" : ""} role="status">{line}</span>}
        {!line && state && <span className={state.ok ? "muted" : ""} role="status">{state.message}</span>}
      </div>
    </div>
  );
}
