// Same claim inside one run (decision section 7, 30-Oct night). Same claim = same record key
// (claim number + admission date + discharge date). Same key, same values: a duplicate (one
// row is stored, the others are counted). Same key, different values: flagged (R-Y03), both
// kept and linked by a #n suffix (never merged, never guessed). The same patient with the
// same admission date under two claim numbers is a warning, except KASP Dialysis, where
// repeat sessions are normal (decision section 9). Same IP number with another claim number
// is a repeat treatment: not checked here, not an error. No cell value is logged.
import { createHash } from "node:crypto";
import { nameKey, type CleanRow } from "@oksy/rules";

/** The stored values of a row, without where it sits in the sheet (tab and row number). */
export function valuesHash(r: CleanRow): string {
  return createHash("sha256")
    .update(JSON.stringify({ claim: r.claim, payments: r.payments, flags: r.flags, nullReasons: r.nullReasons, extra: r.extra }))
    .digest("hex");
}

export interface SameClaimResult {
  /** Rows that repeat an earlier row exactly: not stored again. */
  duplicates: Set<CleanRow>;
  /** Keys seen on more than one row with different values. */
  conflicting: number;
  /** Rows warned for the same patient and admission date under another claim. */
  samePatientSameDay: number;
}

const flag = (r: CleanRow, detail: string) => {
  r.issues.push({ ruleId: "R-Y03", severity: "W", tier: "C", shadow: false, field: "record_key", detail });
  if (r.rowClass !== "NON_DATA_ROW") r.rowClass = "NEEDS_STAFF_INPUT";
};

export function checkSameClaims(rows: CleanRow[], scheme: string): SameClaimResult {
  const out: SameClaimResult = { duplicates: new Set(), conflicting: 0, samePatientSameDay: 0 };
  const byKey = new Map<string, Array<{ row: CleanRow; hash: string }>>();
  for (const r of rows) {
    if (!r.recordKey || !r.claim) continue;
    const list = byKey.get(r.recordKey) ?? [];
    const hash = valuesHash(r);
    const same = list.find((x) => x.hash === hash);
    if (same) {
      out.duplicates.add(r);
      continue;
    }
    list.push({ row: r, hash });
    byKey.set(r.recordKey, list);
  }
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    out.conflicting++;
    list.forEach(({ row }, i) => {
      flag(row, "Same claim (claim no, admission and discharge date) on more than one row with different values");
      if (i > 0) row.recordKey = `${key}#${i + 1}`;
    });
  }

  if (/dialysis/i.test(scheme)) return out;
  const byPatientDay = new Map<string, Set<string>>();
  const kept = rows.filter((r) => r.recordKey && r.claim && r.keyType === "CLAIM_NO" && !out.duplicates.has(r));
  for (const r of kept) {
    const name = r.claim!.patient_name ? nameKey(r.claim!.patient_name) : "";
    if (!name || !r.claim!.admission_date) continue;
    const k = `${name}|${r.claim!.admission_date}`;
    byPatientDay.set(k, (byPatientDay.get(k) ?? new Set()).add(r.recordKey!.replace(/#\d+$/, "")));
  }
  for (const r of kept) {
    const name = r.claim!.patient_name ? nameKey(r.claim!.patient_name) : "";
    const keys = byPatientDay.get(`${name}|${r.claim!.admission_date}`);
    if (keys && keys.size > 1) {
      flag(r, "Same patient with the same admission date under another claim number");
      out.samePatientSameDay++;
    }
  }
  return out;
}
