"use client";

import { useActionState, useState, useTransition } from "react";
import { type AccessTicks, type Role } from "@/lib/roles";
import { retireUserAction, saveAccessTicksAction, setUserRoleAction } from "./actions";

export function AddPersonForm({ callerRole }: { callerRole: Role }) {
  const [state, action, pending] = useActionState(setUserRoleAction, null);

  return (
    <form action={action} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <input
        name="email"
        type="email"
        placeholder="name@oksy.in"
        required
        style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: 4, minWidth: 220 }}
      />
      <input
        name="display_name"
        placeholder="Full name (optional)"
        style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: 4, minWidth: 180 }}
      />
      <select
        name="role"
        defaultValue="USER"
        style={{ padding: "8px 12px", border: "1px solid #ccc", borderRadius: 4 }}
      >
        <option value="USER">User (default)</option>
        {callerRole === "OWNER" && <option value="ADMIN">Admin</option>}
      </select>
      <button type="submit" className="btn" disabled={pending} style={{ padding: "8px 16px" }}>
        {pending ? "Adding…" : "Add Person"}
      </button>
      {state && (
        <span style={{ color: state.ok ? "green" : "red", fontSize: "0.9rem", width: "100%" }}>
          {state.message}
        </span>
      )}
    </form>
  );
}

export function ApprovalForm({
  email,
  displayName,
  callerRole,
}: {
  email: string;
  displayName: string | null;
  callerRole: Role;
}) {
  const [state, action, pending] = useActionState(setUserRoleAction, null);

  return (
    <form action={action} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="display_name" value={displayName ?? ""} />
      <select
        name="role"
        defaultValue="USER"
        disabled={pending}
        style={{ padding: "4px 8px", fontSize: "0.85rem", border: "1px solid #ccc", borderRadius: 4 }}
      >
        <option value="USER">User</option>
        {callerRole === "OWNER" && <option value="ADMIN">Admin</option>}
      </select>
      <button
        type="submit"
        className="btn"
        disabled={pending}
        style={{ padding: "4px 10px", fontSize: "0.85rem" }}
      >
        {pending ? "…" : "Approve"}
      </button>
      {state && !state.ok && <span style={{ color: "red", fontSize: "0.8rem" }}>{state.message}</span>}
    </form>
  );
}

export function RetireButton({ email, label = "Retire" }: { email: string; label?: string }) {
  const [state, action, pending] = useActionState(retireUserAction, null);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Are you sure you want to retire ${email}? They will lose access immediately.`)) {
          e.preventDefault();
        }
      }}
      style={{ display: "inline" }}
    >
      <input type="hidden" name="email" value={email} />
      <button
        type="submit"
        className="btn secondary"
        disabled={pending}
        style={{ padding: "4px 8px", fontSize: "0.85rem" }}
      >
        {pending ? "…" : label}
      </button>
      {state && !state.ok && <span style={{ color: "red", fontSize: "0.8rem" }}> {state.message}</span>}
    </form>
  );
}

type TickConfig = { key: keyof AccessTicks; label: string; page: string };

const ACCESS_TICK_CONFIG: TickConfig[] = [
  { page: "Dashboard", key: "dashboard_view", label: "View" },
  { page: "Dashboard", key: "dashboard_copy_reminders", label: "Copy reminders" },
  { page: "Hospitals", key: "hospitals_view", label: "View" },
  { page: "Hospitals", key: "hospitals_add_edit", label: "Add and edit" },
  { page: "Questions", key: "questions_view", label: "View" },
  { page: "Questions", key: "questions_mark_answered", label: "Mark answered" },
  { page: "Clean Data", key: "clean_data_view", label: "View" },
  { page: "Clean Data", key: "clean_data_download", label: "Download reports" },
  { page: "Rule Library", key: "rule_library_view", label: "View" },
  { page: "Rule Library", key: "rule_library_add_edit", label: "Add and edit" },
  { page: "Audit & Runs", key: "audit_runs_view", label: "View" },
];

export function AccessTicksModal({
  user,
  initialTicks,
  callerRole,
  canEdit,
}: {
  user: { email: string; displayName: string | null; role: string };
  initialTicks: AccessTicks;
  callerRole: Role;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [ticks, setTicks] = useState<AccessTicks>(initialTicks);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const toggle = (k: keyof AccessTicks) => {
    if (!canEdit) return;
    setTicks((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const handleSave = () => {
    startTransition(async () => {
      const res = await saveAccessTicksAction(user.email, ticks);
      setResult(res.message);
      if (res.ok) {
        setTimeout(() => setOpen(false), 800);
      }
    });
  };

  // Group by page for clear layout
  const pages = ["Dashboard", "Hospitals", "Questions", "Clean Data", "Rule Library", "Audit & Runs"];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn secondary"
        style={{ padding: "4px 8px", fontSize: "0.85rem" }}
      >
        Access ticks
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 620,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 24,
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Access Ticks</h2>
                <p style={{ margin: "4px 0 0", color: "#666", fontSize: "0.9rem" }}>
                  {user.displayName ? `${user.displayName} (${user.email})` : user.email} · Role: <strong>{user.role}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer" }}
              >
                ×
              </button>
            </div>

            {user.role === "OWNER" ? (
              <p style={{ padding: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 4 }}>
                The Owner has full access to all pages and actions. Access ticks cannot be restricted.
              </p>
            ) : user.role === "ADMIN" && callerRole !== "OWNER" ? (
              <p style={{ padding: 12, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4 }}>
                An Admin&apos;s access can only be modified by the Owner (Anoop Das).
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {pages.map((p) => {
                  const items = ACCESS_TICK_CONFIG.filter((c) => c.page === p);
                  return (
                    <div
                      key={p}
                      style={{
                        padding: 12,
                        background: "#fafafa",
                        border: "1px solid #eee",
                        borderRadius: 6,
                      }}
                    >
                      <strong style={{ display: "block", marginBottom: 6, fontSize: "0.95rem" }}>{p}</strong>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                        {items.map((item) => (
                          <label
                            key={item.key}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: "0.9rem",
                              cursor: canEdit ? "pointer" : "default",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(ticks[item.key])}
                              onChange={() => toggle(item.key)}
                              disabled={!canEdit || isPending}
                            />
                            {item.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {result && (
              <p style={{ marginTop: 12, color: result.includes("updated") ? "green" : "red", fontSize: "0.9rem" }}>
                {result}
              </p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn secondary"
                style={{ padding: "6px 14px" }}
              >
                Close
              </button>
              {canEdit && user.role !== "OWNER" && (
                <button
                  type="button"
                  onClick={handleSave}
                  className="btn"
                  disabled={isPending}
                  style={{ padding: "6px 14px" }}
                >
                  {isPending ? "Saving…" : "Save Changes"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
