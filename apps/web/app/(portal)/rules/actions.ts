"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

// G9: only ADMIN or APPROVER can approve or activate a rule version.
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

export async function createOrUpdateRuleAction(
  _prev: ActionResult | null,
  form: FormData
): Promise<ActionResult> {
  const ruleId = String(form.get("rule_id") ?? "").trim().toUpperCase();
  const ruleType = String(form.get("rule_type") ?? "CHECK").trim().toUpperCase();
  const title = String(form.get("title") ?? "").trim();
  const conditionText = String(form.get("condition_text") ?? "").trim();
  const severity = String(form.get("severity") ?? "W").trim().toUpperCase();
  const tier = String(form.get("tier") ?? "C").trim().toUpperCase();
  const action = String(form.get("action") ?? "").trim() || null;
  const status = String(form.get("status") ?? "PROPOSED").trim().toUpperCase();
  const hospitalFilter = String(form.get("hospital_filter") ?? "").trim().toUpperCase() || null;
  const schemeFilter = String(form.get("scheme_filter") ?? "").trim().toUpperCase() || null;
  const insurerFilter = String(form.get("insurer_filter") ?? "").trim() || null;
  const paramName = String(form.get("parameter_name") ?? "").trim() || null;
  const paramValStr = String(form.get("parameter_value") ?? "").trim();
  const paramValue = paramValStr ? Number(paramValStr) : null;

  if (!ruleId) return { ok: false, message: "Rule ID is required (e.g. R-D01)." };
  if (!title) return { ok: false, message: "Title is required." };
  if (!conditionText) return { ok: false, message: "Condition description is required." };

  const supabase = await createClient();
  const { data: nextVersion, error } = await supabase.rpc("create_or_update_rule", {
    p_rule_id: ruleId,
    p_rule_type: ruleType,
    p_title: title,
    p_condition_text: conditionText,
    p_severity: severity,
    p_tier: tier,
    p_action: action,
    p_status: status,
    p_hospital_filter: hospitalFilter,
    p_scheme_filter: schemeFilter,
    p_insurer_filter: insurerFilter,
    p_parameter_name: paramName,
    p_parameter_value: paramValue,
  });

  if (error) {
    return { ok: false, message: `Could not save rule: ${error.message}` };
  }

  revalidatePath("/rules");
  return { ok: true, message: `Rule ${ruleId} version ${nextVersion} saved with status ${status}.` };
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
