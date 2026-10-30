// Dev only (Playwright, Stage 1b-ii): the Column Mappings table fed by the pilot golden
// fixtures (headers only, no cell value), with HMS shown as if it were a new hospital.
// Not built into production: notFound() outside `next dev`. Saving here goes through the
// real server actions, which refuse because nobody is logged in.
import { readFileSync } from "node:fs";
import path from "node:path";
import { coreFieldDefs } from "@oksy/rules/fields";
import { notFound } from "next/navigation";
import { headerItems, type StoredBatch, type StoredColumn, type StoredDecision } from "@/lib/mappings";
import { MappingTable } from "../../(portal)/mappings/mapping-table";

interface Fixture {
  hospital_code: string;
  scheme: string;
  tabs: Array<{ tab: string; columns: Array<{ header: string }> }>;
  decisions: Array<{ scheme: string; header_key: string; canonical_field: string | null }>;
}

const fixture = (code: string): Fixture =>
  JSON.parse(readFileSync(path.join(process.cwd(), "../../packages/rules/test/fixtures/pilots", `${code}.json`), "utf8")) as Fixture;

export default function MappingsPreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  const [bad, tree, hms] = ["HOSPPVTP0001", "HOSPPVTP0002", "HOSPPVTP0003"].map(fixture) as [Fixture, Fixture, Fixture];
  const decisions: StoredDecision[] = [bad, tree].flatMap((f) =>
    f.decisions.map((d) => ({ ...d, hospital_code: f.hospital_code, accept_any_shape: false, method: "MANUAL", decided_at: "2026-10-31T05:00:00Z" })),
  );
  const columns: StoredColumn[] = hms.tabs.flatMap((t) =>
    t.columns
      .filter((c) => c.header)
      .map((c) => ({ hospital_code: hms.hospital_code, scheme: hms.scheme, tab_name: t.tab, source_header: c.header, header_key: null, canonical_field: null, status: "PROPOSED", review_reason: null })),
  );
  const batches: StoredBatch[] = [{ id: "00000000-0000-0000-0000-000000000000", hospital_code: tree.hospital_code, scheme: tree.scheme, item_count: 3, created_at: "2026-10-31T05:00:00Z", undone_at: null }];
  const treeColumns: StoredColumn[] = [{ hospital_code: tree.hospital_code, scheme: tree.scheme, tab_name: "OCT 2026", source_header: "TDS", header_key: null, canonical_field: null, status: "PROPOSED", review_reason: null }];
  return (
    <main style={{ padding: 24 }}>
      <h1>Column Mappings preview (dev only, fixture data)</h1>
      <MappingTable
        items={headerItems([...columns, ...treeColumns], decisions)}
        batches={batches}
        hospitalNames={{ HOSPPVTP0001: "Badagara (fixture)", HOSPPVTP0002: "Tree G (fixture)", HOSPPVTP0003: "HMS (fixture, as new)" }}
        fields={coreFieldDefs()}
        canCreateFields={false}
        canBulk
      />
    </main>
  );
}
