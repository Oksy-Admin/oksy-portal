"use client";

import { useState, useTransition } from "react";
import { Pill } from "../ui";
import {
  approveRuleVersion,
  createOrUpdateRuleAction,
  retireRuleAction,
} from "./actions";

export interface RuleRowData {
  rule_id: string;
  rule_type: "CHECK" | "PARAMETER";
  title: string;
  latest_version: {
    id: string;
    version: number;
    status: string;
    severity: string | null;
    tier: string | null;
    condition_text: string;
    action: string | null;
    needs_review: boolean;
    hospital_filter: string | null;
    scheme_filter: string | null;
    insurer_filter: string | null;
    parameter_name: string | null;
    parameter_value: number | null;
  } | null;
  shadow_count: number;
}

interface RuleTableProps {
  initialRules: RuleRowData[];
  canApprove: boolean;
}

export function RuleTable({ initialRules, canApprove }: RuleTableProps) {
  const [showReference, setShowReference] = useState(false);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  // Modal states
  const [modalMode, setModalMode] = useState<"ADD" | "EDIT" | null>(null);
  const [selectedRule, setSelectedRule] = useState<RuleRowData | null>(null);

  const filtered = initialRules.filter((r) => {
    const status = r.latest_version?.status ?? "PROPOSED";
    if (!showReference && status === "REFERENCE") return false;
    if (needsReviewOnly && !r.latest_version?.needs_review) return false;
    if (statusFilter !== "ALL" && status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const idMatch = r.rule_id.toLowerCase().includes(q);
      const titleMatch = r.title.toLowerCase().includes(q);
      if (!idMatch && !titleMatch) return false;
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

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createOrUpdateRuleAction(null, fd);
      setNotice(res.message);
      if (res.ok) setModalMode(null);
    });
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
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

        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={showReference}
              onChange={(e) => setShowReference(e.target.checked)}
            />
            Show reference items
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={needsReviewOnly}
              onChange={(e) => setNeedsReviewOnly(e.target.checked)}
            />
            Needs review
          </label>
        </div>
      </div>

      {notice && (
        <div className="notice" style={{ marginBottom: 12 }}>
          {notice}
        </div>
      )}

      {/* Filter controls */}
      <div className="filters" style={{ marginBottom: 16 }}>
        <label>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="PROPOSED">PROPOSED</option>
            <option value="DRAFT">DRAFT</option>
            <option value="REFERENCE">REFERENCE</option>
            <option value="RETIRED">RETIRED</option>
          </select>
        </label>

        <label style={{ flex: 1 }}>
          Search
          <input
            placeholder="Search rule ID or title"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {/* Rules table */}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Rule ID</th>
              <th>Type</th>
              <th>Title</th>
              <th>Version</th>
              <th>Status</th>
              <th>Severity</th>
              <th>Condition</th>
              <th>Review</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const v = r.latest_version;
              const status = v?.status ?? "PROPOSED";
              return (
                <tr key={r.rule_id}>
                  <td>
                    <code>{r.rule_id}</code>
                  </td>
                  <td>{r.rule_type}</td>
                  <td>
                    <strong>{r.title}</strong>
                  </td>
                  <td>v{v?.version ?? 1}</td>
                  <td>
                    <Pill value={status} />
                  </td>
                  <td>{v?.severity ?? "—"}</td>
                  <td style={{ maxWidth: 280 }} className="muted">
                    {v?.condition_text ?? "—"}
                  </td>
                  <td>
                    {v?.needs_review ? (
                      <span className="badge tone-amber" style={{ fontSize: 11, padding: "2px 6px" }}>
                        Needs review
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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

                      {canApprove && (status === "PROPOSED" || status === "REFERENCE" || status === "DRAFT") && v && (
                        <button
                          className="btn small"
                          type="button"
                          disabled={isPending}
                          onClick={() => handleApprove(v.id, r.rule_id)}
                        >
                          Activate
                        </button>
                      )}

                      {canApprove && status !== "RETIRED" && v && (
                        <button
                          className="btn small secondary"
                          type="button"
                          disabled={isPending}
                          onClick={() => handleRetire(v.id, r.rule_id)}
                        >
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
                <td colSpan={9} className="empty">
                  No rules match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 12 }}>
        Showing {filtered.length} of {initialRules.length} rules.
      </p>

      {/* Add / Edit Rule Modal */}
      {modalMode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div className="card" style={{ width: 550, maxWidth: "90vw", background: "var(--bg, #fff)" }}>
            <h3>{modalMode === "ADD" ? "Add Rule" : `Edit Rule: ${selectedRule?.rule_id} (creates new version)`}</h3>
            <form onSubmit={handleFormSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1 }}>
                  Rule ID
                  <input
                    name="rule_id"
                    defaultValue={selectedRule?.rule_id ?? ""}
                    placeholder="e.g. R-A15"
                    readOnly={modalMode === "EDIT"}
                    required
                  />
                </label>
                <label style={{ width: 140 }}>
                  Rule Type
                  <select name="rule_type" defaultValue={selectedRule?.rule_type ?? "CHECK"}>
                    <option value="CHECK">CHECK</option>
                    <option value="PARAMETER">PARAMETER</option>
                  </select>
                </label>
              </div>

              <label>
                Title
                <input
                  name="title"
                  defaultValue={selectedRule?.title ?? ""}
                  placeholder="e.g. Discharge date check"
                  required
                />
              </label>

              <label>
                Condition
                <textarea
                  name="condition_text"
                  defaultValue={selectedRule?.latest_version?.condition_text ?? ""}
                  placeholder="Describe when this rule triggers"
                  rows={2}
                  required
                />
              </label>

              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1 }}>
                  Severity
                  <select name="severity" defaultValue={selectedRule?.latest_version?.severity ?? "W"}>
                    <option value="E">E (Error)</option>
                    <option value="W">W (Warning)</option>
                    <option value="I">I (Info)</option>
                  </select>
                </label>
                <label style={{ flex: 1 }}>
                  Tier
                  <select name="tier" defaultValue={selectedRule?.latest_version?.tier ?? "C"}>
                    <option value="A">Tier A (Confirmed)</option>
                    <option value="B">Tier B (Standard)</option>
                    <option value="C">Tier C (Doubts)</option>
                    <option value="D">Tier D (Conflict)</option>
                  </select>
                </label>
                <label style={{ flex: 1 }}>
                  Status
                  <select
                    name="status"
                    defaultValue={canApprove ? "ACTIVE" : "PROPOSED"}
                  >
                    <option value="DRAFT">DRAFT</option>
                    <option value="PROPOSED">PROPOSED</option>
                    {canApprove && <option value="ACTIVE">ACTIVE</option>}
                    {canApprove && <option value="RETIRED">RETIRED</option>}
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setModalMode(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Rule Version"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
