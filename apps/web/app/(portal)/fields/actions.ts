"use server";

import { cleanAliases, FIELD_TYPES, type FieldType } from "@oksy/rules/fields";
import { revalidatePath } from "next/cache";
import { splitAliases } from "@/lib/fields";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";

export type FieldResult = { ok: true; key?: string } | { ok: false; error: string };

const DENIED: FieldResult = { ok: false, error: "Only Owner or Admin can change the field list." };

async function allowed() {
  const me = await getMe();
  return can(me?.role, "helper_work");
}

/** Label, type and aliases checked before the database (which checks them again). */
function checkInput(label: string, type: string, aliasesText: string): { label: string; type: FieldType; aliases: string[] } | { error: string } {
  const l = label.trim();
  if (!l || l.length > 80) return { error: "A field needs a label of 1 to 80 characters." };
  if (!(FIELD_TYPES as readonly string[]).includes(type)) return { error: "Type must be text, number, date or amount." };
  const a = cleanAliases(splitAliases(aliasesText));
  if ("error" in a) return a;
  return { label: l, type: type as FieldType, aliases: a.aliases };
}

function refresh() {
  revalidatePath("/fields");
  revalidatePath("/mappings");
}

export async function createFieldAction(label: string, type: string, aliasesText: string): Promise<FieldResult> {
  if (!(await allowed())) return DENIED;
  const input = checkInput(label, type, aliasesText);
  if ("error" in input) return { ok: false, error: input.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_mapping_field", { p_label: input.label, p_data_type: input.type, p_aliases: input.aliases });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, key: data as string };
}

/** Rename changes only the label; the key stays, so mappings never break. */
export async function updateFieldAction(key: string, label: string, type: string, aliasesText: string): Promise<FieldResult> {
  if (!(await allowed())) return DENIED;
  const input = checkInput(label, type, aliasesText);
  if ("error" in input) return { ok: false, error: input.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_mapping_field", { p_key: key, p_label: input.label, p_data_type: input.type, p_aliases: input.aliases });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, key };
}

export async function setFieldStatusAction(key: string, status: "ACTIVE" | "HIDDEN"): Promise<FieldResult> {
  if (!(await allowed())) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_mapping_field_status", { p_key: key, p_status: status });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, key };
}

/** Only an unused, non-core field can be deleted; the database refuses otherwise ("in use, hide instead"). */
export async function deleteFieldAction(key: string): Promise<FieldResult> {
  if (!(await allowed())) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_mapping_field", { p_key: key });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}
