"use client";

import { Fragment, useState, useTransition } from "react";
import { BULK_KINDS, bulkCandidates, KIND_LABELS, type DictionaryItem, type DictionaryKind, type StoredBatch } from "@/lib/dictionary";
import { bulkConfirmDictionaryAction, decideDictionaryAction, undoDictionaryBatchAction, type DictionaryRef } from "./actions";

const refOf = (i: DictionaryItem): DictionaryRef => ({ kind: i.entry.kind, scheme: i.entry.scheme, hospitalCode: i.entry.hospital_code, spellingKey: i.entry.spelling_key });
const itemId = (i: DictionaryItem) => `${i.entry.kind}|${i.entry.scheme}|${i.entry.hospital_code ?? ""}|${i.entry.spelling_key}`;

export function DictionaryTable({
  items,
  batches,
  hospitalNames,
  canBulk,
}: {
  items: DictionaryItem[];
  /** Bulk confirms not undone yet, newest first. */
  batches: StoredBatch[];
  hospitalNames: Record<string, string>;
  /** Owner / Admin: "Confirm all" and its undo. */
  canBulk: boolean;
}) {
  const [filterKind, setFilterKind] = useState<DictionaryKind | "ALL">("ALL");
  const [showDecided, setShowDecided] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(items.map((i) => [itemId(i), i.crossSuggestion?.standard_value ?? i.entry.standard_value])));
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const visible = items.filter((i) => (filterKind === "ALL" || i.entry.kind === filterKind) && (showDecided || i.state === "NEEDS_DECISION"));
  const groups = new Map<string, DictionaryItem[]>();
  for (const i of visible) {
    const k = `${i.entry.kind}|${i.entry.hospital_code ?? "ALL"}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }

  const decide = (i: DictionaryItem, status: "CONFIRMED" | "REJECTED") => {
    const value = values[itemId(i)] ?? i.entry.standard_value;
    setMessage(null);
    startTransition(async () => {
      const res = await decideDictionaryAction(refOf(i), status, value);
      if (res.ok) setMessage({ text: `Saved: "${i.entry.spelling_raw}" -> ${status === "REJECTED" ? "Rejected" : value}.`, ok: true });
      else setMessage({ text: res.error ?? "Failed to save the decision", ok: false });
    });
  };

  const confirmAll = (kind: DictionaryKind, hospitalCode: string, scheme: string) => {
    const { take } = bulkCandidates(items, kind, hospitalCode, scheme);
    if (take.length === 0) return;
    setMessage(null);
    startTransition(async () => {
      const res = await bulkConfirmDictionaryAction(kind, scheme, hospitalCode, take.map((i) => ({ spellingKey: i.entry.spelling_key, standardValue: i.crossSuggestion!.standard_value })));
      if (res.ok) setMessage({ text: `Confirmed ${take.length} ${KIND_LABELS[kind].toLowerCase()}(s), same as another hospital.`, ok: true });
      else setMessage({ text: res.error, ok: false });
    });
  };

  const undo = (batchId: string) => {
    setMessage(null);
    startTransition(async () => {
      const res = await undoDictionaryBatchAction(batchId);
      if (res.ok) setMessage({ text: `Undone: ${res.count} entries are back on the decision list.`, ok: true });
      else setMessage({ text: res.error, ok: false });
    });
  };

  const kinds = [...new Set(items.map((i) => i.entry.kind))].sort();

  return (
    <div className="card">
      <div className="toolbar">
        <select value={filterKind} onChange={(e) => setFilterKind(e.target.value as DictionaryKind | "ALL")} aria-label="Filter by kind">
          <option value="ALL">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={showDecided} onChange={(e) => setShowDecided(e.target.checked)} /> Show decided
        </label>
        {message && <span className={message.ok ? "notice ok" : "notice warn"}>{message.text}</span>}
      </div>

      {batches.length > 0 && canBulk && (
        <div className="notice">
          Recent bulk confirms:{" "}
          {batches.map((b) => (
            <span key={b.id}>
              {KIND_LABELS[b.kind]} x{b.item_count} for {hospitalNames[b.hospital_code] ?? b.hospital_code}{" "}
              <button type="button" disabled={isPending} onClick={() => undo(b.id)}>
                Undo
              </button>{" "}
            </span>
          ))}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Hospital</th>
            <th>Spelling</th>
            <th>Standard value</th>
            <th>Evidence</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([groupKey, groupItems]) => {
            const [kind, hospitalCode] = groupKey.split("|") as [DictionaryKind, string];
            const scheme = groupItems[0]!.entry.scheme;
            const canConfirmAll = canBulk && BULK_KINDS.includes(kind) && hospitalCode !== "ALL" && bulkCandidates(items, kind, hospitalCode, scheme).take.length > 0;
            return (
              <Fragment key={groupKey}>
                {canConfirmAll && (
                  <tr key={`${groupKey}-bulk`}>
                    <td colSpan={6}>
                      <button type="button" disabled={isPending} onClick={() => confirmAll(kind, hospitalCode, scheme)}>
                        Confirm all pre-filled {KIND_LABELS[kind].toLowerCase()}s for {hospitalNames[hospitalCode] ?? hospitalCode} ({bulkCandidates(items, kind, hospitalCode, scheme).take.length})
                      </button>
                    </td>
                  </tr>
                )}
                {groupItems.map((i) => {
                  const id = itemId(i);
                  return (
                    <tr key={id}>
                      <td>{KIND_LABELS[i.entry.kind]}</td>
                      <td>{i.entry.hospital_code ? hospitalNames[i.entry.hospital_code] ?? i.entry.hospital_code : "All hospitals"}</td>
                      <td>{i.entry.spelling_raw}</td>
                      <td>
                        {i.state === "NEEDS_DECISION" ? (
                          <input
                            value={values[id] ?? ""}
                            onChange={(e) => setValues((prev) => ({ ...prev, [id]: e.target.value }))}
                            aria-label={`Standard value for ${i.entry.spelling_raw}`}
                          />
                        ) : (
                          i.entry.standard_value
                        )}
                        {i.crossSuggestion && i.state === "NEEDS_DECISION" && (
                          <div className="label">
                            pre-filled from {i.crossSuggestion.from.map((h) => hospitalNames[h] ?? h).join(", ")}
                          </div>
                        )}
                      </td>
                      <td>{i.entry.evidence?.count ? `seen ${i.entry.evidence.count}x` : i.entry.evidence?.source ?? ""}</td>
                      <td>
                        {i.state === "NEEDS_DECISION" ? (
                          <>
                            <button type="button" disabled={isPending} onClick={() => decide(i, "CONFIRMED")}>
                              Confirm
                            </button>{" "}
                            <button type="button" disabled={isPending} onClick={() => decide(i, "REJECTED")}>
                              Reject
                            </button>
                          </>
                        ) : (
                          i.state === "REJECTED" ? "Rejected" : "Confirmed"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={6}>Nothing needs a decision right now.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
