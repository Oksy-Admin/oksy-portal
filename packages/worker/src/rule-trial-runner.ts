// Rule trial (stage-plan 2e): "Run now" with trial for one hospital runs every ACTIVE rule
// on its full stored data, without creating questions, and stores a summary (never a patient
// name or a cell value, hard rules 1, 10) -- outside the page request, same reasoning and
// shape as the "test before save" job (rule-test-runner.ts), but for the whole rule set
// instead of one draft.
import { contextFromStoredClaim, evaluateRules, selectRules, type EngineRule, type RuleContext, type RuleVersion, type StoredClaimRow } from "@oksy/rules";
import type { Db } from "./db.ts";

export interface RuleTrialExample {
  tab: string;
  row: number;
}

export interface RuleTrialRuleSummary {
  severity: "E" | "W";
  hits: number;
  examples: RuleTrialExample[];
}

export interface RuleTrialSummary {
  totalClaims: number;
  cleanClaims: number;
  byRule: Record<string, RuleTrialRuleSummary>;
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

interface RawRuleVersion {
  rule_id: string;
  version: number;
  status: string;
  hospital_filter: string | null;
  scheme_filter: string | null;
  insurer_filter: string | null;
  valid_from: string | null;
  valid_to: string | null;
  date_basis: string | null;
  severity: "E" | "W" | null;
  check_definition: EngineRule["checkDefinition"];
  action: EngineRule["action"] | null;
  staff_message: string | null;
}

async function loadRuleVersions(db: Db): Promise<RuleVersion[]> {
  const [rawRules, rawVersions] = await Promise.all([
    db.select<{ rule_id: string; rule_type: "CHECK" | "PARAMETER" }>("rules?select=rule_id,rule_type"),
    db.select<RawRuleVersion>(
      "rule_versions?select=rule_id,version,status,hospital_filter,scheme_filter,insurer_filter,valid_from,valid_to,date_basis,severity,check_definition,action,staff_message",
    ),
  ]);
  const ruleTypes = new Map(rawRules.map((r) => [r.rule_id, r.rule_type]));
  return rawVersions.map((v) => ({
    ruleId: v.rule_id,
    version: v.version,
    type: ruleTypes.get(v.rule_id) ?? "CHECK",
    status: v.status as RuleVersion["status"],
    hospitalFilter: v.hospital_filter,
    schemeFilter: v.scheme_filter,
    insurerFilter: v.insurer_filter,
    validFrom: v.valid_from,
    validTo: v.valid_to,
    dateBasis: v.date_basis as RuleVersion["dateBasis"],
    severity: v.severity,
    checkDefinition: v.check_definition,
    action: v.action,
    staffMessage: v.staff_message,
  }));
}

export const MAX_EXAMPLES = 5;

export async function runRuleTrial(db: Db, hospitalCode: string, today = new Date().toISOString().slice(0, 10)): Promise<RuleTrialSummary> {
  const [rows, allVersions] = await Promise.all([
    db.select<StoredClaimRow>(`claims_staging?select=${CLAIM_COLUMNS}&hospital_code=eq.${encodeURIComponent(hospitalCode)}&limit=20000`),
    loadRuleVersions(db),
  ]);

  const byRule: Record<string, RuleTrialRuleSummary> = {};
  let cleanClaims = 0;

  for (const row of rows) {
    const scope: RuleContext = {
      hospital: row.hospital_code,
      scheme: row.scheme,
      insurer: row.insurer_name,
      tpa: row.tpa_name,
      dates: { admission: row.admission_date, discharge: row.discharge_date, settlement: row.settlement_date },
    };
    const sel = selectRules(allVersions, scope);
    const rules: EngineRule[] = sel.checks
      .filter((r): r is RuleVersion & { checkDefinition: NonNullable<RuleVersion["checkDefinition"]>; severity: "E" | "W"; action: NonNullable<RuleVersion["action"]> } =>
        Boolean(r.checkDefinition && r.severity && r.action),
      )
      .map((r) => ({ ruleId: r.ruleId, version: r.version, severity: r.severity, checkDefinition: r.checkDefinition, action: r.action, staffMessage: r.staffMessage ?? null }));

    const ctx = contextFromStoredClaim(row, today);
    const issues = evaluateRules(rules, ctx);
    if (issues.length === 0) cleanClaims++;
    for (const issue of issues) {
      const s = (byRule[issue.ruleId] ??= { severity: issue.severity, hits: 0, examples: [] });
      s.hits++;
      if (s.examples.length < MAX_EXAMPLES) s.examples.push({ tab: row.source_tab, row: row.source_row });
    }
  }

  return { totalClaims: rows.length, cleanClaims, byRule };
}

export async function claimNextRuleTrial(db: Db): Promise<{ id: string; hospitalCode: string } | null> {
  const [next] = await db.select<{ id: string; hospital_code: string }>(
    "rule_trials?status=eq.QUEUED&order=requested_at&limit=1&select=id,hospital_code",
  );
  if (!next) return null;
  await db.update(`rule_trials?id=eq.${next.id}&status=eq.QUEUED`, { status: "RUNNING", started_at: new Date().toISOString() });
  return { id: next.id, hospitalCode: next.hospital_code };
}

export async function runOneRuleTrial(db: Db, job: { id: string; hospitalCode: string }): Promise<"SUCCEEDED" | "FAILED"> {
  try {
    const summary = await runRuleTrial(db, job.hospitalCode);
    await db.update(`rule_trials?id=eq.${job.id}`, { status: "SUCCEEDED", finished_at: new Date().toISOString(), summary });
    return "SUCCEEDED";
  } catch (e) {
    await db.update(`rule_trials?id=eq.${job.id}`, {
      status: "FAILED",
      finished_at: new Date().toISOString(),
      error: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300),
    });
    return "FAILED";
  }
}
