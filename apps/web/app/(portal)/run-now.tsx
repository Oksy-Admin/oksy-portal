"use client";

import { useActionState } from "react";
import { runNowAction, type RunNowResult, type RunNowScope } from "./run-now-actions";

// One Run now button for the three levels: top bar (ALL), hospital row (HOSPITAL), scheme
// sheet (SHEET). "Running" while a run of that scope is queued or running; the database
// refuses a second run of the same sheet whatever this button shows.
export function RunNowButton({
  scope,
  hospitalCode,
  sheetKey,
  running = false,
  small = false,
  label = "Run now",
}: {
  scope: RunNowScope;
  hospitalCode?: string;
  sheetKey?: string;
  running?: boolean;
  small?: boolean;
  label?: string;
}) {
  const [state, action, pending] = useActionState<RunNowResult | null, FormData>(runNowAction, null);
  const busy = running || pending;
  return (
    <form action={action} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input type="hidden" name="scope" value={scope} />
      {hospitalCode && <input type="hidden" name="hospital_code" value={hospitalCode} />}
      {sheetKey && <input type="hidden" name="sheet_key" value={sheetKey} />}
      <button className={small ? "btn small" : "btn"} type="submit" disabled={busy} title={running ? "A run is queued or running" : undefined}>
        {pending ? "Queuing…" : running ? "Running" : label}
      </button>
      {state && (
        <span className={state.ok ? "muted" : ""} role="status" style={{ fontSize: 12 }}>
          {state.message}
        </span>
      )}
    </form>
  );
}
