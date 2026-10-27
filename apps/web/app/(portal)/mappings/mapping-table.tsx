"use client";

import { IGNORE_FIELD, offeredFields, type FieldDef } from "@oksy/rules/fields";
import { useState, useTransition } from "react";
import { FieldForm } from "../fields/fields-table";
import { approveMappingAction, approveVersionGroupAction, createFieldAndMapAction } from "./actions";

/** The dropdown value that opens the small "new field" form. Never stored. */
const NEW_FIELD = "__new__";

/** How a stored choice reads on the page. */
function choiceLabel(field: string | null, labels: Record<string, string>): string {
  if (field === IGNORE_FIELD) return "Ignore (not needed)";
  if (field === null) return "extra_fields (not decided yet)";
  return labels[field] ?? field;
}

export interface ColumnMappingItem {
  id: string;
  hospital_code: string;
  spreadsheet_id: string;
  tab_name: string;
  version_group: string;
  header_fp: string;
  source_header: string;
  source_column: number;
  canonical_field: string | null;
  confidence: number;
  method: string;
  status: "PROPOSED" | "APPROVED" | "RETIRED";
  approved_at: string | null;
}

export function MappingTable({
  items,
  hospitalNames,
  fields,
  canCreateFields,
}: {
  items: ColumnMappingItem[];
  hospitalNames: Record<string, string>;
  /** The mapping_fields list (Fields page). Only ACTIVE fields are offered for a new choice. */
  fields: FieldDef[];
  /** false while the field list is read from the code (migration 0028 not applied). */
  canCreateFields: boolean;
}) {
  const labels = Object.fromEntries(fields.map((f) => [f.key, f.label]));
  const hidden = new Set(fields.filter((f) => f.status !== "ACTIVE").map((f) => f.key));
  const offered = offeredFields(fields);
  const [newField, setNewField] = useState<{ id: string; label: string; type: string; aliases: string } | null>(null);
  const [filterHospital, setFilterHospital] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [onlyLowConfidence, setOnlyLowConfidence] = useState<boolean>(false);
  const [selectedFields, setSelectedFields] = useState<Record<string, string>>(
    Object.fromEntries(items.map((it) => [it.id, it.canonical_field ?? ""]))
  );
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const hospitals = [...new Set(items.map((i) => i.hospital_code))].sort();

  const filtered = items.filter((m) => {
    if (filterHospital !== "ALL" && m.hospital_code !== filterHospital) return false;
    if (filterStatus !== "ALL" && m.status !== filterStatus) return false;
    if (onlyLowConfidence && m.confidence >= 0.85 && m.status === "APPROVED") return false;
    return true;
  });

  // Group by hospital and header_fp
  const groups = new Map<string, ColumnMappingItem[]>();
  for (const m of filtered) {
    const key = `${m.hospital_code}::${m.spreadsheet_id}::${m.tab_name}::${m.header_fp}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  const handleFieldChange = (id: string, value: string) => {
    if (value === NEW_FIELD) {
      setNewField({ id, label: "", type: "text", aliases: "" });
      return; // the stored choice changes only when the new field is created
    }
    setSelectedFields((prev) => ({ ...prev, [id]: value }));
  };

  const handleApproveOne = (m: ColumnMappingItem) => {
    setMessage(null);
    startTransition(async () => {
      const field = selectedFields[m.id] || null;
      const res = await approveMappingAction(m.id, field);
      if (res.ok) {
        setMessage({ text: `Approved column "${m.source_header}" -> ${choiceLabel(field, labels)}`, ok: true });
      } else {
        setMessage({ text: res.error ?? "Failed to approve", ok: false });
      }
    });
  };

  const handleCreateAndMap = (m: ColumnMappingItem) => {
    if (!newField || newField.id !== m.id) return;
    setMessage(null);
    startTransition(async () => {
      const res = await createFieldAndMapAction(m.id, newField.label, newField.type, newField.aliases);
      if (res.ok) {
        setSelectedFields((prev) => ({ ...prev, [m.id]: res.key ?? "" }));
        setNewField(null);
        setMessage({ text: `Created field "${newField.label.trim()}" and mapped column "${m.source_header}" to it.`, ok: true });
      } else {
        setMessage({ text: res.error, ok: false });
      }
    });
  };

  const handleApproveGroup = (spreadsheetId: string, headerFp: string, groupName: string) => {
    setMessage(null);
    startTransition(async () => {
      const res = await approveVersionGroupAction(spreadsheetId, headerFp);
      if (res.ok) {
        setMessage({ text: `Approved ${res.count ?? 0} mappings for ${groupName}`, ok: true });
      } else {
        setMessage({ text: res.error ?? "Failed to approve group", ok: false });
      }
    });
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      {message && (
        <div className={`notice ${message.ok ? "tone-green" : "warn"}`} role="status">
          <span>{message.text}</span>
        </div>
      )}

      <div className="filters card">
        <label>
          Hospital
          <select value={filterHospital} onChange={(e) => setFilterHospital(e.target.value)}>
            <option value="ALL">All hospitals ({hospitals.length})</option>
            {hospitals.map((h) => (
              <option key={h} value={h}>
                {h} - {hospitalNames[h] ?? ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="ALL">All statuses</option>
            <option value="PROPOSED">PROPOSED only</option>
            <option value="APPROVED">APPROVED only</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginTop: 16 }}>
          <input
            type="checkbox"
            checked={onlyLowConfidence}
            onChange={(e) => setOnlyLowConfidence(e.target.checked)}
          />
          <strong>Review flags only (confidence &lt; 0.85 or PROPOSED)</strong>
        </label>
      </div>

      {groups.size === 0 ? (
        <div className="card empty">
          <p>No column mappings match the selected filters.</p>
        </div>
      ) : (
        [...groups.entries()].map(([groupKey, cols]) => {
          const first = cols[0];
          if (!first) return null;
          const hasProposed = cols.some((c) => c.status === "PROPOSED");
          // "Approve All" stores the saved proposals; a changed dropdown must be approved on its own row first.
          const unsaved = cols.filter((c) => c.status === "PROPOSED" && (selectedFields[c.id] ?? "") !== (c.canonical_field ?? "")).length;
          const ignoredCount = cols.filter((c) => c.canonical_field === IGNORE_FIELD).length;
          const lowConfCount = cols.filter((c) => c.confidence < 0.85).length;
          const hospName = hospitalNames[first.hospital_code] ?? first.hospital_code;

          return (
            <div key={groupKey} className="card stack" style={{ gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                    {hospName} ({first.hospital_code}) · Tab: <span className="pill">{first.tab_name}</span>
                  </h3>
                  <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
                    Version Group: <strong>{first.version_group}</strong> | Columns: {cols.length}
                    {ignoredCount > 0 ? ` (${ignoredCount} ignored)` : ""} |
                    {lowConfCount > 0 ? (
                      <span className="pill tone-amber" style={{ marginLeft: 6 }}>
                        {lowConfCount} low confidence
                      </span>
                    ) : (
                      <span className="pill tone-green" style={{ marginLeft: 6 }}>
                        All high confidence
                      </span>
                    )}
                  </div>
                </div>

                {hasProposed && (
                  <div style={{ textAlign: "right" }}>
                    <button
                      className="btn secondary"
                      onClick={() => handleApproveGroup(first.spreadsheet_id, first.header_fp, `${first.hospital_code} ${first.tab_name}`)}
                      disabled={isPending || unsaved > 0}
                    >
                      {isPending ? "Approving..." : "Approve All Proposed (G1)"}
                    </button>
                    {unsaved > 0 && (
                      <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                        {unsaved} changed column{unsaved === 1 ? "" : "s"}: press Approve on {unsaved === 1 ? "that row" : "those rows"} first
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>Col #</th>
                      <th>Source Header</th>
                      <th style={{ minWidth: 260 }}>Canonical Field Mapping</th>
                      <th>Confidence</th>
                      <th>Method</th>
                      <th>Status</th>
                      <th style={{ width: 100 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cols.map((m) => {
                      const curVal = selectedFields[m.id] ?? "";
                      const isLow = m.confidence < 0.85;

                      return (
                        <tr
                          key={m.id}
                          style={{
                            background: isLow && m.status === "PROPOSED" ? "rgba(255, 193, 7, 0.08)" : undefined,
                            opacity: curVal === IGNORE_FIELD ? 0.6 : undefined,
                          }}
                        >
                          <td className="muted">{m.source_column + 1}</td>
                          <td>
                            <strong>{m.source_header || <span className="muted">(blank header)</span>}</strong>
                          </td>
                          <td>
                            <select
                              value={curVal}
                              onChange={(e) => handleFieldChange(m.id, e.target.value)}
                              style={{ width: "100%", padding: "4px 8px", fontSize: "0.9rem" }}
                            >
                              <option value="">extra_fields (not decided yet)</option>
                              <option value={IGNORE_FIELD}>Ignore (not needed)</option>
                              {/* A hidden field stays visible only on a row that already has it. */}
                              {curVal && hidden.has(curVal) && <option value={curVal}>{labels[curVal]} (hidden)</option>}
                              {curVal && curVal !== IGNORE_FIELD && !(curVal in labels) && <option value={curVal}>{curVal} (not in the field list)</option>}
                              {offered.map((f) => (
                                <option key={f.key} value={f.key}>
                                  {f.label}
                                </option>
                              ))}
                              {canCreateFields && <option value={NEW_FIELD}>+ Create new field</option>}
                            </select>
                            {newField?.id === m.id && (
                              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                                <FieldForm draft={newField} onChange={(d) => setNewField({ id: m.id, ...d })} />
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button className="btn" style={{ padding: "4px 10px" }} disabled={isPending || !newField.label.trim()} onClick={() => handleCreateAndMap(m)}>
                                    Create and map
                                  </button>
                                  <button className="btn secondary" style={{ padding: "4px 10px" }} disabled={isPending} onClick={() => setNewField(null)}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`pill ${m.confidence >= 0.85 ? "tone-green" : "tone-amber"}`}>
                              {(m.confidence * 100).toFixed(0)}%
                            </span>
                          </td>
                          <td>
                            <span className="pill">{m.method}</span>
                          </td>
                          <td>
                            <span className={`pill ${m.status === "APPROVED" ? "tone-green" : "tone-amber"}`}>
                              {m.status}
                            </span>
                          </td>
                          <td>
                            <button
                              className="btn secondary"
                              style={{ padding: "4px 10px", fontSize: "0.85rem" }}
                              onClick={() => handleApproveOne(m)}
                              disabled={isPending}
                            >
                              {m.status === "APPROVED" ? "Update" : "Approve"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
