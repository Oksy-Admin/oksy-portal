// Rule Library "conflict check on save" (stage-plan 2d): same scope + same field with an
// opposite condition or a different number -- for example two TDS rates for the same insurer
// (a PARAMETER conflict) or two stay-length checks for the same scope with different day
// counts (a CHECK conflict). Pure code, run before save.ts; shown to the user, who must give
// a reason to save anyway (selection.ts's EQUAL_SPECIFICITY_CONFLICT is the same idea at
// evaluation time, for the same rule ID -- this check is about two *different* rule IDs).
import { Money } from "./money.ts";
import type { CheckDefinition } from "./engine.ts";

export interface ScopeLike {
  hospitalFilter?: string | null;
  schemeFilter?: string | null;
  insurerFilter?: string | null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Two scopes can both match the same claim: an unset filter means "all", so it overlaps. */
export function scopesOverlap(a: ScopeLike, b: ScopeLike): boolean {
  if (a.hospitalFilter && b.hospitalFilter && a.hospitalFilter !== b.hospitalFilter) return false;
  if (a.schemeFilter && b.schemeFilter && norm(a.schemeFilter) !== norm(b.schemeFilter)) return false;
  if (a.insurerFilter && b.insurerFilter && norm(a.insurerFilter) !== norm(b.insurerFilter)) return false;
  return true;
}

export interface RuleConflict {
  otherRuleId: string;
  otherVersion: number;
  reason: string;
}

export interface ExistingCheckVersion extends ScopeLike {
  ruleId: string;
  version: number;
  type: "CHECK" | "PARAMETER";
  status: string;
  checkDefinition?: CheckDefinition | null;
  parameterName?: string | null;
  parameterValue?: string | null;
}

export interface DraftCheck extends ScopeLike {
  ruleId: string;
  type: "CHECK";
  checkDefinition: CheckDefinition;
}

export interface DraftParameter extends ScopeLike {
  ruleId: string;
  type: "PARAMETER";
  parameterName: string;
  parameterValue: string;
}

const LIVE_STATUSES = new Set(["ACTIVE", "PROPOSED"]);

function numberBoundaries(def: CheckDefinition): Array<{ field: string; operator: string; value: number }> {
  if (def.kind !== "SIMPLE") return [];
  return def.conditions
    .filter((c) => typeof c.compareValue === "number" && !c.compareField)
    .map((c) => ({ field: c.field, operator: c.operator, value: c.compareValue as number }));
}

const OPPOSITE: Record<string, string> = { GREATER_THAN: "LESS_THAN", LESS_THAN: "GREATER_THAN" };

export function findCheckConflicts(draft: DraftCheck, existing: ExistingCheckVersion[]): RuleConflict[] {
  const draftBoundaries = numberBoundaries(draft.checkDefinition);
  if (draftBoundaries.length === 0) return [];
  const conflicts: RuleConflict[] = [];
  for (const r of existing) {
    if (r.type !== "CHECK" || r.ruleId === draft.ruleId || !r.checkDefinition) continue;
    if (!LIVE_STATUSES.has(r.status)) continue;
    if (!scopesOverlap(draft, r)) continue;
    for (const a of draftBoundaries) {
      for (const b of numberBoundaries(r.checkDefinition)) {
        if (a.field !== b.field) continue;
        if (a.operator === b.operator && a.value !== b.value) {
          conflicts.push({
            otherRuleId: r.ruleId,
            otherVersion: r.version,
            reason: `${r.ruleId} v${r.version} checks ${a.field} ${b.operator} ${b.value} for an overlapping scope; this draft checks ${a.value}.`,
          });
        } else if (OPPOSITE[a.operator] === b.operator) {
          conflicts.push({
            otherRuleId: r.ruleId,
            otherVersion: r.version,
            reason: `${r.ruleId} v${r.version} checks ${a.field} ${b.operator} ${b.value}, the opposite direction of this draft's ${a.operator} ${a.value}.`,
          });
        }
      }
    }
  }
  return conflicts;
}

export function findParameterConflicts(draft: DraftParameter, existing: ExistingCheckVersion[]): RuleConflict[] {
  const draftValue = new Money(draft.parameterValue);
  return existing
    .filter(
      (r) =>
        r.type === "PARAMETER" &&
        r.ruleId !== draft.ruleId &&
        r.parameterName === draft.parameterName &&
        r.parameterValue != null &&
        LIVE_STATUSES.has(r.status) &&
        scopesOverlap(draft, r),
    )
    .filter((r) => !new Money(r.parameterValue as string).equals(draftValue))
    .map((r) => ({
      otherRuleId: r.ruleId,
      otherVersion: r.version,
      reason: `${r.ruleId} v${r.version} sets ${draft.parameterName} to ${r.parameterValue} for an overlapping scope; this draft sets ${draft.parameterValue}.`,
    }));
}

export function findRuleConflicts(draft: DraftCheck | DraftParameter, existing: ExistingCheckVersion[]): RuleConflict[] {
  return draft.type === "CHECK" ? findCheckConflicts(draft, existing) : findParameterConflicts(draft, existing);
}
