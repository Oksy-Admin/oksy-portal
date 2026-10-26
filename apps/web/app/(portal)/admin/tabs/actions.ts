"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

const POLICIES = ["ALLOW", "DENY", "REVIEW"] as const;
const KINDS = ["DATA", "LOOKUP", "LEGEND", "EXCLUDED"] as const;

// Calls set_tab_policy with the signed-in person's own login: the database checks the
// role (HELPER, APPROVER or ADMIN), stores decided_by and decided_at, writes audit_log,
// and refuses ALLOW for login-like tabs such as PORTAL LIST.
export async function setTabPolicy(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const spreadsheetId = String(form.get("spreadsheet_id") ?? "");
  const tabName = String(form.get("tab_name") ?? "");
  const policy = String(form.get("policy") ?? "");
  const kind = String(form.get("kind") ?? "");
  const note = String(form.get("note") ?? "").trim() || null;
  if (!(POLICIES as readonly string[]).includes(policy)) return { ok: false, message: "Pick a policy." };
  if (kind && !(KINDS as readonly string[]).includes(kind)) return { ok: false, message: "Pick a kind." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_tab_policy", {
    p_spreadsheet_id: spreadsheetId,
    p_tab_name: tabName,
    p_policy: policy,
    p_kind: kind || null,
    p_note: note ?? `set in portal: ${policy}${kind ? " " + kind : ""}`,
  });
  if (error) {
    // Tab names and database messages only (no patient data), so a failed save can be diagnosed.
    console.error(`set_tab_policy failed: tab "${tabName}" ${policy}/${kind || "-"}: ${error.code} ${error.message}`);
    return { ok: false, message: error.message };
  }
  revalidatePath("/admin/tabs");
  return { ok: true, message: `${tabName}: ${policy}${kind ? " (" + kind + ")" : ""} saved.` };
}
