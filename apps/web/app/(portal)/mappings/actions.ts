"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";

export async function approveMappingAction(mappingId: string, canonicalField: string | null) {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) {
    return { ok: false, error: "Only HELPER, APPROVER or ADMIN can approve column mappings (G1)." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_column_mapping", {
    p_id: mappingId,
    p_canonical_field: canonicalField || null,
  });

  if (error) {
    return { ok: false, error: `Failed to approve mapping: ${error.message}` };
  }

  revalidatePath("/mappings");
  return { ok: true };
}

export async function approveVersionGroupAction(spreadsheetId: string, headerFp: string) {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) {
    return { ok: false, error: "Only HELPER, APPROVER or ADMIN can approve column mappings (G1)." };
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
