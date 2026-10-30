"use server";

import { IGNORE_FIELD } from "@oksy/rules/fields";
import { revalidatePath } from "next/cache";
import { createFieldAction } from "../fields/actions";
import { loadFieldList } from "@/lib/fields";
import { can, canConfirmMappings } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";

export async function approveMappingAction(mappingId: string, canonicalField: string | null) {
  const me = await getMe();
  if (!canConfirmMappings(me)) {
    return { ok: false, error: "Only Owner, Admin or users with the Hospitals edit tick can approve column mappings (G1)." };
  }
  // A field of the list, Ignore, or empty (extra_fields); nothing else reaches the database.
  // A hidden field is refused for a new mapping by the database (it stays on a row that has it).
  const supabase = await createClient();
  const choice = canonicalField || null;
  const { fields } = await loadFieldList(supabase);
  if (choice !== null && choice !== IGNORE_FIELD && !fields.some((f) => f.key === choice)) {
    return { ok: false, error: "Unknown field. Choose a field from the list, Ignore, or extra_fields." };
  }

  const { error } = await supabase.rpc("approve_column_mapping", {
    p_id: mappingId,
    p_canonical_field: choice,
  });

  if (error) {
    return { ok: false, error: `Failed to approve mapping: ${error.message}` };
  }

  revalidatePath("/mappings");
  return { ok: true };
}

export async function approveVersionGroupAction(spreadsheetId: string, headerFp: string) {
  const me = await getMe();
  if (!canConfirmMappings(me)) {
    return { ok: false, error: "Only Owner, Admin or users with the Hospitals edit tick can approve column mappings (G1)." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_version_group_mappings", {
    p_spreadsheet_id: spreadsheetId,
    p_header_fp: headerFp,
  });

  if (error) {
    return { ok: false, error: `Failed to approve group: ${error.message}` };
  }

  revalidatePath("/mappings");
  return { ok: true, count: data };
}

/** "+ Create new field" on a column: creates the field, then maps (approves) the column to it. */
export async function createFieldAndMapAction(mappingId: string, label: string, type: string, aliasesText: string) {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) {
    return { ok: false as const, error: "Only Owner or Admin can create fields and approve column mappings (G1)." };
  }
  const created = await createFieldAction(label, type, aliasesText);
  if (!created.ok || !created.key) return { ok: false as const, error: created.ok ? "Field not created." : created.error };
  const mapped = await approveMappingAction(mappingId, created.key);
  if (!mapped.ok) return { ok: false as const, error: `Field "${label.trim()}" was created, but the column was not mapped: ${mapped.error}` };
  return { ok: true as const, key: created.key };
}
