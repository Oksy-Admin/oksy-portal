import { readFileSync } from "node:fs";
import { coreFieldDefs } from "@oksy/rules";
import { describe, expect, it } from "vitest";
import { aliasUpdateLine, ALIASES_CHANGED_1B, FIELDS_CHANGED_1_NOV, labelAliasUpdateLine, seedLine } from "../scripts/field-seed.ts";

// Migration 20261027000028 seeds mapping_fields from the code list (packages/rules/src/fields.ts);
// migration 20261030194846 (Stage 1b-i) changed the aliases of three core fields; migration
// 20261101150000 (1-Nov, TDS rate vs amount headers) changes tds_amount_stated's label/aliases.
const MIGRATION = new URL("../../../supabase/migrations/20261027143126_mapping_fields.sql", import.meta.url);
const MIGRATION_1B = new URL("../../../supabase/migrations/20261030194846_mapping_header_decisions.sql", import.meta.url);
const MIGRATION_1_NOV = new URL("../../../supabase/migrations/20261101150000_tds_rate_amount_headers.sql", import.meta.url);

describe("mapping_fields seed", () => {
  it("the migration seeds exactly the 35 core fields of the code list", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const skip = [...ALIASES_CHANGED_1B, ...FIELDS_CHANGED_1_NOV];
    for (const f of coreFieldDefs()) if (!skip.includes(f.key)) expect(sql).toContain(seedLine(f));
    expect(sql.match(/, 'ACTIVE', true, \d+\)/g)).toHaveLength(35);
  });

  it("the Stage 1b-i migration sets the changed aliases to the code list", () => {
    const sql = readFileSync(MIGRATION_1B, "utf8");
    for (const f of coreFieldDefs().filter((x) => ALIASES_CHANGED_1B.includes(x.key))) expect(sql).toContain(aliasUpdateLine(f));
  });

  it("the 1-Nov migration (written, not applied) sets the changed label/aliases to the code list", () => {
    const sql = readFileSync(MIGRATION_1_NOV, "utf8");
    for (const f of coreFieldDefs().filter((x) => FIELDS_CHANGED_1_NOV.includes(x.key))) expect(sql).toContain(labelAliasUpdateLine(f));
  });
});
