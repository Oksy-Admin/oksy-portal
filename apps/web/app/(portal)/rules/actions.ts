"use server";

import { revalidatePath } from "next/cache";
import type { CheckDefinition, DateBasis, RuleAction as EngineRuleAction, RuleDraftSuggestion } from "@oksy/rules";
import { suggestRuleDraft } from "@/lib/ai";
import { can, canEditRuleLibrary } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { timed } from "@/lib/timing";

export type ActionResult = { ok: boolean; message: string };

const NO_RIGHTS = "Only Owner, Admin or a user with the Rule Library add/edit tick can do this.";

// G9: only ADMIN or APPROVER (OWNER always passes has_role) can approve or activate a rule.
// The database checks the user's role and writes to rule_approvals and audit_log.
export async function approveRuleVersion(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const ruleVersionId = String(form.get("rule_version_id") ?? "");
  const ruleId = String(form.get("rule_id") ?? "");
  const activate = form.get("activate") !== "false";
  const note = String(form.get("note") ?? "").trim() || null;

  if (!ruleVersionId) return { ok: false, message: "Rule version ID is required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_rule_version", {
    p_rule_version_id: ruleVersionId,
    p_activate: activate,
    p_note: note ?? `Activated via portal: ${ruleId}`,
  });

  if (error) {
    console.error(`approve_rule_version failed for rule "${ruleId}": ${error.code} ${error.message}`);
    return { ok: false, message: error.message };
  }

  revalidatePath("/rules");
  return {
    ok: true,
    message: `Rule ${ruleId} successfully ${activate ? "activated" : "approved"}.`,
  };
}

export async function retireRuleAction(
  _prev: ActionResult | null,
  form: FormData
): Promise<ActionResult> {
  const ruleVersionId = String(form.get("rule_version_id") ?? "");
  const ruleId = String(form.get("rule_id") ?? "");
  const note = String(form.get("note") ?? "Retired via portal");

  if (!ruleVersionId) return { ok: false, message: "Rule version ID is required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("retire_rule_version", {
    p_rule_version_id: ruleVersionId,
    p_note: note,
  });

  if (error) {
    return { ok: false, message: `Could not retire rule: ${error.message}` };
  }

  revalidatePath("/rules");
  return { ok: true, message: `Rule ${ruleId} retired.` };
}

export interface RuleScopeInput {
  hospitalFilter: string | null;
  schemeFilter: string | null;
  insurerFilter: string | null;
  validFrom: string | null;
  validTo: string | null;
  dateBasis: DateBasis | null;
}

export interface SaveCheckRuleInput extends RuleScopeInput {
  ruleId: string;
  title: string;
  severity: "E" | "W";
  action: EngineRuleAction;
  staffMessage: string;
  checkDefinition: CheckDefinition;
  conflictRuleIds?: string[];
  conflictReason?: string;
  uploadBatchId?: string;
}

export interface SaveParameterRuleInput extends RuleScopeInput {
  ruleId: string;
  title: string;
  parameterName: string;
  parameterValue: string;
  conflictRuleIds?: string[];
  conflictReason?: string;
}

export interface SaveRuleResult {
  ok: boolean;
  error?: string;
  version?: number;
}

/** save_rule_version (Stage 2d): always PROPOSED. Activation stays the separate, explicit G9 step. */
export async function saveCheckRuleAction(input: SaveCheckRuleInput): Promise<SaveRuleResult> {
  return timed("action save_rule_version(CHECK)", async () => {
    const me = await getMe();
    if (!canEditRuleLibrary(me)) return { ok: false, error: NO_RIGHTS };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_rule_version", {
      p_rule_id: input.ruleId,
      p_rule_type: "CHECK",
      p_title: input.title,
      p_check_definition: input.checkDefinition,
      p_severity: input.severity,
      p_action: input.action,
      p_staff_message: input.staffMessage,
      p_hospital_filter: input.hospitalFilter,
      p_scheme_filter: input.schemeFilter,
      p_insurer_filter: input.insurerFilter,
      p_valid_from: input.validFrom,
      p_valid_to: input.validTo,
      p_date_basis: input.dateBasis,
      p_conflict_rule_ids: input.conflictRuleIds ?? [],
      p_conflict_reason: input.conflictReason ?? null,
      p_upload_batch_id: input.uploadBatchId ?? null,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/rules");
    return { ok: true, version: data as number };
  });
}

export async function saveParameterRuleAction(input: SaveParameterRuleInput): Promise<SaveRuleResult> {
  return timed("action save_rule_version(PARAMETER)", async () => {
    const me = await getMe();
    if (!canEditRuleLibrary(me)) return { ok: false, error: NO_RIGHTS };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_rule_version", {
      p_rule_id: input.ruleId,
      p_rule_type: "PARAMETER",
      p_title: input.title,
      p_hospital_filter: input.hospitalFilter,
      p_scheme_filter: input.schemeFilter,
      p_insurer_filter: input.insurerFilter,
      p_valid_from: input.validFrom,
      p_valid_to: input.validTo,
      p_date_basis: input.dateBasis,
      p_parameter_name: input.parameterName,
      p_parameter_value: Number(input.parameterValue),
      p_conflict_rule_ids: input.conflictRuleIds ?? [],
      p_conflict_reason: input.conflictReason ?? null,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/rules");
    return { ok: true, version: data as number };
  });
}

export interface RuleTestDraftInput {
  ruleId: string;
  type: "CHECK" | "PARAMETER";
  severity: "E" | "W" | null;
  action: EngineRuleAction | null;
  staffMessage: string | null;
  checkDefinition: CheckDefinition | null;
  hospitalFilter: string | null;
  schemeFilter: string | null;
  insurerFilter: string | null;
  validFrom: string | null;
  validTo: string | null;
  dateBasis: DateBasis | null;
}

export interface QueueTestResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** Queues the draft as a "rule test" job (stage-plan 2d): runs once in the worker, never
 * inside this request, on the stored claims of the draft's own scope, read only. */
export async function queueRuleTestAction(draft: RuleTestDraftInput): Promise<QueueTestResult> {
  return timed("action queue rule test", async () => {
    const me = await getMe();
    if (!canEditRuleLibrary(me)) return { ok: false, error: NO_RIGHTS };
    const supabase = await createClient();
    const { data, error } = await supabase.from("rule_test_runs").insert({ draft }).select("id").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: (data as { id: string }).id };
  });
}

export interface RuleTestExample {
  hospitalCode: string;
  tab: string;
  row: number;
}

export interface RuleTestResultData {
  claimsScanned: number;
  hitsByHospital: Record<string, number>;
  examples: RuleTestExample[];
}

export interface RuleTestStatus {
  ok: boolean;
  error?: string;
  status?: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "STOPPED";
  result?: RuleTestResultData | null;
  jobError?: string | null;
}

export async function getRuleTestResultAction(id: string): Promise<RuleTestStatus> {
  return timed("action read rule test", async () => {
    const me = await getMe();
    if (!me) return { ok: false, error: "Not signed in." };
    const supabase = await createClient();
    const { data, error } = await supabase.from("rule_test_runs").select("status, result, error").eq("id", id).single();
    if (error || !data) return { ok: false, error: error?.message ?? "Test run not found." };
    const row = data as { status: RuleTestStatus["status"]; result: RuleTestResultData | null; error: string | null };
    return { ok: true, status: row.status, result: row.result, jobError: row.error };
  });
}

export interface UploadBatchResult {
  ok: boolean;
  error?: string;
  batchId?: string;
}

/** One audit entry for an upload (Stage 2d, the hospital-upload pattern): "Save N rules"
 * records the batch first; each accepted row is then saved with this batch's id. */
export async function createRuleUploadBatchAction(fileName: string, totalRows: number, acceptedRows: number, rejectedRows: number): Promise<UploadBatchResult> {
  return timed("action create rule upload batch", async () => {
    const me = await getMe();
    if (!canEditRuleLibrary(me)) return { ok: false, error: NO_RIGHTS };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("rule_upload_batches")
      .insert({ file_name: fileName, total_rows: totalRows, accepted_rows: acceptedRows, rejected_rows: rejectedRows })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, batchId: (data as { id: string }).id };
  });
}

export interface UndoUploadResult {
  ok: boolean;
  error?: string;
  count?: number;
}

export async function undoRuleUploadAction(batchId: string): Promise<UndoUploadResult> {
  const me = await getMe();
  if (!can(me?.role, "manage_users")) return { ok: false, error: "Only Owner or Admin can undo a rule upload." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_rule_upload_batch", { p_batch_id: batchId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/rules");
  return { ok: true, count: data as number };
}

export interface PlainWordsResult {
  ok: boolean;
  error?: string;
  suggestion?: RuleDraftSuggestion;
}

/** Plain-words box (decisions.md section 9): no claim or patient data is in the prompt, only
 * the sentence and the fixed field list (packages/rules/src/plain-words.ts). The AI only
 * fills the form; it never saves (that permission is never given to this call). */
export async function suggestRuleFromPlainWordsAction(sentence: string): Promise<PlainWordsResult> {
  return timed("action plain-words rule draft", async () => {
    const me = await getMe();
    if (!canEditRuleLibrary(me)) return { ok: false, error: NO_RIGHTS };
    const trimmed = sentence.trim();
    if (!trimmed) return { ok: false, error: "Type a sentence first." };
    if (trimmed.length > 500) return { ok: false, error: "Keep the sentence under 500 characters." };
    const result = await suggestRuleDraft(trimmed);
    if ("error" in result) return { ok: false, error: result.error };
    return { ok: true, suggestion: result.suggestion };
  });
}
