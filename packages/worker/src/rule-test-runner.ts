// Rule Library "test before save" (stage-plan 2d): a draft rule is run once, outside the
// page request (which would time out at 130 hospitals, same reasoning as sheet-run.ts), on
// the stored claims of its own scope -- read only; never writes a claim or an issue.
import { contextFromStoredClaim, evaluateRule, ruleInScope, type CheckDefinition, type DateBasis, type EngineRule, type RuleAction, type RuleContext, type RuleVersion, type StoredClaimRow } from "@oksy/rules";
import type { Db } from "./db.ts";

export interface RuleTestDraft {
  ruleId: string;
  type: "CHECK" | "PARAMETER";
  severity: "E" | "W";
  action: RuleAction;
  staffMessage: string;
  checkDefinition: CheckDefinition | null;
  hospitalFilter: string | null;
  schemeFilter: string | null;
  insurerFilter: string | null;
  validFrom: string | null;
  validTo: string | null;
  dateBasis: DateBasis | null;
}

export interface RuleTestExample {
  hospitalCode: string;
  tab: string;
  row: number;
}

export interface RuleTestResult {
  claimsScanned: number;
  hitsByHospital: Record<string, number>;
  examples: RuleTestExample[];
}

const CLAIM_COLUMNS = [
  "record_uid",
  "hospital_code",
  "scheme",
  "insurer_name",
  "tpa_name",
  "admission_date",
  "discharge_date",
  "casesheet_sent_date",
  "settlement_date",
  "bill_amount",
  "claimed_amount",
  "approved_amount",
  "discount_amount",
  "deduction_amount",
  "settled_amount",
  "tds_amount",
  "expected_tds_amount",
  "expected_settlement_amount",
  "balance_amount",
  "los_days",
  "claim_status",
  "patient_name",
  "preauth_or_claim_no",
  "department",
  "treatment_or_surgery",
  "doctor_name",
  "utr_no",
  "rejection_reason",
  "cancellation_reason",
  "source_tab",
  "source_row",
].join(",");

/** Scope narrowing pushed to the query itself; the per-claim scheme/insurer/date window
 * check still runs in selectRules's own ruleInScope, so the two can never disagree. */
function scopeFilterQuery(draft: RuleTestDraft): string {
  const parts: string[] = [];
  if (draft.hospitalFilter) parts.push(`hospital_code=eq.${encodeURIComponent(draft.hospitalFilter)}`);
  if (draft.schemeFilter) parts.push(`scheme=eq.${encodeURIComponent(draft.schemeFilter)}`);
  return parts.length ? `&${parts.join("&")}` : "";
}

export const MAX_EXAMPLES = 5;

export async function runRuleTest(db: Db, draft: RuleTestDraft, today = new Date().toISOString().slice(0, 10)): Promise<RuleTestResult> {
  if (draft.type !== "CHECK" || !draft.checkDefinition) {
    return { claimsScanned: 0, hitsByHospital: {}, examples: [] };
  }
  const rows = await db.select<StoredClaimRow>(`claims_staging?select=${CLAIM_COLUMNS}${scopeFilterQuery(draft)}&limit=20000`);
  const rule: EngineRule = {
    ruleId: draft.ruleId,
    version: 0,
    severity: draft.severity,
    checkDefinition: draft.checkDefinition,
    action: draft.action,
    staffMessage: draft.staffMessage,
  };
  const scopeLike: RuleVersion = {
    ruleId: draft.ruleId,
    version: 0,
    type: "CHECK",
    status: "ACTIVE",
    hospitalFilter: draft.hospitalFilter,
    schemeFilter: draft.schemeFilter,
    insurerFilter: draft.insurerFilter,
    validFrom: draft.validFrom,
    validTo: draft.validTo,
    dateBasis: draft.dateBasis,
  };

  const hitsByHospital: Record<string, number> = {};
  const examples: RuleTestExample[] = [];
  for (const row of rows) {
    const scope: RuleContext = {
      hospital: row.hospital_code,
      scheme: row.scheme,
      insurer: row.insurer_name,
      tpa: row.tpa_name,
      dates: { admission: row.admission_date, discharge: row.discharge_date, settlement: row.settlement_date },
    };
    if (!ruleInScope(scopeLike, scope)) continue;
    const ctx = contextFromStoredClaim(row, today);
    if (evaluateRule(rule, ctx).length === 0) continue;
    hitsByHospital[row.hospital_code] = (hitsByHospital[row.hospital_code] ?? 0) + 1;
    if (examples.length < MAX_EXAMPLES) examples.push({ hospitalCode: row.hospital_code, tab: row.source_tab, row: row.source_row });
  }
  return { claimsScanned: rows.length, hitsByHospital, examples };
}

export async function claimNextRuleTest(db: Db): Promise<{ id: string; draft: RuleTestDraft } | null> {
  const [next] = await db.select<{ id: string; draft: RuleTestDraft }>(
    "rule_test_runs?status=eq.QUEUED&order=requested_at&limit=1&select=id,draft",
  );
  if (!next) return null;
  await db.update(`rule_test_runs?id=eq.${next.id}&status=eq.QUEUED`, { status: "RUNNING", started_at: new Date().toISOString() });
  return next;
}

export async function runOneRuleTest(db: Db, job: { id: string; draft: RuleTestDraft }): Promise<"SUCCEEDED" | "FAILED"> {
  try {
    const result = await runRuleTest(db, job.draft);
    await db.update(`rule_test_runs?id=eq.${job.id}`, { status: "SUCCEEDED", finished_at: new Date().toISOString(), result });
    return "SUCCEEDED";
  } catch (e) {
    await db.update(`rule_test_runs?id=eq.${job.id}`, {
      status: "FAILED",
      finished_at: new Date().toISOString(),
      error: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300),
    });
    return "FAILED";
  }
}
