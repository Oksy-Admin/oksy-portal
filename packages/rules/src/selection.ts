// Rule selection (file 04 section 10.2, D-014, D-015, D-034, D-043, D-050).
// Pure code: the caller loads rule versions from the database and passes them in.
import { Money, type TdsChoice } from "./money.ts";

export type RuleStatus = "PROPOSED" | "PREVIEWED" | "APPROVED" | "ACTIVE" | "RETIRED" | "DRAFT" | "REFERENCE";
export type DateBasis = "ADMISSION" | "DISCHARGE" | "SETTLEMENT";

/** One rule version as stored in `rule_versions` (file 04 section 10.1), fields the selection needs. */
export interface RuleVersion {
  ruleId: string;
  version: number;
  type: "CHECK" | "PARAMETER";
  status: RuleStatus;
  hospitalFilter?: string | null; // register HOSPITAL ID
  schemeFilter?: string | null;
  insurerFilter?: string | null; // matches the row's insurer or TPA
  validFrom?: string | null; // ISO date, inclusive
  validTo?: string | null; // ISO date, inclusive
  dateBasis?: DateBasis | null; // which row date the window is tested on
  parameterName?: string | null;
  parameterValue?: string | null; // decimal as text, never a JS number
}

/** The row's own values, never the sheet's (file 04 section 10.2, step 1). */
export interface RuleContext {
  hospital: string;
  scheme: string;
  insurer: string | null;
  tpa: string | null;
  dates: Partial<Record<"admission" | "discharge" | "settlement", string | null>>;
}

export interface ChosenParameter {
  value: string;
  ruleId: string;
  version: number;
  specificity: number;
}

export interface ConfigError {
  kind: "EQUAL_SPECIFICITY_CONFLICT" | "TWO_ACTIVE_VERSIONS";
  parameterName?: string;
  ruleIds: string[];
}

export interface Selection {
  checks: RuleVersion[]; // ACTIVE CHECK rules that match
  shadowChecks: RuleVersion[]; // PROPOSED, PREVIEWED or APPROVED: shadow issues only (D-043)
  parameters: Map<string, ChosenParameter>;
  shadowParameters: Map<string, ChosenParameter>;
  /** Dated rules that could not be tested because the row has no date of that basis. */
  skippedNoDate: RuleVersion[];
  /** Sent to an approver. Never resolved by picking one silently (D-015). */
  configErrors: ConfigError[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function specificity(r: RuleVersion): number {
  return [r.hospitalFilter, r.schemeFilter, r.insurerFilter].filter((f) => f != null && f !== "").length;
}

function filtersMatch(r: RuleVersion, c: RuleContext): boolean {
  if (r.hospitalFilter && r.hospitalFilter !== c.hospital) return false;
  if (r.schemeFilter && norm(r.schemeFilter) !== norm(c.scheme)) return false;
  if (r.insurerFilter) {
    const want = norm(r.insurerFilter);
    if (![c.insurer, c.tpa].some((x) => x != null && norm(x) === want)) return false;
  }
  return true;
}

function rowDate(r: RuleVersion, c: RuleContext): string | null {
  const basis = r.dateBasis ?? "DISCHARGE";
  if (basis === "SETTLEMENT") return c.dates.settlement ?? null;
  if (basis === "ADMISSION") return c.dates.admission ?? null;
  return c.dates.discharge ?? c.dates.admission ?? null;
}

type WindowResult = "IN" | "OUT" | "NO_DATE";

function inWindow(r: RuleVersion, c: RuleContext): WindowResult {
  if (!r.validFrom && !r.validTo) return "IN"; // empty window = all dates
  const d = rowDate(r, c);
  if (!d) return "NO_DATE";
  if (r.validFrom && d < r.validFrom) return "OUT"; // ISO dates compare as text
  if (r.validTo && d > r.validTo) return "OUT";
  return "IN";
}

function chooseParameters(rules: RuleVersion[], errors: ConfigError[]): Map<string, ChosenParameter> {
  const byName = new Map<string, RuleVersion[]>();
  for (const r of rules) {
    if (r.type !== "PARAMETER" || !r.parameterName || r.parameterValue == null) continue;
    byName.set(r.parameterName, [...(byName.get(r.parameterName) ?? []), r]);
  }
  const chosen = new Map<string, ChosenParameter>();
  for (const [name, rs] of byName) {
    const top = Math.max(...rs.map(specificity));
    const best = rs.filter((r) => specificity(r) === top);
    const [winner] = best as [RuleVersion, ...RuleVersion[]];
    const first = new Money(winner.parameterValue as string);
    if (best.some((r) => !new Money(r.parameterValue as string).equals(first))) {
      errors.push({ kind: "EQUAL_SPECIFICITY_CONFLICT", parameterName: name, ruleIds: best.map((r) => r.ruleId).sort() });
      continue;
    }
    chosen.set(name, { value: winner.parameterValue as string, ruleId: winner.ruleId, version: winner.version, specificity: top });
  }
  return chosen;
}

export function selectRules(all: RuleVersion[], c: RuleContext): Selection {
  const configErrors: ConfigError[] = [];
  const skippedNoDate: RuleVersion[] = [];
  const active: RuleVersion[] = [];
  const shadow: RuleVersion[] = [];

  const activeIds = all.filter((r) => r.status === "ACTIVE").map((r) => r.ruleId);
  for (const id of new Set(activeIds.filter((id, i) => activeIds.indexOf(id) !== i))) {
    configErrors.push({ kind: "TWO_ACTIVE_VERSIONS", ruleIds: [id] });
  }

  for (const r of all) {
    if (r.status === "RETIRED" || r.status === "DRAFT" || r.status === "REFERENCE" || !filtersMatch(r, c)) continue;
    const w = inWindow(r, c);
    if (w === "NO_DATE") skippedNoDate.push(r);
    if (w !== "IN") continue;
    (r.status === "ACTIVE" ? active : shadow).push(r);
  }

  return {
    checks: active.filter((r) => r.type === "CHECK"),
    shadowChecks: shadow.filter((r) => r.type === "CHECK"),
    parameters: chooseParameters(active, configErrors),
    shadowParameters: chooseParameters(shadow, []),
    skippedNoDate,
    configErrors,
  };
}

/** The TDS rule that sets the default rate (R-T01). Any other winning rule gives source RULE. */
export const DEFAULT_TDS_RULE = "R-T01";

/**
 * TDS rate for a row and its source (D-050). A rate confirmed for the row by the hospital
 * or an approver beats every rule. No ACTIVE TDS rule: null (never a guessed rate).
 */
export function resolveTdsRate(sel: Selection, confirmedRate?: string | null): TdsChoice | null {
  if (confirmedRate != null && confirmedRate !== "") return { rate: confirmedRate, source: "CONFIRMED", ruleId: null };
  const p = sel.parameters.get("tds_rate");
  if (!p) return null;
  return { rate: p.value, source: p.ruleId === DEFAULT_TDS_RULE ? "DEFAULT" : "RULE", ruleId: p.ruleId };
}
