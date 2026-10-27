import type { ReactNode } from "react";

export function PageHead({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
    </div>
  );
}

// Shown on a screen whose data does not exist yet. Never shows sample numbers.
export function NotBuilt({ milestone, children }: { milestone: string; children: ReactNode }) {
  return (
    <div className="notice warn" role="note">
      <strong>Comes in {milestone}.</strong>
      <span>{children}</span>
    </div>
  );
}

export function NoAccess({ title, who }: { title: string; who: string }) {
  return (
    <div className="card">
      <h1>{title}</h1>
      <p>Only {who} can open this page.</p>
    </div>
  );
}

// Table header from the mockups with an empty body until real rows exist.
export function EmptyTable({ columns, message }: { columns: string[]; message: string }) {
  return (
    <div className="card table-wrap" style={{ padding: 0 }}>
      <table className="data">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={columns.length} className="empty">
              {message}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const TONES: Record<string, string> = {
  OWNER: "tone-purple",
  ADMIN: "tone-green",
  APPROVER: "tone-amber",
  HELPER: "tone-purple",
  USER: "tone-grey",
  Pending: "tone-amber",
  ALLOW: "tone-green",
  DENY: "tone-red",
  REVIEW: "tone-amber",
  Active: "tone-green",
  Retired: "tone-grey",
  ACTIVE: "tone-green",
  STOPPED: "tone-grey",
  YES: "tone-green",
  HOLD: "tone-red",
  NA: "tone-grey",
  OK: "tone-green",
  ACCESS_PENDING: "tone-red",
  READ_FAILED: "tone-red",
  NOT_CHECKED: "tone-amber",
  "NOT READ": "tone-grey",
  CLEAN: "tone-green",
  AUTO_FIXED: "tone-blue",
  NEEDS_STAFF_INPUT: "tone-amber",
  SETTLED: "tone-green",
  APPROVED: "tone-blue",
  UNDER_PROCESSING: "tone-purple",
  UNDER_TREATMENT: "tone-purple",
  REJECTED: "tone-red",
  CANCELLED: "tone-grey",
  UNKNOWN: "tone-amber",
  QUEUED: "tone-amber",
  RUNNING: "tone-blue",
  SUCCEEDED: "tone-green",
  FAILED: "tone-red",
};

export function Pill({ value }: { value: string }) {
  return <span className={`pill ${TONES[value] ?? "tone-blue"}`}>{value}</span>;
}
