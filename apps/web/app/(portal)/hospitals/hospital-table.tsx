"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { Pill } from "../ui";
import { RunNowButton } from "../run-now";
import {
  saveHospitalProfileAction,
  saveHospitalSchemeAction,
  triggerCheckAccessAction,
  uploadHospitalListAction,
} from "./actions";

export type SchemeLink = {
  sheet_key: string;
  scheme: string;
  spreadsheet_id: string | null;
  sheet_url: string | null;
  sheet_status: string;
  sync: string;
  access_status: string;
  access_error: string | null;
  last_checked_at: string | null;
  last_ok_at?: string | null;
};

export type HospitalRowData = {
  hospital_key: string;
  hospital_code: string;
  hospital_name: string;
  district: string;
  status: string;
  other_names: string[];
  question_sheet_url: string | null;
  schemes: SchemeLink[];
};

interface HospitalTableProps {
  initialRows: HospitalRowData[];
  canEdit: boolean;
  /** Sheet keys with a run queued or running now. */
  running?: string[];
}

export function HospitalTable({ initialRows, canEdit, running = [] }: HospitalTableProps) {
  const [schemeFilter, setSchemeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ message: string; details?: string[] } | null>(null);

  // Modals state
  const [profileModalRow, setProfileModalRow] = useState<HospitalRowData | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Collect distinct schemes across all hospitals
  const allSchemes = Array.from(
    new Set(initialRows.flatMap((h) => h.schemes.map((s) => s.scheme)))
  ).sort();

  const filtered = initialRows.filter((r) => {
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (schemeFilter !== "ALL" && !r.schemes.some((s) => s.scheme === schemeFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      const codeMatch = r.hospital_code.toLowerCase().includes(q);
      const nameMatch = r.hospital_name.toLowerCase().includes(q);
      const otherNamesMatch = r.other_names.some((n) => n.toLowerCase().includes(q));
      if (!codeMatch && !nameMatch && !otherNamesMatch) return false;
    }
    return true;
  });

  const handleCheckAccess = () => {
    startTransition(async () => {
      setNotice({ message: "Running access check in background..." });
      const res = await triggerCheckAccessAction();
      setNotice({ message: res.message });
    });
  };

  const handleDownloadTemplate = () => {
    const csvContent =
      "Hospital ID,Hospital Name,Other Names,Status,Scheme,Google Sheet Link,Question Sheet Link\n" +
      'HOSPPVTP0001,"The Badagara Sahakarana Asupathri Ltd, Vadakara","Vadakara Co-operative Hospital; Badagara Sahakarana Asupathri",Active,Private,https://docs.google.com/spreadsheets/d/1-_vGLhW2hptEPDAVBnjN5tgZjJLHFWDq3d3zZobM-5g/edit,\n' +
      'HOSPPVTP0002,"Tree G Eye Care Hospital, Manjeri","Tree G Eye Hospital; Tree G Manjeri",Active,Private,https://docs.google.com/spreadsheets/d/1LvE15UQa1QjUPcT76ymrpBslvvEs-baHAEE33GEv-dI/edit,\n' +
      'HOSPPVTP0003,"HMS: Hearts Malabar Clinical Solutions Hospital, Kottakkal","HMS Hospital; Hearts Malabar Kottakkal",Active,Private,https://docs.google.com/spreadsheets/d/1fTY9k5dPbDaWRTXcRO71hT1bIXxQ1LnmYWbd7JiKOcQ/edit,\n';

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "hospital_upload_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleProfileSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveHospitalProfileAction(null, fd);
      setNotice({ message: res.message });
      if (res.ok) setProfileModalRow(null);
    });
  };

  const handleAddSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveHospitalSchemeAction(null, fd);
      setNotice({ message: res.message });
      if (res.ok) setIsAddModalOpen(false);
    });
  };

  const handleUploadSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await uploadHospitalListAction(null, fd);
      setNotice({ message: res.message, details: res.details });
      if (res.ok) setIsUploadModalOpen(false);
    });
  };

  return (
    <div className="card">
      {/* Top action bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {canEdit && (
            <>
              <button
                className="btn"
                type="button"
                onClick={() => setIsAddModalOpen(true)}
              >
                + Add Hospital
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => setIsUploadModalOpen(true)}
              >
                Upload Hospital List
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={handleDownloadTemplate}
              >
                Download Template
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={isPending}
                onClick={handleCheckAccess}
              >
                {isPending ? "Checking access..." : "Check Access"}
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className="notice" style={{ marginBottom: 12 }}>
          <div>{notice.message}</div>
          {notice.details && notice.details.length > 0 && (
            <ul style={{ margin: "6px 0 0 16px", fontSize: 13 }}>
              {notice.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Filter controls */}
      <div className="filters" style={{ marginBottom: 16 }}>
        <label>
          Scheme
          <select value={schemeFilter} onChange={(e) => setSchemeFilter(e.target.value)}>
            <option value="ALL">All schemes</option>
            {allSchemes.map((s) => (
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
            <option value="STOPPED">STOPPED</option>
          </select>
        </label>

        <label style={{ flex: 1 }}>
          Search
          <input
            placeholder="Search by hospital name, other names, or ID"
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
              <th>Hospital ID</th>
              <th>Hospital Name & Aliases</th>
              <th>Schemes & Sheets</th>
              <th>Question Sheet</th>
              <th>Robot Access</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const accessStatuses = r.schemes.map((s) => s.access_status);
              const overallAccess = accessStatuses.includes("READ_FAILED")
                ? "READ_FAILED"
                : accessStatuses.includes("ACCESS_PENDING")
                  ? "ACCESS_PENDING"
                  : accessStatuses.includes("OK")
                    ? "OK"
                    : "NOT_CHECKED";

              return (
                <tr key={r.hospital_key}>
                  <td>{i + 1}</td>
                  <td>
                    <code>{r.hospital_code}</code>
                  </td>
                  <td>
                    <div>
                      <strong>{r.hospital_name || "—"}</strong>
                    </div>
                    {r.other_names && r.other_names.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {r.other_names.map((alias, aIdx) => (
                          <span
                            key={aIdx}
                            style={{
                              fontSize: 11,
                              background: "rgba(0, 0, 0, 0.05)",
                              padding: "2px 6px",
                              borderRadius: 4,
                            }}
                          >
                            {alias}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.schemes.length === 0 ? (
                      <span className="muted">No schemes</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {r.schemes.map((s) => (
                          <div key={s.sheet_key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                            <span style={{ fontWeight: 500 }}>{s.scheme}:</span>
                            {s.sheet_url ? (
                              <a
                                href={s.sheet_url}
                                target="_blank"
                                rel="noreferrer"
                                style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
                              >
                                Sheet ↗
                              </a>
                            ) : (
                              <span className="muted">No link</span>
                            )}
                            {s.sync === "YES" && s.spreadsheet_id && (
                              <RunNowButton scope="SHEET" sheetKey={s.sheet_key} running={running.includes(s.sheet_key)} small label="Run sheet" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.question_sheet_url ? (
                      <a
                        href={r.question_sheet_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        Open Sheet ↗
                      </a>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>Not created</span>
                    )}
                  </td>
                  <td>
                    <Pill value={overallAccess} />
                  </td>
                  <td>
                    <Pill value={r.status} />
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      {canEdit && (
                        <button
                          className="btn small secondary"
                          type="button"
                          onClick={() => setProfileModalRow(r)}
                        >
                          Edit Profile
                        </button>
                      )}
                      <RunNowButton
                        scope="HOSPITAL"
                        hospitalCode={r.hospital_code}
                        running={r.schemes.some((s) => running.includes(s.sheet_key))}
                        small
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: "24px", color: "var(--color-muted)" }}>
                  No hospitals match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: "var(--color-muted)" }}>
        Showing {filtered.length} of {initialRows.length} total hospitals.
      </div>

      {/* Edit Hospital Profile Modal */}
      {profileModalRow && (
        <div className="modal-backdrop" onClick={() => setProfileModalRow(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <h3 style={{ marginTop: 0 }}>Edit Hospital Profile</h3>
            <p style={{ fontSize: 12, color: "var(--color-muted)", marginTop: -8 }}>
              Internal key: <code>{profileModalRow.hospital_key}</code> (permanent; ID and name can be changed at any time without losing claims).
            </p>

            <form onSubmit={handleProfileSubmit} className="stack">
              <input type="hidden" name="hospital_key" value={profileModalRow.hospital_key} />

              <label>
                Hospital ID (Code)
                <input
                  name="hospital_code"
                  defaultValue={profileModalRow.hospital_code}
                  required
                  placeholder="e.g. HOSPPVTP0001"
                />
              </label>

              <label>
                Hospital Name
                <input
                  name="hospital_name"
                  defaultValue={profileModalRow.hospital_name}
                  required
                  placeholder="Full hospital name"
                />
              </label>

              <label>
                Other Names (Aliases, separated by ;)
                <input
                  name="other_names"
                  defaultValue={profileModalRow.other_names.join("; ")}
                  placeholder="e.g. Name One; Name Two"
                />
              </label>

              <label>
                Status
                <select name="status" defaultValue={profileModalRow.status}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="STOPPED">STOPPED</option>
                </select>
              </label>

              <label>
                Question Sheet Link
                <input
                  name="question_sheet_url"
                  defaultValue={profileModalRow.question_sheet_url ?? ""}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
              </label>

              <label>
                Reason for ID change (if changing Hospital ID)
                <input
                  name="reason"
                  placeholder="e.g. Corrected hospital code prefix"
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setProfileModalRow(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={isPending}>
                  {isPending ? "Saving..." : "Save Profile"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Hospital Modal */}
      {isAddModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsAddModalOpen(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h3 style={{ marginTop: 0 }}>Add Hospital & Scheme</h3>
            <form onSubmit={handleAddSubmit} className="stack">
              <label>
                Hospital ID (Code)
                <input
                  name="hospital_code"
                  required
                  placeholder="e.g. HOSPPVTP0004"
                />
              </label>

              <label>
                Hospital Name
                <input
                  name="hospital_name"
                  required
                  placeholder="Full hospital name"
                />
              </label>

              <label>
                District
                <input
                  name="district"
                  placeholder="e.g. KOZHIKODE"
                />
              </label>

              <label>
                Scheme
                <select name="scheme" defaultValue="PRIVATE">
                  <option value="PRIVATE">PRIVATE (Private Health Insurance)</option>
                  <option value="KASP">KASP</option>
                  <option value="MEDISEP">MEDISEP</option>
                </select>
              </label>

              <label>
                Google Sheet URL
                <input
                  name="sheet_url"
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                />
              </label>

              <label>
                Status
                <select name="status" defaultValue="ACTIVE">
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="STOPPED">STOPPED</option>
                </select>
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={isPending}>
                  {isPending ? "Saving..." : "Add Hospital"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Hospital List Modal */}
      {isUploadModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsUploadModalOpen(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h3 style={{ marginTop: 0 }}>Upload Hospital List</h3>
            <p style={{ fontSize: 13, color: "var(--color-muted)" }}>
              Upload a CSV file containing hospital details and scheme Google Sheet links. One row per hospital + scheme.
            </p>

            <div style={{ fontSize: 12, background: "rgba(0,0,0,0.03)", padding: "10px 14px", borderRadius: 6, marginBottom: 16 }}>
              <strong>Required CSV Columns:</strong>
              <ol style={{ margin: "4px 0 0 16px", padding: 0 }}>
                <li><code>Hospital ID</code> (e.g. HOSPPVTP0001)</li>
                <li><code>Hospital Name</code> (full name)</li>
                <li><code>Other Names</code> (aliases separated by ;)</li>
                <li><code>Status</code> (Active or Stopped)</li>
                <li><code>Scheme</code> (Private, KASP, or MEDISEP)</li>
                <li><code>Google Sheet Link</code> (Google Sheet URL)</li>
                <li><code>Question Sheet Link</code> (Optional)</li>
              </ol>
            </div>

            <form onSubmit={handleUploadSubmit} className="stack">
              <label>
                Select CSV File
                <input
                  type="file"
                  name="csv_file"
                  accept=".csv,text/csv"
                  required
                  ref={fileInputRef}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={handleDownloadTemplate}
                >
                  Download Template
                </button>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setIsUploadModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn" disabled={isPending}>
                    {isPending ? "Uploading..." : "Upload & Process"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
