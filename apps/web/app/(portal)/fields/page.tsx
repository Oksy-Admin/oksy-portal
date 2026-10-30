import { loadFieldList } from "@/lib/fields";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { withTiming } from "@/lib/timing";
import { NoAccess, PageHead } from "../ui";
import { FieldsTable, type FieldUsage } from "./fields-table";

async function FieldsPage() {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) {
    return <NoAccess title="Fields" who="Owner or Admin" />;
  }

  const supabase = await createClient();
  const [list, mappingsRes, decisionsRes] = await Promise.all([
    loadFieldList(supabase),
    supabase.from("column_mappings").select("canonical_field").neq("status", "RETIRED"),
    supabase.from("header_decisions").select("canonical_field"),
  ]);

  // How many header decisions use each field (Stage 1b-i: one per hospital + scheme +
  // header), and how many stored tab columns name it (proposals and older per-tab rows).
  // Both count as "in use" for delete, as in delete_mapping_field.
  const usage: Record<string, FieldUsage> = {};
  for (const d of decisionsRes.data ?? []) {
    if (d.canonical_field) (usage[d.canonical_field] ??= { approved: 0, proposed: 0 }).approved++;
  }
  for (const m of mappingsRes.data ?? []) {
    if (m.canonical_field) (usage[m.canonical_field] ??= { approved: 0, proposed: 0 }).proposed++;
  }

  return (
    <div className="stack">
      <PageHead
        title="Fields"
        subtitle="The fields a hospital column can be mapped to. Every report shows the active fields in this order; a hospital without the column shows blank cells. Renaming changes only the label, so mappings never break."
      />
      {list.fromCode && (
        <div className="notice warn" role="status">
          <span>
            The field list is not in the database yet (migration 20261027000028 is not applied). Showing the built-in 35 fields;
            changes are possible after the migration.
          </span>
        </div>
      )}
      <FieldsTable fields={list.fields} usage={usage} readOnly={list.fromCode} />
    </div>
  );
}

export default withTiming("/fields", FieldsPage);
