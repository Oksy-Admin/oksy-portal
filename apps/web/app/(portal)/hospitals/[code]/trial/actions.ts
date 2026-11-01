"use server";

import { revalidatePath } from "next/cache";
import { checkCheckSetClaim, KEY_VALUE_FIELDS, type KeyValues, type OpenIssueRef } from "@oksy/rules";
import { can, canEditRuleLibrary, canViewRuleLibrary } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { timed } from "@/lib/timing";

export type ActionResult = { ok: boolean; message: string };

const NO_TRIAL_RIGHTS = "Only Owner, Admin or a user with the Rule Library add/edit tick can run a trial.";
const NO_APPROVE_RIGHTS = "Only Owner or Admin can do this.";

// The dynamic column list below is a `string`, not a literal, so supabase-js cannot pattern-
// match it against the generated Database type (same issue as claims/page.tsx's own SELECT);
// cast around it rather than writing the key-value fields out twice.
const KEY_VALUE_SELECT: string = ["record_uid", ...KEY_VALUE_FIELDS].join(",");
type KeyValueRow = { record_uid: string } & KeyValues;

export interface QueueTrialResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** Queues a rule trial (stage-plan 2e): runs once in the worker, every ACTIVE rule, on the
 * hospital's stored claims -- never inside this request, never creating a question. */
export async function queueRuleTrialAction(hospitalCode: string): Promise<QueueTrialResult> {
  return timed("action queue rule trial", async () => {
    const me = await getMe();
    if (!canEditRuleLibrary(me)) return { ok: false, error: NO_TRIAL_RIGHTS };
    const supabase = await createClient();
    const { data, error } = await supabase.from("rule_trials").insert({ hospital_code: hospitalCode }).select("id").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: (data as { id: string }).id };
  });
}

export interface RuleTrialExampleData {
  tab: string;
  row: number;
}

export interface RuleTrialRuleSummaryData {
  severity: "E" | "W";
  hits: number;
  examples: RuleTrialExampleData[];
}

export interface RuleTrialSummaryData {
  totalClaims: number;
  cleanClaims: number;
  byRule: Record<string, RuleTrialRuleSummaryData>;
}

export interface RuleTrialStatus {
  ok: boolean;
  error?: string;
  status?: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "STOPPED";
  summary?: RuleTrialSummaryData | null;
  jobError?: string | null;
  approvedAt?: string | null;
}

export async function getRuleTrialResultAction(id: string): Promise<RuleTrialStatus> {
  return timed("action read rule trial", async () => {
    const me = await getMe();
    if (!me) return { ok: false, error: "Not signed in." };
    const supabase = await createClient();
    const { data, error } = await supabase.from("rule_trials").select("status, summary, error, approved_at").eq("id", id).single();
    if (error || !data) return { ok: false, error: error?.message ?? "Rule trial not found." };
    const row = data as { status: RuleTrialStatus["status"]; summary: RuleTrialSummaryData | null; error: string | null; approved_at: string | null };
    return { ok: true, status: row.status, summary: row.summary, jobError: row.error, approvedAt: row.approved_at };
  });
}

/** "Owner approves once" (stage-plan 2e): Owner/Admin only, and only once the trial finished. */
export async function approveRuleTrialAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const trialId = String(form.get("trial_id") ?? "");
  const hospitalCode = String(form.get("hospital_code") ?? "");
  const note = String(form.get("note") ?? "").trim() || null;
  if (!trialId) return { ok: false, message: "Trial ID is required." };
  const me = await getMe();
  if (!can(me?.role, "approve_rules")) return { ok: false, message: NO_APPROVE_RIGHTS };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_rule_trial", { p_trial_id: trialId, p_note: note });
  if (error) return { ok: false, message: error.message };
  if (hospitalCode) revalidatePath(`/hospitals/${hospitalCode}/trial`);
  return { ok: true, message: "Trial approved." };
}

export interface CheckSetRow {
  id: string;
  recordUid: string;
  claimNumber: string | null;
  pickedAt: string;
  pass: boolean;
  changedFields: string[];
  openIssues: OpenIssueRef[];
}

/** Live pass/fail (stage-plan 2e): compares each picked claim's snapshot against its current
 * stored values and current open issues -- never cached, so it can never go stale. */
export async function listCheckSetClaimsAction(hospitalCode: string): Promise<{ ok: boolean; error?: string; rows?: CheckSetRow[] }> {
  return timed("action list check set claims", async () => {
    const me = await getMe();
    if (!canViewRuleLibrary(me)) return { ok: false, error: "Only Owner, Admin or a user with the Rule Library view tick can see check sets." };
    const supabase = await createClient();
    const { data: picks, error } = await supabase
      .from("check_set_claims")
      .select("id, record_uid, claim_number, key_values, picked_at")
      .eq("hospital_code", hospitalCode)
      .order("picked_at");
    if (error) return { ok: false, error: error.message };
    const recordUids = (picks ?? []).map((p) => p.record_uid as string);
    if (recordUids.length === 0) return { ok: true, rows: [] };

    const [{ data: current, error: curErr }, { data: issues, error: issErr }] = (await Promise.all([
      supabase.from("claims_staging").select(KEY_VALUE_SELECT).in("record_uid", recordUids),
      supabase.from("issues").select("record_uid, rule_id, severity").eq("status", "OPEN").in("severity", ["E", "W"]).in("record_uid", recordUids),
    ])) as unknown as [
      { data: KeyValueRow[] | null; error: { message: string } | null },
      { data: Array<{ record_uid: string; rule_id: string; severity: "E" | "W" }> | null; error: { message: string } | null },
    ];
    if (curErr) return { ok: false, error: curErr.message };
    if (issErr) return { ok: false, error: issErr.message };

    const currentByUid = new Map((current ?? []).map((c) => [c.record_uid, c]));
    const issuesByUid = new Map<string, OpenIssueRef[]>();
    for (const row of issues ?? []) {
      issuesByUid.set(row.record_uid, [...(issuesByUid.get(row.record_uid) ?? []), { ruleId: row.rule_id, severity: row.severity }]);
    }

    const rows: CheckSetRow[] = (picks ?? []).map((p) => {
      const cur = currentByUid.get(p.record_uid as string);
      const currentKeyValues = Object.fromEntries(KEY_VALUE_FIELDS.map((f) => [f, cur?.[f] ?? null])) as KeyValues;
      const result = checkCheckSetClaim(p.key_values as KeyValues, currentKeyValues, issuesByUid.get(p.record_uid as string) ?? []);
      return {
        id: p.id as string,
        recordUid: p.record_uid as string,
        claimNumber: p.claim_number as string | null,
        pickedAt: p.picked_at as string,
        pass: result.pass,
        changedFields: result.changedFields,
        openIssues: result.openIssues,
      };
    });
    return { ok: true, rows };
  });
}

export interface ClaimOption {
  recordUid: string;
  claimNumber: string | null;
  status: string;
}

/** Search by claim number, Settled claims first (they no longer change, stage-plan 2e). */
export async function searchClaimsForPickAction(hospitalCode: string, query: string): Promise<{ ok: boolean; error?: string; rows?: ClaimOption[] }> {
  return timed("action search claims for pick", async () => {
    const me = await getMe();
    if (!can(me?.role, "approve_rules")) return { ok: false, error: NO_APPROVE_RIGHTS };
    const supabase = await createClient();
    let q = supabase.from("claims_staging").select("record_uid, preauth_or_claim_no, claim_status").eq("hospital_code", hospitalCode).limit(20);
    const term = query.trim();
    if (term) q = q.ilike("preauth_or_claim_no", `%${term}%`);
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? [])
      .map((r) => ({ recordUid: r.record_uid as string, claimNumber: r.preauth_or_claim_no as string | null, status: r.claim_status as string }))
      .sort((a, b) => Number(b.status === "SETTLED") - Number(a.status === "SETTLED"));
    return { ok: true, rows };
  });
}

/** Owner/Admin only, capped at 5 per hospital by pick_check_set_claim itself. */
export async function pickCheckSetClaimAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const recordUid = String(form.get("record_uid") ?? "");
  const hospitalCode = String(form.get("hospital_code") ?? "");
  if (!recordUid) return { ok: false, message: "A claim is required." };
  const me = await getMe();
  if (!can(me?.role, "approve_rules")) return { ok: false, message: NO_APPROVE_RIGHTS };
  const supabase = await createClient();
  const { error } = await supabase.rpc("pick_check_set_claim", { p_record_uid: recordUid });
  if (error) return { ok: false, message: error.message };
  if (hospitalCode) revalidatePath(`/hospitals/${hospitalCode}/trial`);
  return { ok: true, message: "Claim picked for the check set." };
}

/** "A value that changed for a real reason" (stage-plan 2e): one click per claim, with a
 * reason -- re-snapshots the claim's current values so the next check starts from them. */
export async function acceptCheckSetClaimAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = String(form.get("id") ?? "");
  const hospitalCode = String(form.get("hospital_code") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!id) return { ok: false, message: "Check-set claim ID is required." };
  if (!reason) return { ok: false, message: "A reason is required to accept new values." };
  const me = await getMe();
  if (!can(me?.role, "approve_rules")) return { ok: false, message: NO_APPROVE_RIGHTS };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_check_set_claim", { p_id: id, p_reason: reason });
  if (error) return { ok: false, message: error.message };
  if (hospitalCode) revalidatePath(`/hospitals/${hospitalCode}/trial`);
  return { ok: true, message: "New values accepted." };
}
