"use client";

import { deleteBlockReason, FIELD_TYPES, type FieldDef } from "@oksy/rules/fields";
import { useState, useTransition } from "react";
import { createFieldAction, deleteFieldAction, setFieldStatusAction, updateFieldAction, type FieldResult } from "./actions";

export interface FieldUsage {
  approved: number;
  proposed: number;
}

interface Draft {
  label: string;
  type: string;
  aliases: string;
}

const EMPTY: Draft = { label: "", type: "text", aliases: "" };

/** Label, type and aliases inputs, shared by Add and Edit. */
export function FieldForm({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  return (
    <div className="filters" style={{ alignItems: "flex-end" }}>
      <label>
        Label
        <input value={draft.label} maxLength={80} onChange={(e) => onChange({ ...draft, label: e.target.value })} placeholder="e.g. Balance Status" />
      </label>
      <label>
        Type
        <select value={draft.type} onChange={(e) => onChange({ ...draft, type: e.target.value })}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label style={{ flex: 1, minWidth: 220 }}>
        Aliases (headers, one per line or comma separated)
        <textarea rows={2} value={draft.aliases} onChange={(e) => onChange({ ...draft, aliases: e.target.value })} placeholder="Balance Status, Bal Status" />
      </label>
    </div>
  );
}

export function FieldsTable({ fields, usage, readOnly }: { fields: FieldDef[]; usage: Record<string, FieldUsage>; readOnly: boolean }) {
  const [adding, setAdding] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ key: string; draft: Draft } | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const used = (key: string) => (usage[key]?.approved ?? 0) + (usage[key]?.proposed ?? 0);
  const run = (fn: () => Promise<FieldResult>, done: string, after?: () => void) => {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setMessage({ text: done, ok: true });
        after?.();
      } else setMessage({ text: res.error, ok: false });
    });
  };

  const save = (f: FieldDef, d: Draft) => {
    // Changing the type of a field that columns already use: warn first.
    if (d.type !== f.data_type && used(f.key) > 0) {
      const ok = window.confirm(
        `"${f.label}" is used by ${used(f.key)} column(s). Changing its type from ${f.data_type} to ${d.type} changes how its existing data is read. Continue?`,
      );
      if (!ok) return;
    }
    run(() => updateFieldAction(f.key, d.label, d.type, d.aliases), `Saved "${d.label}" (key ${f.key} unchanged).`, () => setEditing(null));
  };

  const active = fields.filter((f) => f.status === "ACTIVE").length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {message && (
        <div className={`notice ${message.ok ? "tone-green" : "warn"}`} role="status">
          <span>{message.text}</span>
        </div>
      )}

      <div className="card stack" style={{ gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <strong>
            {fields.length} fields ({active} active, {fields.length - active} hidden)
          </strong>
          {!readOnly && !adding && (
            <button className="btn" onClick={() => setAdding(EMPTY)} disabled={isPending}>
              Add field
            </button>
          )}
        </div>
        {adding && (
          <div className="stack" style={{ gap: 8 }}>
            <FieldForm draft={adding} onChange={setAdding} />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                disabled={isPending || !adding.label.trim()}
                onClick={() => run(() => createFieldAction(adding.label, adding.type, adding.aliases), `Added "${adding.label.trim()}".`, () => setAdding(null))}
              >
                {isPending ? "Saving..." : "Save field"}
              </button>
              <button className="btn secondary" onClick={() => setAdding(null)} disabled={isPending}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Label</th>
              <th>Type</th>
              <th>Aliases</th>
              <th>Status</th>
              <th>Columns using it</th>
              <th style={{ minWidth: 220 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => {
              const n = used(f.key);
              const isEditing = editing?.key === f.key;
              const deleteBlock = deleteBlockReason(f, n);
              return (
                <tr key={f.key} style={{ opacity: f.status === "HIDDEN" ? 0.6 : undefined }}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    {isEditing ? (
                      <FieldForm draft={editing.draft} onChange={(d) => setEditing({ key: f.key, draft: d })} />
                    ) : (
                      <>
                        <strong>{f.label}</strong>
                        <div className="muted" style={{ fontSize: "0.8rem" }}>
                          key {f.key}
                          {f.is_core ? " · core" : ""}
                        </div>
                      </>
                    )}
                  </td>
                  <td>{isEditing ? null : <span className="pill">{f.data_type}</span>}</td>
                  <td style={{ fontSize: "0.85rem", maxWidth: 320 }}>{isEditing ? null : f.aliases.join(", ") || <span className="muted">none</span>}</td>
                  <td>
                    <span className={`pill ${f.status === "ACTIVE" ? "tone-green" : "tone-amber"}`}>{f.status}</span>
                  </td>
                  <td>
                    {n === 0 ? (
                      <span className="muted">0</span>
                    ) : (
                      <span title={`${usage[f.key]?.approved ?? 0} confirmed, ${usage[f.key]?.proposed ?? 0} proposed`}>
                        {n} ({usage[f.key]?.approved ?? 0} confirmed)
                      </span>
                    )}
                  </td>
                  <td>
                    {readOnly ? (
                      <span className="muted">read only</span>
                    ) : isEditing ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn" style={{ padding: "4px 10px" }} disabled={isPending} onClick={() => save(f, editing.draft)}>
                          Save
                        </button>
                        <button className="btn secondary" style={{ padding: "4px 10px" }} disabled={isPending} onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                        {f.is_core && <span className="muted" style={{ fontSize: "0.8rem" }}>Type of a core field is fixed.</span>}
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          className="btn secondary"
                          style={{ padding: "4px 10px" }}
                          disabled={isPending}
                          onClick={() => setEditing({ key: f.key, draft: { label: f.label, type: f.data_type, aliases: f.aliases.join(", ") } })}
                        >
                          Edit
                        </button>
                        <button
                          className="btn secondary"
                          style={{ padding: "4px 10px" }}
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => setFieldStatusAction(f.key, f.status === "ACTIVE" ? "HIDDEN" : "ACTIVE"),
                              f.status === "ACTIVE" ? `"${f.label}" is hidden: not offered for new mappings.` : `"${f.label}" is shown again.`,
                            )
                          }
                        >
                          {f.status === "ACTIVE" ? "Hide" : "Show"}
                        </button>
                        <button
                          className="btn secondary"
                          style={{ padding: "4px 10px" }}
                          disabled={isPending || deleteBlock !== null}
                          title={deleteBlock ?? "Delete this unused field"}
                          onClick={() => {
                            if (window.confirm(`Delete the field "${f.label}"? No column uses it.`)) run(() => deleteFieldAction(f.key), `Deleted "${f.label}".`);
                          }}
                        >
                          Delete
                        </button>
                        {deleteBlock && <span className="muted" style={{ fontSize: "0.8rem" }}>{deleteBlock}</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
