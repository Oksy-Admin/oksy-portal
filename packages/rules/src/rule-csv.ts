// Rule Library upload (stage-plan 2d): CSV or Excel with the rule template -> preview with
// errors per row -> "Save N rules" (same pattern as the hospital bulk upload, decisions.md
// section 4: a preview before save, errors shown, nothing saved until the user accepts).
// The file itself (CSV text, or an Excel sheet turned into a grid by the `xlsx` package
// already used for report downloads) is read in the browser; only this pure grid-and-text
// parsing lives here, so it is unit-tested the same way as every other rules/ module.
//
// One condition cell holds up to 5 conditions, ANDed with "&&" or ORed with "||" (never
// mixed, same as engine.ts): "field OPERATOR value". OPERATOR is one of engine.ts's
// ConditionOperator names; "value" is another known field name, a plain number or ISO date,
// or TODAY+Nd / TODAY-Nd. EMPTY, NOT_EMPTY, FLAG_TRUE and FLAG_FALSE take no value.
import type { ConditionOperator, RuleAction, SimpleCondition } from "./engine.ts";
import { RULE_FIELDS } from "./rule-fields.ts";

const OPERATORS: ConditionOperator[] = [
  "EMPTY",
  "NOT_EMPTY",
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "LESS_THAN",
  "BEFORE",
  "AFTER",
  "DIFFERS_BY_MORE_THAN",
  "FLAG_TRUE",
  "FLAG_FALSE",
];
const NO_VALUE_OPERATORS = new Set<ConditionOperator>(["EMPTY", "NOT_EMPTY", "FLAG_TRUE", "FLAG_FALSE"]);
const ACTIONS: RuleAction[] = ["AUTOMATIC", "AI_SUGGESTION", "ASK_STAFF"];

export type ParsedCondition = SimpleCondition | { error: string };

/** One "field OPERATOR[:tolerance] value" term. */
export function parseCondition(term: string): ParsedCondition {
  const t = term.trim();
  const m = t.match(/^([a-z0-9_]+)\s+([A-Z_]+)(?::(-?\d+(?:\.\d+)?))?(?:\s+(.+))?$/i);
  if (!m) return { error: `cannot read condition "${t}"` };
  const [, field, opRaw, tolRaw, rest] = m;
  const operator = opRaw!.toUpperCase() as ConditionOperator;
  if (!OPERATORS.includes(operator)) return { error: `unknown operator "${opRaw}" in "${t}"` };
  if (!Object.hasOwn(RULE_FIELDS, field!)) return { error: `unknown field "${field}" in "${t}"` };
  const cond: SimpleCondition = { field: field!, operator };
  if (tolRaw) cond.toleranceAmount = Number(tolRaw);

  if (NO_VALUE_OPERATORS.has(operator)) {
    if (rest) return { error: `"${operator}" takes no compared value ("${t}")` };
    return cond;
  }
  if (!rest) return { error: `"${operator}" needs a compared value ("${t}")` };
  const r = rest.trim();
  if (r === "TODAY" || /^TODAY[+-]\d+d?$/.test(r)) {
    cond.compareValue = "TODAY";
    const offsetMatch = r.match(/^TODAY([+-]\d+)d?$/);
    if (offsetMatch) cond.offsetDays = Number(offsetMatch[1]);
  } else if (Object.hasOwn(RULE_FIELDS, r)) {
    cond.compareField = r;
  } else if (/^-?\d+(\.\d+)?$/.test(r)) {
    cond.compareValue = Number(r);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(r)) {
    cond.compareValue = r;
  } else {
    return { error: `cannot read the compared value "${r}" in "${t}"` };
  }
  return cond;
}

export interface ConditionGroup {
  logic: "AND" | "OR";
  conditions: SimpleCondition[];
}

export function parseConditionGroup(expr: string): ConditionGroup | { error: string } {
  const hasAnd = expr.includes("&&");
  const hasOr = expr.includes("||");
  if (hasAnd && hasOr) return { error: 'cannot mix "&&" and "||" in one condition; use only one' };
  const logic: "AND" | "OR" = hasOr ? "OR" : "AND";
  const parts = expr
    .split(hasOr ? "||" : "&&")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { error: "condition is empty" };
  if (parts.length > 5) return { error: "at most 5 conditions are allowed" };
  const conditions: SimpleCondition[] = [];
  for (const p of parts) {
    const c = parseCondition(p);
    if ("error" in c) return c;
    conditions.push(c);
  }
  return { logic, conditions };
}

export interface RuleUploadDraft {
  ruleId: string;
  title: string;
  severity: "E" | "W";
  action: RuleAction;
  hospitalFilter: string | null;
  schemeFilter: string | null;
  insurerFilter: string | null;
  validFrom: string | null;
  validTo: string | null;
  checkDefinition: { kind: "SIMPLE"; logic: "AND" | "OR"; conditions: SimpleCondition[]; issueField: string };
  staffMessage: string;
}

export interface RuleUploadRow {
  /** 1-based, matching what a spreadsheet shows (row 1 is the header). */
  row: number;
  ok: boolean;
  error?: string;
  draft?: RuleUploadDraft;
}

export const RULE_UPLOAD_HEADER = [
  "rule_id",
  "title",
  "severity",
  "action",
  "hospital_filter",
  "scheme_filter",
  "insurer_filter",
  "valid_from",
  "valid_to",
  "condition",
  "issue_field",
  "staff_message",
] as const;

// Must match the database check constraint on rules.rule_id exactly (migration
// 20261024000002): a row this regex accepts must never fail at save time.
const RULE_ID_RE = /^R-[A-Z][0-9]{2}$/;

/** Validates one data row already split into cells, in RULE_UPLOAD_HEADER's column order. */
export function parseRuleUploadRow(cells: string[], rowNumber: number): RuleUploadRow {
  const raw: Record<string, string> = {};
  RULE_UPLOAD_HEADER.forEach((h, i) => (raw[h] = (cells[i] ?? "").trim()));

  const ruleId = raw.rule_id!.toUpperCase();
  if (!RULE_ID_RE.test(ruleId)) return { row: rowNumber, ok: false, error: `Rule ID "${raw.rule_id}" is missing or not shaped like R-A01.` };
  if (!raw.title) return { row: rowNumber, ok: false, error: "Title is required." };
  const severity = raw.severity!.toUpperCase();
  if (severity !== "E" && severity !== "W") return { row: rowNumber, ok: false, error: `Severity must be E or W, got "${raw.severity}".` };
  const action = raw.action!.toUpperCase();
  if (!ACTIONS.includes(action as RuleAction)) return { row: rowNumber, ok: false, error: `Action must be AUTOMATIC, AI_SUGGESTION or ASK_STAFF, got "${raw.action}".` };
  if (!raw.condition) return { row: rowNumber, ok: false, error: "Condition is required." };
  const group = parseConditionGroup(raw.condition!);
  if ("error" in group) return { row: rowNumber, ok: false, error: group.error };
  const issueField = raw.issue_field || group.conditions[0]!.field;
  if (!Object.hasOwn(RULE_FIELDS, issueField)) return { row: rowNumber, ok: false, error: `Unknown issue field "${issueField}".` };
  if (!raw.staff_message) return { row: rowNumber, ok: false, error: "Staff message is required." };

  return {
    row: rowNumber,
    ok: true,
    draft: {
      ruleId,
      title: raw.title!,
      severity: severity as "E" | "W",
      action: action as RuleAction,
      hospitalFilter: raw.hospital_filter || null,
      schemeFilter: raw.scheme_filter || null,
      insurerFilter: raw.insurer_filter || null,
      validFrom: raw.valid_from || null,
      validTo: raw.valid_to || null,
      checkDefinition: { kind: "SIMPLE", logic: group.logic, conditions: group.conditions, issueField },
      staffMessage: raw.staff_message!,
    },
  };
}

/** A grid of cells (first row the header, already stripped by the caller) -> one result per data row. */
export function parseRuleUploadGrid(dataRows: string[][]): RuleUploadRow[] {
  return dataRows.map((cells, i) => parseRuleUploadRow(cells, i + 2));
}

/** Minimal CSV line split: double-quoted cells, "" is an escaped quote inside one. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseRuleUploadCsv(text: string): RuleUploadRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  return parseRuleUploadGrid(lines.slice(1).map(splitCsvLine));
}
