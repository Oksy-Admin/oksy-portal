// The column-mapping field list for the web pages: the mapping_fields table (Fields page),
// or the built-in core list while the table is not there yet (migration 20261027000028).
import { coreFieldDefs, type FieldDef } from "@oksy/rules/fields";
import type { createClient } from "@/lib/supabase/server";

export interface FieldList {
  fields: FieldDef[];
  /** true = read from the code; the table is missing, so the list cannot be changed yet. */
  fromCode: boolean;
}

export async function loadFieldList(supabase: Awaited<ReturnType<typeof createClient>>): Promise<FieldList> {
  const { data, error } = await supabase
    .from("mapping_fields")
    .select("key, label, data_type, aliases, status, is_core, sort_order")
    .order("sort_order");
  if (error || !data || data.length === 0) return { fields: coreFieldDefs(), fromCode: true };
  return { fields: data as FieldDef[], fromCode: false };
}

/** Aliases typed one per line or separated by commas. */
export function splitAliases(text: string): string[] {
  return text.split(/[\n,]/).map((a) => a.trim()).filter(Boolean);
}
