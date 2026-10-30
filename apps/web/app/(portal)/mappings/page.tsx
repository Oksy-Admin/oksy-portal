import { loadFieldList } from "@/lib/fields";
import { headerItems, type HeaderItem, type StoredColumn, type StoredDecision } from "@/lib/mappings";
import { can, canConfirmMappings } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { withTiming } from "@/lib/timing";
import { icons } from "../icons";
import { NoAccess, PageHead } from "../ui";
import { MappingTable } from "./mapping-table";

async function ColumnMappingsPage() {
  const me = await getMe();
  // Owner, Admin or the Hospitals edit tick confirm mappings (Item 5); new fields stay Owner / Admin.
  if (!canConfirmMappings(me)) {
    return <NoAccess title="Column Mappings" who="Owner, Admin or users with the Hospitals edit tick" />;
  }

  const supabase = await createClient();
  const [columnsRes, decisionsRes, hospitalsRes, fieldList] = await Promise.all([
    supabase
      .from("column_mappings")
      .select("hospital_code, scheme, tab_name, source_header, header_key, canonical_field, status, review_reason")
      .neq("status", "RETIRED"),
    supabase.from("header_decisions").select("hospital_code, scheme, header_key, canonical_field, accept_any_shape, method, decided_at"),
    supabase.from("hospitals").select("hospital_code, hospital_name"),
    loadFieldList(supabase),
  ]);

  const items = headerItems((columnsRes.data ?? []) as StoredColumn[], (decisionsRes.data ?? []) as StoredDecision[]);
  const hospitalNames = Object.fromEntries((hospitalsRes.data ?? []).map((h) => [h.hospital_code, h.hospital_name]));
  const count = (...states: HeaderItem["state"][]) => items.filter((i) => states.includes(i.state)).length;

  const cards = [
    { label: "Headers", value: items.length, note: `${new Set(items.map((i) => i.hospital_code)).size} hospitals`, icon: icons.sheet, tone: "tone-blue" },
    { label: "Decided", value: count("DECIDED"), note: "Used on every tab with the same header", icon: icons.claims, tone: "tone-green" },
    { label: "Needs a decision", value: count("NEEDS_DECISION"), note: "New headers", icon: icons.rules, tone: count("NEEDS_DECISION") > 0 ? "tone-amber" : "tone-green" },
    { label: "Check again", value: count("CHECK_AGAIN"), note: "Values do not fit, or two decisions", icon: icons.alert, tone: count("CHECK_AGAIN") > 0 ? "tone-red" : "tone-green" },
  ];

  return (
    <div className="stack">
      <PageHead
        title="Column Mappings"
        subtitle="Decide each header once per hospital and scheme: a field, Ignore (never read, never in a report), keep in extra columns, or a new field. The decision is used on every tab with the same header. Length of Stay, Settlement Delay, Balance Amount and TDS % are ignored automatically."
      />
      {(columnsRes.error || decisionsRes.error) && (
        <div className="notice warn" role="status">
          <span>Could not read the mapping decisions: {(columnsRes.error ?? decisionsRes.error)?.message}</span>
        </div>
      )}

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

      <MappingTable items={items} hospitalNames={hospitalNames} fields={fieldList.fields} canCreateFields={!fieldList.fromCode && can(me?.role, "helper_work")} />
    </div>
  );
}

export default withTiming("/mappings", ColumnMappingsPage);
