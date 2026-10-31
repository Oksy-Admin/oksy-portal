import { dictionaryItems, type StoredBatch, type StoredEntry } from "@/lib/dictionary";
import { can, canConfirmDictionary } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { withTiming } from "@/lib/timing";
import { icons } from "../icons";
import { NoAccess, PageHead } from "../ui";
import { DictionaryTable } from "./dictionary-table";

async function WordsAndNamesPage() {
  const me = await getMe();
  if (!canConfirmDictionary(me)) {
    return <NoAccess title="Words & Names" who="Owner, Admin or users with the Hospitals edit tick" />;
  }

  const supabase = await createClient();
  const [entriesRes, batchesRes, hospitalsRes] = await Promise.all([
    supabase
      .from("dictionary_entries")
      .select("id, kind, scheme, hospital_code, spelling_key, spelling_raw, standard_value, status, evidence, reason, decided_at")
      .neq("status", "RETIRED"),
    supabase.from("dictionary_entry_batches").select("id, kind, scheme, hospital_code, item_count, created_at, undone_at").is("undone_at", null).order("created_at", { ascending: false }).limit(20),
    supabase.from("hospitals").select("hospital_code, hospital_name"),
  ]);

  const items = dictionaryItems((entriesRes.data ?? []) as StoredEntry[]);
  const hospitalNames = Object.fromEntries((hospitalsRes.data ?? []).map((h) => [h.hospital_code, h.hospital_name]));
  const count = (...states: Array<(typeof items)[number]["state"]>) => items.filter((i) => states.includes(i.state)).length;

  const cards = [
    { label: "Words & names", value: items.length, note: "Status words, colours, insurer, TPA, department, doctor", icon: icons.fields, tone: "tone-blue" },
    { label: "Decided", value: count("DECIDED"), note: "Applied automatically from here on", icon: icons.claims, tone: "tone-green" },
    { label: "Needs a decision", value: count("NEEDS_DECISION"), note: "New spellings, listed once", icon: icons.rules, tone: count("NEEDS_DECISION") > 0 ? "tone-amber" : "tone-green" },
    { label: "Rejected", value: count("REJECTED"), note: "Not a real value; never asked again", icon: icons.alert, tone: "tone-blue" },
  ];

  return (
    <div className="stack">
      <PageHead
        title="Words & Names"
        subtitle="Status words, colours, insurer / TPA / department names and doctor names, decided once per hospital (or once per scheme for insurer, TPA and department). A confirmed word is applied automatically from the next run; a new spelling is listed once, never guessed. Decisions of other hospitals of the same scheme are pre-filled for status words and doctor names; Owner and Admin can confirm them all at once (at most 50, undo as a group)."
      />
      {(entriesRes.error || batchesRes.error) && (
        <div className="notice warn" role="status">
          <span>Could not read the dictionary: {(entriesRes.error ?? batchesRes.error)?.message}</span>
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

      <DictionaryTable items={items} batches={(batchesRes.data ?? []) as StoredBatch[]} hospitalNames={hospitalNames} canBulk={can(me?.role, "helper_work")} />
    </div>
  );
}

export default withTiming("/dictionary", WordsAndNamesPage);
