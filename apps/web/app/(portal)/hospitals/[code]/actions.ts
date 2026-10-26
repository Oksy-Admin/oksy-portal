"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";

export type DeskState = { ok: boolean; message: string } | null;

// Desk team Google accounts (D-048): the list a helper shares the Question Sheet with.
// Saving here changes no Drive sharing; the robot never shares (hard rule 2).
export async function addDeskAccount(_prev: DeskState, formData: FormData): Promise<DeskState> {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) return { ok: false, message: "Only HELPER, APPROVER or ADMIN can change desk accounts." };
  const code = String(formData.get("hospital_code") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "That is not an email address." };

  const supabase = await createClient();
  const { error } = await supabase.from("desk_google_accounts").insert({ hospital_code: code, email });
  if (error) {
    return { ok: false, message: error.code === "23505" ? "This account is already on the list." : `Not saved: ${error.message}` };
  }
  revalidatePath(`/hospitals/${code}`);
  return { ok: true, message: `${email} added. Share the Question Sheet with it in Google Drive (helper step).` };
}

// Removing keeps the row (removed_at, removed_by): never delete (hard rule 5).
export async function removeDeskAccount(_prev: DeskState, formData: FormData): Promise<DeskState> {
  const me = await getMe();
  if (!me || !can(me.role, "helper_work")) return { ok: false, message: "Only HELPER, APPROVER or ADMIN can change desk accounts." };
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("hospital_code") ?? "");
  const supabase = await createClient();
  const { error } = await supabase
    .from("desk_google_accounts")
    .update({ removed_at: new Date().toISOString(), removed_by: me.userId })
    .eq("id", id)
    .is("removed_at", null);
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  revalidatePath(`/hospitals/${code}`);
  return { ok: true, message: "Removed from the list. Also remove it from the Question Sheet sharing in Google Drive." };
}
