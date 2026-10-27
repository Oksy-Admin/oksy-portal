"use server";

import { revalidatePath } from "next/cache";
import { isRole, type Role } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

// Approves a user or sets/changes their role.
// Enforced both here and at the DB function level (set_user_role).
export async function setUserRoleAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await getMe();
  if (!me?.role || (me.role !== "OWNER" && me.role !== "ADMIN")) {
    return { ok: false, message: "Only an Owner or Admin can manage users." };
  }

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = form.get("role") as string;
  const displayName = String(form.get("display_name") ?? "").trim() || null;

  if (!email.includes("@") || !isRole(role)) {
    return { ok: false, message: "Enter a valid email and select a role (Owner / Admin / User)." };
  }

  if (role === "OWNER") {
    return { ok: false, message: "There can only be one Owner (Anoop Das)." };
  }

  if (role === "ADMIN" && me.role !== "OWNER") {
    return { ok: false, message: "Only the Owner can assign or change Admin access." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", {
    p_email: email,
    p_role: role as Role,
    p_display_name: displayName,
    p_reason: `role set in portal by ${me.email}`,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/settings/users-and-access");
  return { ok: true, message: `${email} is now ${role}.` };
}

// Retires a user (keeps record in history). Owner cannot be retired.
// Admin can only be retired by Owner.
export async function retireUserAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const me = await getMe();
  if (!me?.role || (me.role !== "OWNER" && me.role !== "ADMIN")) {
    return { ok: false, message: "Only an Owner or Admin can retire users." };
  }

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email) return { ok: false, message: "Email is required." };

  if (email === me.email.toLowerCase()) {
    return { ok: false, message: "You cannot retire yourself." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("retire_user", {
    p_email: email,
    p_reason: `retired in portal by ${me.email}`,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/settings/users-and-access");
  return { ok: true, message: `${email} is retired (record kept in history).` };
}

// Saves access ticks for a user.
export async function saveAccessTicksAction(
  email: string,
  ticks: Record<string, boolean>
): Promise<ActionResult> {
  const me = await getMe();
  if (!me?.role || (me.role !== "OWNER" && me.role !== "ADMIN")) {
    return { ok: false, message: "Only an Owner or Admin can update access ticks." };
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return { ok: false, message: "Email is required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_access_ticks", {
    p_email: cleanEmail,
    p_ticks: ticks,
    p_reason: `access ticks updated in portal by ${me.email}`,
  });

  if (error) return { ok: false, message: error.message };

  revalidatePath("/settings/users-and-access");
  return { ok: true, message: `Access ticks updated for ${cleanEmail}.` };
}
