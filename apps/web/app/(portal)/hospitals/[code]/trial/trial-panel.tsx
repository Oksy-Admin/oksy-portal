"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Pill } from "../../../ui";
import {
  acceptCheckSetClaimAction,
  approveRuleTrialAction,
  getRuleTrialResultAction,
  listCheckSetClaimsAction,
  pickCheckSetClaimAction,
  queueRuleTrialAction,
  searchClaimsForPickAction,
  type CheckSetRow,
  type ClaimOption,
  type RuleTrialSummaryData,
} from "./actions";

type TrialStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "STOPPED";
const TRIAL_IN_PROGRESS = (s: TrialStatus | null) => s === "QUEUED" || s === "RUNNING";

export function TrialPanel({
  hospitalCode,
  canRunTrial,
  canApprove,
  initialCheckSets,
}: {
  hospitalCode: string;
  canRunTrial: boolean;
  canApprove: boolean;
  initialCheckSets: CheckSetRow[];
}) {
  const [trialId, setTrialId] = useState<string | null>(null);
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [summary, setSummary] = useState<RuleTrialSummaryData | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!trialId || !TRIAL_IN_PROGRESS(status)) return;
    pollRef.current = setInterval(async () => {
      const res = await getRuleTrialResultAction(trialId);
      if (!res.ok) return;
      setStatus(res.status ?? null);
      if (res.status === "SUCCEEDED") {
        setSummary(res.summary ?? null);
        setApprovedAt(res.approvedAt ?? null);
      }
      if (res.status === "FAILED") setJobError(res.jobError ?? "The trial could not run.");
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [trialId, status]);

  const runTrial = () => {
    setSummary(null);
    setJobError(null);
    setApprovedAt(null);
    setQueueError(null);
    setStatus(null);
    startTransition(async () => {
      const res = await queueRuleTrialAction(hospitalCode);
      if (!res.ok) {
        setQueueError(res.error ?? "Could not queue the trial.");
        return;
      }
      setTrialId(res.id ?? null);
      setStatus("QUEUED");
    });
  };

  const [approveState, approveAction, approvePending] = useActionState(approveRuleTrialAction, null);

  const [checkSets, setCheckSets] = useState<CheckSetRow[]>(initialCheckSets);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<ClaimOption[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pickState, pickAction, pickPending] = useActionState(pickCheckSetClaimAction, null);
  const [acceptState, acceptAction, acceptPending] = useActionState(acceptCheckSetClaimAction, null);

  useEffect(() => {
    if (!pickState?.ok && !acceptState?.ok) return;
    startTransition(async () => {
      const res = await listCheckSetClaimsAction(hospitalCode);
      if (res.ok && res.rows) setCheckSets(res.rows);
      setOptions([]);
      setSearch("");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickState, acceptState]);

  const runSearch = () => {
    startTransition(async () => {
      const res = await searchClaimsForPickAction(hospitalCode, search);
      if (!res.ok) {
        setSearchError(res.error ?? "Could not search.");
        return;
      }
      setSearchError(null);
      setOptions(res.rows ?? []);
    });
  };

  return (
    <div className="stack">
      <div className="card">
        <h2>Rule trial</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Runs every active rule once against this hospital&apos;s stored claims. Writes no questions.
        </p>
        <button className="btn" type="button" onClick={runTrial} disabled={!canRunTrial || isPending || TRIAL_IN_PROGRESS(status)}>
          Run trial
        </button>
        {!canRunTrial && <p className="muted">Only Owner, Admin or a user with the Rule Library add/edit tick can run a trial.</p>}
        {queueError && <p role="alert">{queueError}</p>}
        {status && <Pill value={status} />}
        {status === "FAILED" && <p role="alert">{jobError}</p>}
        {summary && (
          <>
            <p>
              <strong>{summary.totalClaims}</strong> claims scanned, <strong>{summary.cleanClaims}</strong> clean.
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Severity</th>
                    <th>Claims hit</th>
                    <th>Examples</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(summary.byRule).map(([ruleId, s]) => (
                    <tr key={ruleId}>
                      <td>{ruleId}</td>
                      <td>{s.severity}</td>
                      <td>{s.hits}</td>
                      <td className="muted">{s.examples.map((e) => `${e.tab} row ${e.row}`).join(", ")}</td>
                    </tr>
                  ))}
                  {Object.keys(summary.byRule).length === 0 && (
                    <tr>
                      <td colSpan={4} className="empty">
                        No rule fired on any claim.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {approvedAt ? (
              <p className="muted">Trial approved {new Date(approvedAt).toLocaleString("en-IN")}.</p>
            ) : canApprove && trialId ? (
              <form action={approveAction} className="filters">
                <input type="hidden" name="trial_id" value={trialId} />
                <input type="hidden" name="hospital_code" value={hospitalCode} />
                <button className="btn" type="submit" disabled={approvePending}>
                  Approve trial
                </button>
                {approveState && !approveState.ok && <span role="alert">{approveState.message}</span>}
              </form>
            ) : null}
          </>
        )}
      </div>

      <div className="card">
        <h2>Check sets</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Claims known to be correct. After any mapping, rule or dictionary change, the next run is checked against them.
        </p>
        {checkSets.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Claim</th>
                  <th>Result</th>
                  <th>Detail</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {checkSets.map((c) => (
                  <tr key={c.id}>
                    <td>{c.claimNumber ?? c.recordUid}</td>
                    <td>
                      <Pill value={c.pass ? "Pass" : "Fail"} />
                    </td>
                    <td className="muted">
                      {c.changedFields.length > 0 && `Changed: ${c.changedFields.join(", ")}. `}
                      {c.openIssues.length > 0 && `Open: ${c.openIssues.map((i) => i.ruleId).join(", ")}.`}
                    </td>
                    <td>
                      {!c.pass && canApprove && (
                        <form action={acceptAction} className="filters" style={{ marginBottom: 0 }}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="hospital_code" value={hospitalCode} />
                          <input name="reason" placeholder="Reason" required disabled={acceptPending} />
                          <button className="btn secondary" type="submit" disabled={acceptPending}>
                            Accept new values
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No check-set claims picked yet.</p>
        )}
        {acceptState && !acceptState.ok && <p role="alert">{acceptState.message}</p>}

        {canApprove && checkSets.length < 5 && (
          <>
            <div className="filters">
              <input placeholder="Search claim number" value={search} onChange={(e) => setSearch(e.target.value)} disabled={isPending} />
              <button className="btn secondary" type="button" onClick={runSearch} disabled={isPending}>
                Search
              </button>
            </div>
            {searchError && <p role="alert">{searchError}</p>}
            {options.length > 0 && (
              <ul className="list-plain">
                {options.map((o) => (
                  <li key={o.recordUid}>
                    {o.claimNumber ?? o.recordUid} <span className="muted">({o.status})</span>{" "}
                    <form action={pickAction} style={{ display: "inline" }}>
                      <input type="hidden" name="record_uid" value={o.recordUid} />
                      <input type="hidden" name="hospital_code" value={hospitalCode} />
                      <button className="btn secondary" type="submit" disabled={pickPending}>
                        Pick
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            {pickState && !pickState.ok && <p role="alert">{pickState.message}</p>}
          </>
        )}
      </div>
    </div>
  );
}
