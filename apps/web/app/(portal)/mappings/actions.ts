"use server";

import { revalidatePath } from "next/cache";
import { createFieldAction } from "../fields/actions";
import { BULK_MAX } from "@/lib/mappings";
import { can, canConfirmMappings } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { timed } from "@/lib/timing";

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
  return timed("action decide_header", async () => {
    const me = await getMe();
    if (!canConfirmMappings(me)) {
      return { ok: false, error: "Only Owner, Admin or users with the Hospitals edit tick can decide column mappings." };
    }
    // decide_header checks the field itself (a field of the list, Ignore, or NULL = extra
    // columns; a hidden field only where it is already chosen): one round trip, not two.
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("decide_header", {
      p_hospital_code: ref.hospitalCode,
      p_scheme: ref.scheme,
      p_header_key: ref.headerKey,
      p_canonical_field: canonicalField || null,
      p_accept_shape: acceptShape,
    });
    if (error) {
      return { ok: false, error: `Failed to save the decision: ${error.message}` };
    }

    revalidatePath("/mappings");
    return { ok: true, columns: data as number };
  });
}

/**
 * "Confirm all" (Stage 1b-ii): Owner / Admin confirm up to 50 undecided headers of one
 * hospital + scheme, each as another hospital of the scheme decided it. One action, one
 * audit entry, undone as a group (bulk_confirm_headers checks every rule again).
 */
export async function bulkConfirmAction(hospitalCode: string, scheme: string, items: Array<{ headerKey: string; field: string | null }>) {
  return timed("action bulk_confirm_headers", async () => {
    const me = await getMe();
    if (!can(me?.role, "helper_work")) return { ok: false as const, error: "Only Owner or Admin can confirm headers in bulk." };
    if (items.length === 0 || items.length > BULK_MAX) return { ok: false as const, error: `Choose 1 to ${BULK_MAX} headers.` };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("bulk_confirm_headers", {
      p_hospital_code: hospitalCode,
      p_scheme: scheme,
      p_items: items.map((i) => ({ header_key: i.headerKey, canonical_field: i.field })),
    });
    if (error) return { ok: false as const, error: `Nothing was confirmed: ${error.message}` };
    revalidatePath("/mappings");
    return { ok: true as const, batchId: data as string };
  });
}

/** Undo of one bulk confirm: its headers are undecided again, unless someone changed one since. */
export async function undoBulkAction(batchId: string) {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) return { ok: false as const, error: "Only Owner or Admin can undo a bulk confirm." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_header_batch", { p_batch_id: batchId });
  if (error) return { ok: false as const, error: `Not undone: ${error.message}` };
  revalidatePath("/mappings");
  return { ok: true as const, count: data as number };
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
