"use server";

import { IGNORE_FIELD } from "@oksy/rules/fields";
import { revalidatePath } from "next/cache";
import { createFieldAction } from "../fields/actions";
import { loadFieldList } from "@/lib/fields";
import { can, canConfirmMappings } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";

/** The header a decision is for: one hospital + scheme + normalised header (Stage 1b-i). */
export interface HeaderRef {
  hospitalCode: string;
  scheme: string;
  headerKey: string;
}

/**
 * Decides one header for a hospital + scheme: a field, Ignore, or null (keep in extra
 * columns). The worker reuses it on every tab with the same header (decide_header).
 */
export async function decideHeaderAction(ref: HeaderRef, canonicalField: string | null, acceptShape = false) {
  const me = await getMe();
  if (!canConfirmMappings(me)) {
    return { ok: false, error: "Only Owner, Admin or users with the Hospitals edit tick can decide column mappings." };
  }
  // A field of the list, Ignore, or empty (extra columns); nothing else reaches the database.
  // A hidden field is refused for a new decision by the database (it stays where it is).
  const supabase = await createClient();
  const choice = canonicalField || null;
  const { fields } = await loadFieldList(supabase);
  if (choice !== null && choice !== IGNORE_FIELD && !fields.some((f) => f.key === choice)) {
    return { ok: false, error: "Unknown field. Choose a field from the list, Ignore, or keep in extra columns." };
  }

  const { data, error } = await supabase.rpc("decide_header", {
    p_hospital_code: ref.hospitalCode,
    p_scheme: ref.scheme,
    p_header_key: ref.headerKey,
    p_canonical_field: choice,
    p_accept_shape: acceptShape,
  });
  if (error) {
    return { ok: false, error: `Failed to save the decision: ${error.message}` };
  }

  revalidatePath("/mappings");
  return { ok: true, columns: data as number };
}

/** "+ Create new field" on a header: creates the field, then decides the header as that field. */
export async function createFieldAndDecideAction(ref: HeaderRef, label: string, type: string, aliasesText: string) {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) {
    return { ok: false as const, error: "Only Owner or Admin can create fields." };
  }
  const created = await createFieldAction(label, type, aliasesText);
  if (!created.ok || !created.key) return { ok: false as const, error: created.ok ? "Field not created." : created.error };
  const decided = await decideHeaderAction(ref, created.key);
  if (!decided.ok) return { ok: false as const, error: `Field "${label.trim()}" was created, but the header was not decided: ${decided.error}` };
  return { ok: true as const, key: created.key };
}
