"use client";

import { useState, useTransition } from "react";
import { approveMappingAction, approveVersionGroupAction } from "./actions";

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

const CANONICAL_FIELDS = [
  "serial_no",
  "patient_name",
  "patient_ip_no",
  "policy_or_card_no",
  "preauth_or_claim_no",
  "insurer_name",
  "tpa_name",
  "admission_date",
  "discharge_date",
  "treatment_or_surgery",
  "department",
  "doctor_name",
  "room_no",
  "bill_amount",
  "claimed_amount",
  "approved_amount",
  "copay_amount",
  "deduction_amount",
  "discount_amount",
  "casesheet_sent_date",
  "courier_no",
  "followup_log",
  "status_text",
  "rejection_reason",
  "cancellation_reason",
  "payment_date",
  "payment_amount",
  "payment_utr",
  "tds_amount_stated",
  "remarks",
];

export function MappingTable({
  items,
  hospitalNames,
}: {
  items: ColumnMappingItem[];
  hospitalNames: Record<string, string>;
}) {
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
    setSelectedFields((prev) => ({ ...prev, [id]: value }));
  };

  const handleApproveOne = (m: ColumnMappingItem) => {
    setMessage(null);
    startTransition(async () => {
      const field = selectedFields[m.id] || null;
      const res = await approveMappingAction(m.id, field);
      if (res.ok) {
        setMessage({ text: `Approved column "${m.source_header}" -> ${field ?? "(extra_fields)"}`, ok: true });
      } else {
        setMessage({ text: res.error ?? "Failed to approve", ok: false });
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
                    Version Group: <strong>{first.version_group}</strong> | Columns: {cols.length} |
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
                  <button
                    className="btn secondary"
                    onClick={() => handleApproveGroup(first.spreadsheet_id, first.header_fp, `${first.hospital_code} ${first.tab_name}`)}
                    disabled={isPending}
                  >
                    {isPending ? "Approving..." : "Approve All Proposed (G1)"}
                  </button>
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
                        <tr key={m.id} style={{ background: isLow && m.status === "PROPOSED" ? "rgba(255, 193, 7, 0.08)" : undefined }}>
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
                              <option value="">(extra_fields - unmapped)</option>
                              {CANONICAL_FIELDS.map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
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
