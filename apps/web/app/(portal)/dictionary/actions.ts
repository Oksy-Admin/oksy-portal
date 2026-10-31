"use server";

import { revalidatePath } from "next/cache";
import { BULK_MAX, type DictionaryKind } from "@/lib/dictionary";
import { can, canConfirmDictionary } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { timed } from "@/lib/timing";

/** The spelling a decision is for: one kind + scheme (+ hospital for the per-hospital kinds). */
export interface DictionaryRef {
  kind: DictionaryKind;
  scheme: string;
  hospitalCode: string | null;
  spellingKey: string;
}

/** Confirm or reject one spelling (decide_dictionary_entry). A confirmed row is never overwritten in place: a later change retires it and adds a new current row. */
export async function decideDictionaryAction(ref: DictionaryRef, status: "CONFIRMED" | "REJECTED", standardValue: string, reason?: string) {
  return timed("action decide_dictionary_entry", async () => {
    const me = await getMe();
    if (!canConfirmDictionary(me)) {
      return { ok: false, error: "Only Owner, Admin or users with the Hospitals edit tick can decide dictionary entries." };
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("decide_dictionary_entry", {
      p_kind: ref.kind,
      p_scheme: ref.scheme,
      p_hospital_code: ref.hospitalCode,
      p_spelling_key: ref.spellingKey,
      p_status: status,
      p_standard_value: standardValue,
      p_reason: reason ?? null,
    });
    if (error) return { ok: false, error: `Failed to save the decision: ${error.message}` };
    revalidatePath("/dictionary");
    return { ok: true, id: data as string };
  });
}

/**
 * "Confirm all" (Stage 1b-ii pattern): Owner / Admin confirm up to 50 undecided spellings of
 * one kind + hospital + scheme, each as another hospital of the scheme already confirmed it.
 */
export async function bulkConfirmDictionaryAction(kind: DictionaryKind, scheme: string, hospitalCode: string, items: Array<{ spellingKey: string; standardValue: string }>) {
  return timed("action bulk_confirm_dictionary", async () => {
    const me = await getMe();
    if (!can(me?.role, "helper_work")) return { ok: false as const, error: "Only Owner or Admin can confirm entries in bulk." };
    if (items.length === 0 || items.length > BULK_MAX) return { ok: false as const, error: `Choose 1 to ${BULK_MAX} entries.` };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("bulk_confirm_dictionary", {
      p_kind: kind,
      p_scheme: scheme,
      p_hospital_code: hospitalCode,
      p_items: items.map((i) => ({ spelling_key: i.spellingKey, standard_value: i.standardValue })),
    });
    if (error) return { ok: false as const, error: `Nothing was confirmed: ${error.message}` };
    revalidatePath("/dictionary");
    return { ok: true as const, batchId: data as string };
  });
}

/** Undo of one bulk confirm: its entries are undecided (Suggested) again, unless someone changed one since. */
export async function undoDictionaryBatchAction(batchId: string) {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) return { ok: false as const, error: "Only Owner or Admin can undo a bulk confirm." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_dictionary_batch", { p_batch_id: batchId });
  if (error) return { ok: false as const, error: `Not undone: ${error.message}` };
  revalidatePath("/dictionary");
  return { ok: true as const, count: data as number };
}
