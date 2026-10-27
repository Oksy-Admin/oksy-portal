import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { withTiming } from "@/lib/timing";
import { icons } from "../icons";
import { NoAccess, PageHead } from "../ui";
import { MappingTable, type ColumnMappingItem } from "./mapping-table";

async function ColumnMappingsPage() {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) {
    return <NoAccess title="Column Mappings" who="Owner or Admin" />;
  }

  const supabase = await createClient();
  const [mappingsRes, hospitalsRes] = await Promise.all([
    supabase
      .from("column_mappings")
      .select("id, hospital_code, spreadsheet_id, tab_name, version_group, header_fp, source_header, source_column, canonical_field, confidence, method, status, approved_at")
      .order("hospital_code")
      .order("tab_name")
      .order("source_column"),
    supabase.from("hospitals").select("hospital_code, hospital_name"),
  ]);

  const items = (mappingsRes.data ?? []) as ColumnMappingItem[];
  const hospitalNames = Object.fromEntries((hospitalsRes.data ?? []).map((h) => [h.hospital_code, h.hospital_name]));

  const totalCount = items.length;
  const approvedCount = items.filter((i) => i.status === "APPROVED").length;
  const proposedCount = items.filter((i) => i.status === "PROPOSED").length;
  const lowConfCount = items.filter((i) => i.confidence < 0.85).length;

  const cards = [
    {
      label: "Total Column Mappings",
      value: totalCount,
      note: `${[...new Set(items.map((i) => i.hospital_code))].length} hospitals mapped`,
      icon: icons.sheet,
      tone: "tone-blue",
    },
    {
      label: "Approved (G1)",
      value: approvedCount,
      note: `${totalCount > 0 ? ((approvedCount / totalCount) * 100).toFixed(0) : 0}% of all columns`,
      icon: icons.claims,
      tone: "tone-green",
    },
    {
      label: "Proposed (Pending)",
      value: proposedCount,
      note: "Auto-generated from header aliases",
      icon: icons.rules,
      tone: proposedCount > 0 ? "tone-amber" : "tone-green",
    },
    {
      label: "Review Flags",
      value: lowConfCount,
      note: "Confidence < 85% or unmatched",
      icon: icons.alert,
      tone: lowConfCount > 0 ? "tone-red" : "tone-green",
    },
  ];

  return (
    <div className="stack">
      <PageHead
        title="Column Mapping Review (G1)"
        subtitle="Confirm each header layout once. For every column choose a field, Ignore (not needed: never read, never in a report), or extra_fields (not decided yet). A layout counts as confirmed only when no column is PROPOSED."
      />

      <div className="grid grid-4">
        {cards.map((c) => (
          <div key={c.label} className="card kpi">
            <span className={`icon ${c.tone}`}>{c.icon}</span>
            <div>
              <div className="value">{c.value}</div>
              <div className="label">{c.label}</div>
              <div className="label">{c.note}</div>
            </div>
          </div>
        ))}
      </div>

      <MappingTable items={items} hospitalNames={hospitalNames} />
    </div>
  );
}

export default withTiming("/mappings", ColumnMappingsPage);
