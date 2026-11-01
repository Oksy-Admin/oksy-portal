"use client";

import { useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { parseRuleUploadGrid, RULE_UPLOAD_HEADER, splitCsvLine, type RuleUploadRow } from "@oksy/rules";
import { createRuleUploadBatchAction, saveCheckRuleAction, undoRuleUploadAction } from "./actions";

/** CSV or Excel upload (stage-plan 2d), the hospital-upload pattern: preview with errors per
 * row, then "Save N rules" records one `rule_upload_batches` row for the audit and undo. The
 * file is read in the browser; parseRuleUploadGrid (packages/rules) is the one validation,
 * shared with the CSV-only path so a grid from either format is checked the same way. */
export function RuleUpload({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RuleUploadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ batchId: string; saved: number; total: number; fileName: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const onFile = async (file: File) => {
    setError(null);
    setRows([]);
    setFileName(file.name);
    try {
      let grid: string[][];
      if (/\.csv$/i.test(file.name)) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
        grid = lines.slice(1).map(splitCsvLine);
      } else {
        const buf = await file.arrayBuffer();
        const book = XLSX.read(new Uint8Array(buf), { type: "array" });
        const sheet = book.Sheets[book.SheetNames[0]!]!;
        const asRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false }) as unknown[][];
        grid = asRows.slice(1).map((r) => r.map((c) => (c == null ? "" : String(c))));
      }
      setRows(parseRuleUploadGrid(grid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    }
  };

  const accepted = rows.filter((r) => r.ok);
  const rejected = rows.filter((r) => !r.ok);

  const saveAll = () => {
    if (!fileName || accepted.length === 0) return;
    startTransition(async () => {
      const batch = await createRuleUploadBatchAction(fileName, rows.length, accepted.length, rejected.length);
      if (!batch.ok || !batch.batchId) {
        setError(batch.error ?? "Could not record the upload.");
        return;
      }
      let saved = 0;
      for (const r of accepted) {
        setProgress(`Saving ${saved + 1} of ${accepted.length}…`);
        const d = r.draft!;
        const res = await saveCheckRuleAction({
          ruleId: d.ruleId,
          title: d.title,
          severity: d.severity,
          action: d.action,
          staffMessage: d.staffMessage,
          checkDefinition: d.checkDefinition,
          hospitalFilter: d.hospitalFilter,
          schemeFilter: d.schemeFilter,
          insurerFilter: d.insurerFilter,
          validFrom: d.validFrom,
          validTo: d.validTo,
          dateBasis: null,
          uploadBatchId: batch.batchId,
        });
        if (res.ok) saved++;
      }
      setProgress(null);
      setResult({ batchId: batch.batchId, saved, total: accepted.length, fileName });
    });
  };

  const undo = () => {
    if (!result) return;
    startTransition(async () => {
      const res = await undoRuleUploadAction(result.batchId);
      onDone(res.ok ? `Upload undone: ${res.count} rule(s) retired.` : res.error ?? "Could not undo.");
    });
  };

  if (result) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="notice">
          Saved {result.saved} of {result.total} rule(s) from &quot;{result.fileName}&quot;, all PROPOSED -- activate each from the list when ready.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn secondary" disabled={isPending} onClick={undo}>Undo this upload</button>
          <button type="button" className="btn" onClick={() => onDone(`Saved ${result.saved} of ${result.total} rule(s) from "${result.fileName}".`)}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="muted" style={{ fontSize: 13 }}>
        Columns: {RULE_UPLOAD_HEADER.join(", ")}. The condition cell holds up to 5 conditions, for example{" "}
        <code>los_days GREATER_THAN 30</code>; join with <code>&&</code> (AND) or <code>||</code> (OR), never both.
        Every uploaded rule is saved PROPOSED, the same as one added by hand -- activate it from the list.
      </p>
      <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {error && <p className="notice warn">{error}</p>}
      {rows.length > 0 && (
        <>
          <p>
            {accepted.length} of {rows.length} row(s) ready to save{rejected.length > 0 ? `; ${rejected.length} need fixing` : ""}.
          </p>
          <div className="table-wrap" style={{ maxHeight: 280, overflow: "auto" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Rule ID</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td><code>{r.draft?.ruleId ?? "—"}</code></td>
                    <td>{r.ok ? "OK" : <span style={{ color: "var(--color-red, #dc2626)" }}>{r.error}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {progress && <p className="muted">{progress}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn" disabled={accepted.length === 0 || isPending} onClick={saveAll}>
          {isPending ? "Saving…" : `Save ${accepted.length} rule${accepted.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
