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
  const [list, mappingsRes] = await Promise.all([
    loadFieldList(supabase),
    supabase.from("column_mappings").select("canonical_field, status").neq("status", "RETIRED"),
  ]);

  // How many hospital columns use each field (confirmed and proposed).
  const usage: Record<string, FieldUsage> = {};
  for (const m of mappingsRes.data ?? []) {
    if (!m.canonical_field) continue;
    const u = (usage[m.canonical_field] ??= { approved: 0, proposed: 0 });
    if (m.status === "APPROVED") u.approved++;
    else u.proposed++;
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
