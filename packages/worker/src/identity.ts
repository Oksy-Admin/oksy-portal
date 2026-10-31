// Same claim inside one run (decision section 7, 30-Oct night; Stage 2c, 1-Nov). Same claim =
// same record key (claim number + admission date + discharge date). Same key, same values: a
// duplicate (one row is stored, the others are counted). Same key, different values: flagged
// (R-K02, split off from R-Y03 on 1-Nov so each cross-row case has its own wording), both kept
// and linked by a #n suffix (never merged, never guessed). The same patient with the same
// admission date under two claim numbers is a warning (R-Y03), except KASP Dialysis, where
// repeat sessions are normal (decision section 9). The same UTR on more than one claim is a
// warning (R-K01, new 1-Nov). The same IP number with another claim number is a repeat
// treatment: not checked here, not an error. No cell value is logged.
import { createHash } from "node:crypto";
import { nameKey, type CleanRow } from "@oksy/rules";

/** The stored values of a row, without where it sits in the sheet (tab and row number). */
export function valuesHash(r: CleanRow): string {
  return createHash("sha256")
    .update(JSON.stringify({ claim: r.claim, payments: r.payments, flags: r.flags, nullReasons: r.nullReasons, extra: r.extra }))
    .digest("hex");
}

export interface CrossRowRule {
  severity: "E" | "W";
  staffMessage: string | null;
}

/** Wording the Rule Library normally supplies (rule_versions.severity/staff_message); used only when a caller omits it (tests). A rule missing here (made Inactive) never fires. */
const DEFAULT_RULES: Record<"R-Y03" | "R-K01" | "R-K02", CrossRowRule> = {
  "R-Y03": { severity: "W", staffMessage: "Same patient with the same admission date under another claim number." },
  "R-K02": { severity: "W", staffMessage: "Same claim (claim number, admission and discharge date) on more than one row with different values." },
  "R-K01": { severity: "W", staffMessage: "Same UTR appears on more than one claim: please confirm this is not a data entry error." },
};

/** Not a fixed set of IDs (the caller builds this from whichever ACTIVE rule_versions rows have no check_definition - packages/worker/src/sheet-run.ts - so no rule ID needs to be named here or there). */
export type CrossRowRules = Record<string, CrossRowRule | undefined>;

function flagWith(r: CleanRow, ruleId: string, rule: CrossRowRule | undefined, field: string) {
  if (!rule) return; // the rule was made Inactive: this check does not fire (2a done-criteria)
  r.issues.push({ ruleId, severity: rule.severity, tier: "C", shadow: false, field, detail: rule.staffMessage ?? ruleId });
  if (r.rowClass !== "NON_DATA_ROW") r.rowClass = "NEEDS_STAFF_INPUT";
}

/** Exact repeats within one run: same key, identical cleaned values. Never flagged, never stored twice. */
export function dedupeExactRows(rows: CleanRow[]): { kept: CleanRow[]; duplicates: Set<CleanRow> } {
  const duplicates = new Set<CleanRow>();
  const kept: CleanRow[] = [];
  const seenHashes = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.recordKey || !r.claim) {
      kept.push(r);
      continue;
    }
    const hash = valuesHash(r);
    const seen = seenHashes.get(r.recordKey);
    if (seen?.has(hash)) {
      duplicates.add(r);
      continue;
    }
    seenHashes.set(r.recordKey, new Set([...(seen ?? []), hash]));
    kept.push(r);
  }
  return { kept, duplicates };
}

export interface SameClaimResult {
  /** Rows that repeat an earlier row exactly: not stored again. */
  duplicates: Set<CleanRow>;
  /** Keys seen on more than one row with different values. */
  conflicting: number;
  /** Rows warned for the same patient and admission date under another claim. */
  samePatientSameDay: number;
}

/**
 * Call after Stage 2c's two-part approval step (packages/rules/src/two-part.ts) has already
 * suffixed any confirmed or pending two-part pair's secondary key: those pairs no longer share
 * a key by the time this runs, so they are never also flagged here as a data conflict.
 */
export function checkSameClaims(rows: CleanRow[], scheme: string, rules: CrossRowRules = {}): SameClaimResult {
  const r2 = { ...DEFAULT_RULES, ...rules };
  const { kept, duplicates } = dedupeExactRows(rows);
  const out: SameClaimResult = { duplicates, conflicting: 0, samePatientSameDay: 0 };

  const byKey = new Map<string, CleanRow[]>();
  for (const row of kept) {
    if (!row.recordKey || !row.claim) continue;
    byKey.set(row.recordKey, [...(byKey.get(row.recordKey) ?? []), row]);
  }
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    out.conflicting++;
    list.forEach((row, i) => {
      flagWith(row, "R-K02", r2["R-K02"], "record_key");
      if (i > 0) row.recordKey = `${key}#${i + 1}`;
    });
  }

  if (/dialysis/i.test(scheme)) return out;
  const byPatientDay = new Map<string, Set<string>>();
  const sameKeptRows = kept.filter((row) => row.recordKey && row.claim && row.keyType === "CLAIM_NO" && !duplicates.has(row));
  for (const row of sameKeptRows) {
    const name = row.claim!.patient_name ? nameKey(row.claim!.patient_name) : "";
    if (!name || !row.claim!.admission_date) continue;
    const k = `${name}|${row.claim!.admission_date}`;
    byPatientDay.set(k, (byPatientDay.get(k) ?? new Set()).add(row.recordKey!.replace(/#\d+$/, "")));
  }
  for (const row of sameKeptRows) {
    const name = row.claim!.patient_name ? nameKey(row.claim!.patient_name) : "";
    const keys = byPatientDay.get(`${name}|${row.claim!.admission_date}`);
    if (keys && keys.size > 1) {
      flagWith(row, "R-Y03", r2["R-Y03"], "record_key");
      out.samePatientSameDay++;
    }
  }
  return out;
}

export interface SameUtrResult {
  flagged: number;
}

/**
 * Same UTR on more than one claim (decisions.md section 7, 1-Nov; R-K01). Rows already
 * combined as one two-part claim (packages/rules/src/two-part.ts) share a UTR legitimately -
 * comparing by the record key with any "#n" suffix stripped treats them as one claim, so a
 * combined claim's own two UTRs never flag itself.
 */
export function checkSameUtr(rows: CleanRow[], rules: CrossRowRules = {}): SameUtrResult {
  const rule = "R-K01" in rules ? rules["R-K01"] : DEFAULT_RULES["R-K01"];
  const kept = rows.filter((r) => r.recordKey && r.claim && r.rowClass !== "NON_DATA_ROW");
  const byUtr = new Map<string, Set<string>>();
  for (const r of kept) {
    const base = r.recordKey!.replace(/#\d+$/, "");
    for (const u of r.claim!.utr_no) byUtr.set(u, (byUtr.get(u) ?? new Set()).add(base));
  }
  let flagged = 0;
  for (const r of kept) {
    if (r.claim!.utr_no.some((u) => (byUtr.get(u)?.size ?? 0) > 1)) {
      flagWith(r, "R-K01", rule, "payment_utr");
      flagged++;
    }
  }
  return { flagged };
}
