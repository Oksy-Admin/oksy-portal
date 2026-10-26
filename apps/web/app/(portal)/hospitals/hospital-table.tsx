"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Pill } from "../ui";
import {
  saveHospitalSchemeAction,
  setHospitalStatusAction,
  triggerCheckAccessAction,
} from "./actions";

export type SheetRowData = {
  sheet_key: string;
  hospital_code: string;
  hospital_name: string;
  district: string;
  scheme: string;
  sheet_status: string;
  spreadsheet_id: string | null;
  sheet_url: string | null;
  sync: string;
  read_skip_reason: string | null;
  check_flag: string | null;
  access_status: string;
  access_error: string | null;
  last_checked_at: string | null;
  status: string;
  needs_review: boolean;
};

interface HospitalTableProps {
  initialRows: SheetRowData[];
  canEdit: boolean;
}

export function HospitalTable({ initialRows, canEdit }: HospitalTableProps) {
  const [showReference, setShowReference] = useState(false);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [schemeFilter, setSchemeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  // Modals state
  const [modalMode, setModalMode] = useState<"ADD" | "EDIT" | null>(null);
  const [activeRow, setActiveRow] = useState<SheetRowData | null>(null);

  const schemes = [...new Set(initialRows.map((r) => r.scheme))].sort();

  const filtered = initialRows.filter((r) => {
    if (!showReference && r.status === "REFERENCE") return false;
    if (needsReviewOnly && !r.needs_review) return false;
    if (schemeFilter !== "ALL" && r.scheme !== schemeFilter) return false;
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const codeMatch = r.hospital_code.toLowerCase().includes(q);
      const nameMatch = r.hospital_name.toLowerCase().includes(q);
      if (!codeMatch && !nameMatch) return false;
    }
    return true;
  });

  const handleCheckAccess = () => {
    startTransition(async () => {
      setNotice("Running access check in background...");
      const res = await triggerCheckAccessAction();
      setNotice(res.message);
    });
  };

  const handleSetInactive = (hospitalCode: string) => {
    if (!confirm(`Mark hospital ${hospitalCode} as Inactive?`)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("hospital_code", hospitalCode);
      fd.set("status", "INACTIVE");
      const res = await setHospitalStatusAction(null, fd);
      setNotice(res.message);
    });
  };

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveHospitalSchemeAction(null, fd);
      setNotice(res.message);
      if (res.ok) setModalMode(null);
    });
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {canEdit && (
            <>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setActiveRow(null);
                  setModalMode("ADD");
                }}
              >
                + Add Hospital & Scheme
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={isPending}
                onClick={handleCheckAccess}
              >
                {isPending ? "Checking access..." : "Check access"}
              </button>
            </>
          )}
        </div>

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
          Scheme
          <select value={schemeFilter} onChange={(e) => setSchemeFilter(e.target.value)}>
            <option value="ALL">All schemes</option>
            {schemes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
            <option value="REFERENCE">REFERENCE</option>
            <option value="STOPPED">STOPPED</option>
          </select>
        </label>

        <label style={{ flex: 1 }}>
          Search
          <input
            placeholder="Search hospital name or ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {/* Hospital table */}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>Hospital Name</th>
              <th>Hospital ID</th>
              <th>Scheme</th>
              <th>Google Sheet Link</th>
              <th>Status</th>
              <th>Access</th>
              <th>Review</th>
              {canEdit && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.sheet_key}>
                <td>{i + 1}</td>
                <td>
                  <strong>{r.hospital_name || "—"}</strong>
                </td>
                <td>
                  <Link href={`/hospitals/${r.hospital_code}`}>
                    <code>{r.hospital_code}</code>
                  </Link>
                </td>
                <td>{r.scheme}</td>
                <td>
                  {r.sheet_url ? (
                    <a
                      href={r.sheet_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      Open Sheet ↗
                    </a>
                  ) : (
                    <span className="muted">No link</span>
                  )}
                </td>
                <td>
                  <Pill value={r.status} />
                </td>
                <td>
                  <Pill value={r.sync !== "YES" ? "HOLD" : r.access_status} />
                </td>
                <td>
                  {r.needs_review ? (
                    <span className="badge tone-amber" style={{ fontSize: 11, padding: "2px 6px" }}>
                      Needs review
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>—</span>
                  )}
                </td>
                {canEdit && (
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn small secondary"
                        type="button"
                        onClick={() => {
                          setActiveRow(r);
                          setModalMode("EDIT");
                        }}
                      >
                        Edit
                      </button>
                      {r.status !== "INACTIVE" && (
                        <button
                          className="btn small secondary"
                          type="button"
                          onClick={() => handleSetInactive(r.hospital_code)}
                        >
                          Inactive
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 9 : 8} className="empty">
                  No hospitals match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 12 }}>
        Showing {filtered.length} of {initialRows.length} total hospital scheme records.
      </p>

      {/* Add / Edit Modal */}
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
          <div className="card" style={{ width: 500, maxWidth: "90vw", background: "var(--bg, #fff)" }}>
            <h3>{modalMode === "ADD" ? "Add Hospital & Scheme" : `Edit Hospital: ${activeRow?.hospital_code}`}</h3>
            <form onSubmit={handleFormSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              <label>
                Hospital ID (Code)
                <input
                  name="hospital_code"
                  defaultValue={activeRow?.hospital_code ?? ""}
                  placeholder="e.g. HOSP32P000107"
                  readOnly={modalMode === "EDIT"}
                  required
                />
              </label>

              <label>
                Hospital Name
                <input
                  name="hospital_name"
                  defaultValue={activeRow?.hospital_name ?? ""}
                  placeholder="e.g. Hearts Malabar"
                  required
                />
              </label>

              <label>
                District
                <input
                  name="district"
                  defaultValue={activeRow?.district ?? ""}
                  placeholder="e.g. MALAPPURAM"
                />
              </label>

              <label>
                Scheme
                <input
                  name="scheme"
                  defaultValue={activeRow?.scheme ?? "PRIVATE"}
                  placeholder="e.g. PRIVATE, MEDISEP, KASP"
                  required
                />
              </label>

              <label>
                Google Sheet Link (URL or ID)
                <input
                  name="sheet_url"
                  defaultValue={activeRow?.sheet_url ?? ""}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
              </label>

              <label>
                Status
                <select name="status" defaultValue={activeRow?.status ?? "ACTIVE"}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="REFERENCE">REFERENCE</option>
                  <option value="STOPPED">STOPPED</option>
                </select>
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setModalMode(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={isPending}>
                  {isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
