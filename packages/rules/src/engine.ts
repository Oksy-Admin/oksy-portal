// Rule engine (Stage 2a, decisions.md section 9 "rules are never hard-coded").
// Pure code: evaluates the check_definition stored on a rule_version against a flat
// context of already-cleaned values. The engine itself (operators, calculated kinds)
// is fixed code; every number, field, scope, severity, action and message a rule uses
// comes from the rule_version row, never from here.
import { Money } from "./money.ts";

export type EngineValue = string | number | boolean | null;

/** The row's cleaned values and flags, one flat map (dates as ISO text, amounts as decimal text). */
export interface EngineContext {
  today: string; // ISO
  values: Record<string, EngineValue>;
}

export type ConditionOperator =
  | "EMPTY"
  | "NOT_EMPTY"
  | "EQUALS"
  | "NOT_EQUALS"
  | "GREATER_THAN"
  | "LESS_THAN"
  | "BEFORE"
  | "AFTER"
  | "DIFFERS_BY_MORE_THAN"
  | "FLAG_TRUE"
  | "FLAG_FALSE";

/** One condition: a context field, compared with another field, a literal, or TODAY ± offsetDays. */
export interface SimpleCondition {
  field: string;
  operator: ConditionOperator;
  compareField?: string;
  compareValue?: string | number; // literal value, or "TODAY" for a date operator
  offsetDays?: number; // only with compareValue "TODAY": today + offsetDays
  toleranceAmount?: number; // EQUALS / DIFFERS_BY_MORE_THAN on amounts; default 0
}

/** Most rules: 1-5 conditions, all ANDed or all ORed, one issue field for the whole rule. */
export interface SimpleCheckDefinition {
  kind: "SIMPLE";
  logic: "AND" | "OR";
  conditions: SimpleCondition[];
  issueField: string;
}

/** R-N04 shape: the same single condition checked once per field in the list (one issue per failing field). */
export interface SimpleForEachCheckDefinition {
  kind: "SIMPLE_FOR_EACH";
  fieldList: string[];
  operator: ConditionOperator;
  compareField?: string;
  compareValue?: string | number;
  offsetDays?: number;
  toleranceAmount?: number;
}

export type CheckDefinition = SimpleCheckDefinition | SimpleForEachCheckDefinition;

export type RuleAction = "AUTOMATIC" | "AI_SUGGESTION" | "ASK_STAFF";

/** The parts of a rule_version the engine needs, beyond selection.ts's scope fields. */
export interface EngineRule {
  ruleId: string;
  version: number;
  severity: "E" | "W";
  checkDefinition: CheckDefinition | null;
  action: RuleAction;
  staffMessage: string | null;
}

export interface EngineIssue {
  ruleId: string;
  version: number;
  severity: "E" | "W";
  field: string;
  action: RuleAction;
  message: string;
}

function isEmptyValue(v: EngineValue | undefined): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

/** A resolved date, as ISO text, or null if it cannot be worked out (never a guess). */
function resolveDate(ctx: EngineContext, c: Pick<SimpleCondition, "compareField" | "compareValue" | "offsetDays">): string | null {
  if (c.compareField) {
    const v = ctx.values[c.compareField];
    return typeof v === "string" ? v : null;
  }
  if (c.compareValue === "TODAY") {
    const offset = c.offsetDays ?? 0;
    if (offset === 0) return ctx.today;
    const d = new Date(`${ctx.today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }
  return typeof c.compareValue === "string" ? c.compareValue : null;
}

/** A resolved amount, as a Money, or null if either side cannot be read (never a guess). */
function resolveAmount(ctx: EngineContext, c: Pick<SimpleCondition, "compareField" | "compareValue">): InstanceType<typeof Money> | null {
  const raw = c.compareField ? ctx.values[c.compareField] : c.compareValue;
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw);
  return /^-?\d+(\.\d+)?$/.test(s) ? new Money(s) : null;
}

function amountOf(v: EngineValue | undefined): InstanceType<typeof Money> | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? new Money(s) : null;
}

/** One condition against one field value (used directly, and once per field for SIMPLE_FOR_EACH). */
function evaluateOne(
  ctx: EngineContext,
  field: string,
  operator: ConditionOperator,
  rest: Pick<SimpleCondition, "compareField" | "compareValue" | "offsetDays" | "toleranceAmount">,
): boolean {
  const v = ctx.values[field];
  switch (operator) {
    case "EMPTY":
      return isEmptyValue(v);
    case "NOT_EMPTY":
      return !isEmptyValue(v);
    case "FLAG_TRUE":
      return v === true;
    case "FLAG_FALSE":
      return v === false;
    case "EQUALS":
    case "NOT_EQUALS": {
      const a = amountOf(v);
      const b = resolveAmount(ctx, rest);
      let eq: boolean;
      if (a !== null && b !== null) {
        const tol = new Money(rest.toleranceAmount ?? 0);
        eq = a.minus(b).abs().lte(tol);
      } else {
        const cmp = rest.compareField ? ctx.values[rest.compareField] : rest.compareValue;
        if (isEmptyValue(v) || isEmptyValue(cmp)) return false; // never guess on missing data
        eq = v === cmp;
      }
      return operator === "EQUALS" ? eq : !eq;
    }
    case "GREATER_THAN":
    case "LESS_THAN": {
      const a = amountOf(v);
      const b = resolveAmount(ctx, rest);
      if (a === null || b === null) return false;
      return operator === "GREATER_THAN" ? a.greaterThan(b) : a.lessThan(b);
    }
    case "BEFORE":
    case "AFTER": {
      if (typeof v !== "string" || !v) return false;
      const b = resolveDate(ctx, rest);
      if (!b) return false;
      return operator === "BEFORE" ? v < b : v > b;
    }
    case "DIFFERS_BY_MORE_THAN": {
      const a = amountOf(v);
      const b = resolveAmount(ctx, rest);
      if (a === null || b === null) return false;
      const tol = new Money(rest.toleranceAmount ?? 0);
      return a.minus(b).abs().greaterThan(tol);
    }
  }
}

function fillMessage(template: string, ctx: EngineContext, field: string): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = key === "field" ? field : ctx.values[key];
    return v === null || v === undefined ? "?" : String(v);
  });
}

/**
 * Runs one ACTIVE rule against a row's context. Returns one issue per match: SIMPLE gives
 * at most one (its declared issueField); SIMPLE_FOR_EACH gives one per failing field in its list.
 */
export function evaluateRule(rule: EngineRule, ctx: EngineContext): EngineIssue[] {
  const def = rule.checkDefinition;
  if (!def) return [];
  const message = rule.staffMessage ?? rule.ruleId;
  if (def.kind === "SIMPLE_FOR_EACH") {
    const hits: EngineIssue[] = [];
    for (const field of def.fieldList) {
      if (evaluateOne(ctx, field, def.operator, def)) {
        hits.push({ ruleId: rule.ruleId, version: rule.version, severity: rule.severity, field, action: rule.action, message: fillMessage(message, ctx, field) });
      }
    }
    return hits;
  }
  const results = def.conditions.slice(0, 5).map((c) => evaluateOne(ctx, c.field, c.operator, c));
  const matched = def.logic === "OR" ? results.some(Boolean) : results.length > 0 && results.every(Boolean);
  if (!matched) return [];
  return [{ ruleId: rule.ruleId, version: rule.version, severity: rule.severity, field: def.issueField, action: rule.action, message: fillMessage(message, ctx, def.issueField) }];
}

export function evaluateRules(rules: EngineRule[], ctx: EngineContext): EngineIssue[] {
  return rules.flatMap((r) => evaluateRule(r, ctx));
}

/**
 * The ctx fields a check definition actually reads (Stage 2c, decisions.md section 9: a
 * "value is correct" confirmation's fingerprint is made from only these, never the issueField
 * by itself, since issueField is just where the issue is attached, not necessarily read).
 * Generic over any check: never a per-rule list, so a rule can still change without code.
 */
export function fieldsReadBy(def: CheckDefinition): string[] {
  const fields = new Set<string>();
  if (def.kind === "SIMPLE_FOR_EACH") {
    for (const f of def.fieldList) fields.add(f);
    if (def.compareField) fields.add(def.compareField);
    return [...fields];
  }
  for (const c of def.conditions.slice(0, 5)) {
    fields.add(c.field);
    if (c.compareField) fields.add(c.compareField);
  }
  return [...fields];
}
