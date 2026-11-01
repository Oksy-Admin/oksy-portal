"use client";

import { useMemo, useState, useTransition } from "react";
import type { CheckDefinition, DateBasis, ExistingCheckVersion, RuleAction as EngineRuleAction } from "@oksy/rules";
import { Pill } from "../ui";
import { approveRuleVersion, retireRuleAction } from "./actions";
import { RuleForm, type RuleFormInitial } from "./forms";
import { RuleUpload } from "./upload";

export interface RuleVersionData {
  id: string;
  version: number;
  status: string;
  severity: "E" | "W" | null;
  action: EngineRuleAction | null;
  staff_message: string | null;
  hospital_filter: string | null;
  scheme_filter: string | null;
  insurer_filter: string | null;
  valid_from: string | null;
  valid_to: string | null;
  date_basis: DateBasis | null;
  check_definition: CheckDefinition | null;
  parameter_name: string | null;
  parameter_value: number | null;
  needs_review: boolean;
}

export interface RuleRowData {
  rule_id: string;
  rule_type: "CHECK" | "PARAMETER";
  title: string;
  latest_version: RuleVersionData | null;
  /** Open issues from the last real run (the `issues` table), not this page's own test runs. */
  hits: number;
}

const STATUSES = ["ACTIVE", "PROPOSED", "DRAFT", "REFERENCE", "RETIRED"];

interface RuleTableProps {
  initialRules: RuleRowData[];
  hospitalOptions: Array<{ code: string; name: string }>;
  canEdit: boolean;
  canApprove: boolean;
}

export function RuleTable({ initialRules, hospitalOptions, canEdit, canApprove }: RuleTableProps) {
  const [showReference, setShowReference] = useState(false);
  const [schemeFilter, setSchemeFilter] = useState("ALL");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [hitsOnly, setHitsOnly] = useState(false);
  const [search, setSearch] = useState("");

  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<"ADD" | "EDIT" | "UPLOAD" | null>(null);
  const [selectedRule, setSelectedRule] = useState<RuleRowData | null>(null);

  const schemes = useMemo(
    () => [...new Set(initialRules.flatMap((r) => (r.latest_version?.scheme_filter ? [r.latest_version.scheme_filter] : [])))],
    [initialRules],
  );

  const existingRules: ExistingCheckVersion[] = useMemo(
    () =>
      initialRules
        .filter((r) => r.latest_version)
        .map((r) => ({
          ruleId: r.rule_id,
          version: r.latest_version!.version,
          type: r.rule_type,
          status: r.latest_version!.status,
          hospitalFilter: r.latest_version!.hospital_filter,
          schemeFilter: r.latest_version!.scheme_filter,
          insurerFilter: r.latest_version!.insurer_filter,
          checkDefinition: r.latest_version!.check_definition,
          parameterName: r.latest_version!.parameter_name,
          parameterValue: r.latest_version!.parameter_value != null ? String(r.latest_version!.parameter_value) : null,
        })),
    [initialRules],
  );

  const filtered = initialRules.filter((r) => {
    const v = r.latest_version;
    const status = v?.status ?? "PROPOSED";
    if (!showReference && status === "REFERENCE") return false;
    if (statusFilter !== "ALL" && status !== statusFilter) return false;
    if (severityFilter !== "ALL" && v?.severity !== severityFilter) return false;
    if (schemeFilter !== "ALL" && v?.scheme_filter !== schemeFilter) return false;
    if (hitsOnly && r.hits === 0) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.rule_id.toLowerCase().includes(q) && !r.title.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const handleApprove = (ruleVersionId: string, ruleId: string) => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("rule_version_id", ruleVersionId);
      fd.set("rule_id", ruleId);
      fd.set("activate", "true");
      const res = await approveRuleVersion(null, fd);
      setNotice(res.message);
    });
  };

  const handleRetire = (ruleVersionId: string, ruleId: string) => {
    if (!confirm(`Retire rule ${ruleId}?`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("rule_version_id", ruleVersionId);
      fd.set("rule_id", ruleId);
      const res = await retireRuleAction(null, fd);
      setNotice(res.message);
    });
  };

  const initialFor = (r: RuleRowData | null): RuleFormInitial | null => {
    if (!r?.latest_version) return null;
    const v = r.latest_version;
    return {
      ruleId: r.rule_id,
      ruleType: r.rule_type,
      title: r.title,
      severity: v.severity ?? "W",
      action: v.action ?? "ASK_STAFF",
      staffMessage: v.staff_message ?? "",
      hospitalFilter: v.hospital_filter,
      schemeFilter: v.scheme_filter,
      insurerFilter: v.insurer_filter,
      validFrom: v.valid_from,
      validTo: v.valid_to,
      dateBasis: v.date_basis,
      checkDefinition: v.check_definition && v.check_definition.kind === "SIMPLE" ? v.check_definition : null,
      parameterName: v.parameter_name,
      parameterValue: v.parameter_value,
    };
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {canEdit && (
            <button
              className="btn"
              type="button"
              onClick={() => {
                setSelectedRule(null);
                setModalMode("ADD");
              }}
            >
              + Add Rule
            </button>
          )}
          {canEdit && (
            <button className="btn secondary" type="button" onClick={() => setModalMode("UPLOAD")}>
              Upload
            </button>
          )}
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", fontSize: 14 }}>
          <input type="checkbox" checked={showReference} onChange={(e) => setShowReference(e.target.checked)} />
          Show reference items (code only)
        </label>
      </div>

      {notice && <div className="notice" style={{ marginBottom: 12 }}>{notice}</div>}

      <div className="filters" style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label>
          Scheme
          <select value={schemeFilter} onChange={(e) => setSchemeFilter(e.target.value)}>
            <option value="ALL">All schemes</option>
            {schemes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Severity
          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
            <option value="ALL">All severities</option>
            <option value="E">E (Error)</option>
            <option value="W">W (Warning)</option>
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={hitsOnly} onChange={(e) => setHitsOnly(e.target.checked)} />
          Only rules with open issues
        </label>
        <label style={{ flex: 1, minWidth: 180 }}>
          Search
          <input placeholder="Search rule ID or title" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Rule ID</th>
              <th>Title</th>
              <th>Version</th>
              <th>Status</th>
              <th>Severity</th>
              <th>Scope</th>
              <th>Action</th>
              <th>Hits (last run)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const v = r.latest_version;
              const status = v?.status ?? "PROPOSED";
              const scopeParts = [v?.hospital_filter, v?.scheme_filter, v?.insurer_filter].filter(Boolean);
              return (
                <tr key={r.rule_id}>
                  <td><code>{r.rule_id}</code></td>
                  <td><strong>{r.title}</strong></td>
                  <td>v{v?.version ?? 1}</td>
                  <td><Pill value={status} /></td>
                  <td>{v?.severity ?? "—"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{scopeParts.length > 0 ? scopeParts.join(" / ") : "All"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{v?.action ?? "—"}</td>
                  <td>{r.hits > 0 ? <span className="badge tone-amber" style={{ fontSize: 11, padding: "2px 6px" }}>{r.hits}</span> : "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {canEdit && status !== "REFERENCE" && (
                        <button
                          className="btn small secondary"
                          type="button"
                          onClick={() => {
                            setSelectedRule(r);
                            setModalMode("EDIT");
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {status === "REFERENCE" && <span className="muted" style={{ fontSize: 12 }}>Code only</span>}

                      {canApprove && (status === "PROPOSED" || status === "REFERENCE" || status === "DRAFT") && v && (
                        <button className="btn small" type="button" disabled={isPending} onClick={() => handleApprove(v.id, r.rule_id)}>
                          Activate
                        </button>
                      )}
                      {canApprove && status !== "RETIRED" && status !== "REFERENCE" && v && (
                        <button className="btn small secondary" type="button" disabled={isPending} onClick={() => handleRetire(v.id, r.rule_id)}>
                          Retire
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">No rules match the selected filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 12 }}>Showing {filtered.length} of {initialRules.length} rules.</p>

      {modalMode === "ADD" || modalMode === "EDIT" ? (
        <Modal title={modalMode === "ADD" ? "Add Rule" : `Edit ${selectedRule?.rule_id}: creates a new version`} onClose={() => setModalMode(null)}>
          <RuleForm
            mode={modalMode}
            initial={initialFor(selectedRule)}
            existingRules={existingRules}
            hospitalOptions={hospitalOptions}
            onCancel={() => setModalMode(null)}
            onDone={(msg) => {
              setModalMode(null);
              setNotice(msg);
            }}
          />
        </Modal>
      ) : null}

      {modalMode === "UPLOAD" && (
        <Modal title="Upload rules (CSV or Excel)" onClose={() => setModalMode(null)}>
          <RuleUpload
            onCancel={() => setModalMode(null)}
            onDone={(msg) => {
              setModalMode(null);
              setNotice(msg);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 100, overflow: "auto", padding: "40px 16px" }}>
      <div className="card" style={{ width: 680, maxWidth: "95vw", background: "var(--bg, #fff)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>{title}</h3>
          <button type="button" className="btn small secondary" onClick={onClose}>✕</button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}
