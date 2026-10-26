"use server";

import { revalidatePath } from "next/cache";
import { isRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

// Both actions call database functions that check for ADMIN themselves; a non-ADMIN
// calling these gets the database's refusal, whatever the screen shows.
export async function setUserRole(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = form.get("role");
  const displayName = String(form.get("display_name") ?? "").trim() || null;
  if (!email.includes("@") || !isRole(role)) return { ok: false, message: "Enter an email and pick a role." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", {
    p_email: email,
    p_role: role,
    p_display_name: displayName,
    p_reason: "set in portal",
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/users");
  return { ok: true, message: `${email} is now ${role}.` };
}

export async function retireUser(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const supabase = await createClient();
  const { error } = await supabase.rpc("retire_user", { p_email: email, p_reason: "retired in portal" });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/users");
  return { ok: true, message: `${email} is retired (kept in history).` };
}
