"use client";

import { IGNORE_FIELD, offeredFields, type FieldDef } from "@oksy/rules/fields";
import { useState, useTransition } from "react";
import { applyChoice, bulkCandidates, choiceLabel, type HeaderItem, type StoredBatch } from "@/lib/mappings";
import { FieldForm } from "../fields/fields-table";
import { bulkConfirmAction, createFieldAndDecideAction, decideHeaderAction, undoBulkAction, type HeaderRef } from "./actions";

/** The dropdown values that are not a field key. Never stored as such. */
const NEW_FIELD = "__new__";
const EXTRA = "__extra__";

const STATE_LABEL: Record<HeaderItem["state"], string> = {
  CHECK_AGAIN: "Check again",
  NEEDS_DECISION: "Needs a decision",
  DECIDED: "Decided",
  AUTO_IGNORED: "Ignored automatically",
};

const itemId = (i: HeaderItem) => `${i.hospital_code}|${i.scheme}|${i.header_key}`;
const refOf = (i: HeaderItem): HeaderRef => ({ hospitalCode: i.hospital_code, scheme: i.scheme, headerKey: i.header_key });
const toValue = (field: string | null) => (field === null ? EXTRA : field);
const fromValue = (v: string) => (v === EXTRA ? null : v);

/** The dropdown starts at the saved decision, else another hospital's, else the proposal. */
const startValue = (i: HeaderItem) => toValue(i.decision ? i.decision.canonical_field : i.crossSuggestion ? i.crossSuggestion.field : i.suggestion);

export function MappingTable({
  items,
  batches,
  hospitalNames,
  fields,
  canCreateFields,
  canBulk,
}: {
  items: HeaderItem[];
  /** Bulk confirms not undone yet, newest first. */
  batches: StoredBatch[];
  hospitalNames: Record<string, string>;
  /** The mapping_fields list (Fields page). Only ACTIVE fields are offered for a new choice. */
  fields: FieldDef[];
  /** false while the field list is read from the code (migration 0028 not applied). */
  canCreateFields: boolean;
  /** Owner / Admin: "Confirm all" and its undo. */
  canBulk: boolean;
}) {
  const labels = Object.fromEntries(fields.map((f) => [f.key, f.label]));
  const hidden = new Set(fields.filter((f) => f.status !== "ACTIVE").map((f) => f.key));
  const offered = offeredFields(fields);
  const [newField, setNewField] = useState<{ id: string; label: string; type: string; aliases: string } | null>(null);
  const [filterHospital, setFilterHospital] = useState<string>("ALL");
  const [showDecided, setShowDecided] = useState<boolean>(false);
  const [selected, setSelected] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [itemId(i), startValue(i)])),
  );
  /** The hospital + scheme whose "Confirm all" list is open (shown before anything is saved). */
  const [bulkOpen, setBulkOpen] = useState<string | null>(null);
  const [acceptShape, setAcceptShape] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const hospitals = [...new Set(items.map((i) => i.hospital_code))].sort();
  const visible = items.filter((i) => {
    if (filterHospital !== "ALL" && i.hospital_code !== filterHospital) return false;
    if (!showDecided && (i.state === "DECIDED" || i.state === "AUTO_IGNORED")) return false;
    return true;
  });
  const groups = new Map<string, HeaderItem[]>();
  for (const i of visible) {
    const k = `${i.hospital_code}|${i.scheme}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }

  const saved = (i: HeaderItem, field: string | null, columns?: number) =>
    setMessage({ text: `Saved: "${i.header}" -> ${choiceLabel(field, labels)}${columns ? ` (used on ${columns} column${columns === 1 ? "" : "s"})` : ""}.`, ok: true });

  const handleChange = (i: HeaderItem, value: string) => {
    const id = itemId(i);
    if (value === NEW_FIELD) {
      setNewField({ id, label: "", type: "text", aliases: "" });
      return; // the decision changes only when the new field is created
    }
    setSelected((prev) => ({ ...prev, [id]: value }));
    setMessage(null);
    // Ignore is a decision on its own and is saved at once, so it survives a refresh.
    startTransition(async () => {
      const res = await applyChoice(value, (field) => decideHeaderAction(refOf(i), field));
      if (res.saved) saved(i, IGNORE_FIELD);
      else if (!res.ok) setMessage({ text: res.error ?? "Failed to save Ignore", ok: false });
    });
  };

  const handleSave = (i: HeaderItem) => {
    const id = itemId(i);
    const field = fromValue(selected[id] ?? EXTRA);
    setMessage(null);
    startTransition(async () => {
      const res = await decideHeaderAction(refOf(i), field, acceptShape[id] ?? false);
      if (res.ok) saved(i, field, res.columns);
      else setMessage({ text: res.error ?? "Failed to save", ok: false });
    });
  };

  const selectedFields = Object.fromEntries(Object.entries(selected).map(([k, v]) => [k, fromValue(v)]));
  const candidatesOf = (groupKey: string) => bulkCandidates(items.filter((i) => `${i.hospital_code}|${i.scheme}` === groupKey), selectedFields);

  const handleBulk = (groupKey: string) => {
    const { take } = candidatesOf(groupKey);
    const [hospital, scheme] = groupKey.split("|") as [string, string];
    setMessage(null);
    startTransition(async () => {
      const res = await bulkConfirmAction(hospital, scheme, take.map((i) => ({ headerKey: i.header_key, field: i.crossSuggestion!.field })));
      if (res.ok) {
        setBulkOpen(null);
        setMessage({ text: `Confirmed ${take.length} header${take.length === 1 ? "" : "s"} in one action. You can undo it below.`, ok: true });
      } else {
        setMessage({ text: res.error, ok: false });
      }
    });
  };

  const handleUndo = (b: StoredBatch) => {
    setMessage(null);
    startTransition(async () => {
      const res = await undoBulkAction(b.id);
      if (res.ok) setMessage({ text: `Undone: ${res.count} header${res.count === 1 ? " is" : "s are"} undecided again.`, ok: true });
      else setMessage({ text: res.error, ok: false });
    });
  };

  const handleCreate = (i: HeaderItem) => {
    const id = itemId(i);
    if (!newField || newField.id !== id) return;
    setMessage(null);
    startTransition(async () => {
      const res = await createFieldAndDecideAction(refOf(i), newField.label, newField.type, newField.aliases);
      if (res.ok) {
        setSelected((prev) => ({ ...prev, [id]: res.key ?? EXTRA }));
        setNewField(null);
        setMessage({ text: `Created field "${newField.label.trim()}" and decided "${i.header}" as it.`, ok: true });
      } else {
        setMessage({ text: res.error, ok: false });
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
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginTop: 16 }}>
          <input type="checkbox" checked={showDecided} onChange={(e) => setShowDecided(e.target.checked)} />
          <strong>Show decided headers too</strong>
        </label>
      </div>

      {groups.size === 0 ? (
        <div className="card empty">
          <p>{showDecided ? "No headers match the selected filters." : "Nothing to decide. Every header has a decision."}</p>
        </div>
      ) : (
        [...groups.entries()].map(([groupKey, list]) => {
          const first = list[0]!;
          const open = list.filter((i) => i.state === "NEEDS_DECISION" || i.state === "CHECK_AGAIN").length;
          const bulk = canBulk ? candidatesOf(groupKey) : { take: [], rest: 0 };
          const groupBatches = canBulk ? batches.filter((b) => `${b.hospital_code}|${b.scheme}` === groupKey) : [];
          return (
            <div key={groupKey} className="card stack" style={{ gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
                  {hospitalNames[first.hospital_code] ?? first.hospital_code} ({first.hospital_code}) · Scheme: <span className="pill">{first.scheme}</span>
                </h3>
                <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  {open} header{open === 1 ? "" : "s"} to decide. A decision here is used on every tab of this hospital and scheme with the same header.
                </div>
              </div>

              {bulk.take.length > 0 && bulkOpen !== groupKey && (
                <div>
                  <button className="btn" data-testid="confirm-all" disabled={isPending} onClick={() => setBulkOpen(groupKey)}>
                    Confirm all {bulk.take.length} suggested from other hospitals
                  </button>
                </div>
              )}
              {bulkOpen === groupKey && bulk.take.length > 0 && (
                <div className="notice" role="region" aria-label="Confirm all" data-testid="confirm-all-list">
                  <div className="stack" style={{ gap: 8, width: "100%" }}>
                    <strong>
                      {bulk.take.length} header{bulk.take.length === 1 ? "" : "s"} will be decided as other hospitals of scheme {first.scheme} decided them:
                    </strong>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {bulk.take.map((i) => (
                        <li key={itemId(i)}>
                          {i.header} → {choiceLabel(i.crossSuggestion!.field, labels)} <span className="muted">(same as {i.crossSuggestion!.from.map((h) => hospitalNames[h] ?? h).join(", ")})</span>
                        </li>
                      ))}
                    </ul>
                    {bulk.rest > 0 && <div className="muted">{bulk.rest} more after this: at most 50 in one action.</div>}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn" data-testid="confirm-all-go" disabled={isPending} onClick={() => handleBulk(groupKey)}>
                        Confirm these {bulk.take.length}
                      </button>
                      <button className="btn secondary" disabled={isPending} onClick={() => setBulkOpen(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {groupBatches.map((b) => (
                <div key={b.id} className="muted" style={{ fontSize: "0.85rem", display: "flex", gap: 8, alignItems: "center" }}>
                  Bulk confirm of {b.item_count} header{b.item_count === 1 ? "" : "s"}, {new Date(b.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.
                  <button className="btn secondary" style={{ padding: "2px 8px", fontSize: "0.8rem" }} disabled={isPending} onClick={() => handleUndo(b)}>
                    Undo
                  </button>
                </div>
              ))}

              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Header in the sheet</th>
                      <th>Tabs</th>
                      <th style={{ minWidth: 260 }}>Decision</th>
                      <th>State</th>
                      <th style={{ width: 100 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((i) => {
                      const id = itemId(i);
                      const cur = selected[id] ?? EXTRA;
                      const auto = i.state === "AUTO_IGNORED";
                      const savedValue = i.decision ? toValue(i.decision.canonical_field) : null;
                      const unchanged = savedValue === cur && i.state === "DECIDED";
                      return (
                        <tr key={id} style={{ opacity: auto || (i.decision?.canonical_field === IGNORE_FIELD && unchanged) ? 0.6 : undefined }}>
                          <td>
                            <strong>{i.header}</strong>
                            {i.reasons.map((r) => (
                              <div key={r} className="muted" style={{ fontSize: "0.8rem", color: "var(--amber, #b26a00)" }}>
                                {r}
                              </div>
                            ))}
                          </td>
                          <td className="muted" style={{ fontSize: "0.85rem" }}>
                            {i.tabs.join(", ")}
                          </td>
                          <td>
                            {auto ? (
                              <span className="muted">Ignored automatically ({i.autoIgnoreReason}: the portal calculates it)</span>
                            ) : (
                              <>
                                <select value={cur} onChange={(e) => handleChange(i, e.target.value)} style={{ width: "100%", padding: "4px 8px", fontSize: "0.9rem" }}>
                                  <option value={EXTRA}>Keep in extra columns</option>
                                  <option value={IGNORE_FIELD}>Ignore (not needed)</option>
                                  {/* A hidden field stays visible only where it is already chosen. */}
                                  {hidden.has(cur) && <option value={cur}>{labels[cur]} (hidden)</option>}
                                  {cur !== EXTRA && cur !== IGNORE_FIELD && !(cur in labels) && <option value={cur}>{cur} (not in the field list)</option>}
                                  {offered.map((f) => (
                                    <option key={f.key} value={f.key}>
                                      {f.label}
                                    </option>
                                  ))}
                                  {canCreateFields && <option value={NEW_FIELD}>+ Create new field</option>}
                                </select>
                                {!i.decision && i.crossSuggestion && (
                                  <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                                    Same as {i.crossSuggestion.from.map((h) => hospitalNames[h] ?? h).join(", ")}: {choiceLabel(i.crossSuggestion.field, labels)}
                                  </div>
                                )}
                                {!i.decision && !i.crossSuggestion && i.suggestion && <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>Suggested: {choiceLabel(i.suggestion, labels)}</div>}
                                {i.state === "CHECK_AGAIN" && (
                                  <label style={{ display: "flex", gap: 6, fontSize: "0.8rem", marginTop: 4 }}>
                                    <input type="checkbox" checked={acceptShape[id] ?? false} onChange={(e) => setAcceptShape((p) => ({ ...p, [id]: e.target.checked }))} />
                                    The values are right; use this field anyway
                                  </label>
                                )}
                                {newField?.id === id && (
                                  <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                                    <FieldForm draft={newField} onChange={(d) => setNewField({ id, ...d })} />
                                    <div style={{ display: "flex", gap: 6 }}>
                                      <button className="btn" style={{ padding: "4px 10px" }} disabled={isPending || !newField.label.trim()} onClick={() => handleCreate(i)}>
                                        Create and use
                                      </button>
                                      <button className="btn secondary" style={{ padding: "4px 10px" }} disabled={isPending} onClick={() => setNewField(null)}>
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                          <td>
                            <span className={`pill ${i.state === "DECIDED" || auto ? "tone-green" : "tone-amber"}`}>{STATE_LABEL[i.state]}</span>
                          </td>
                          <td>
                            {/* A saved Ignore needs no Save; choosing another field shows it again. */}
                            {!auto && !unchanged && !(cur === IGNORE_FIELD && savedValue === IGNORE_FIELD && i.state !== "CHECK_AGAIN") && (
                              <button className="btn secondary" style={{ padding: "4px 10px", fontSize: "0.85rem" }} onClick={() => handleSave(i)} disabled={isPending}>
                                {i.decision ? "Update" : "Save"}
                              </button>
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
        })
      )}
    </div>
  );
}
