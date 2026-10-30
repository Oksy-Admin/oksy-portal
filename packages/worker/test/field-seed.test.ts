import { readFileSync } from "node:fs";
import { coreFieldDefs } from "@oksy/rules";
import { describe, expect, it } from "vitest";
import { aliasUpdateLine, ALIASES_CHANGED_1B, seedLine } from "../scripts/field-seed.ts";

// Migration 20261027000028 seeds mapping_fields from the code list (packages/rules/src/fields.ts);
// migration 20261031090000 (Stage 1b-i) changed the aliases of three core fields.
const MIGRATION = new URL("../../../supabase/migrations/20261027143126_mapping_fields.sql", import.meta.url);
const MIGRATION_1B = new URL("../../../supabase/migrations/20261031090000_mapping_header_decisions.sql", import.meta.url);

describe("mapping_fields seed", () => {
  it("the migration seeds exactly the 35 core fields of the code list", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    for (const f of coreFieldDefs()) if (!ALIASES_CHANGED_1B.includes(f.key)) expect(sql).toContain(seedLine(f));
    expect(sql.match(/, 'ACTIVE', true, \d+\)/g)).toHaveLength(35);
  });

  it("the Stage 1b-i migration sets the changed aliases to the code list", () => {
    const sql = readFileSync(MIGRATION_1B, "utf8");
    for (const f of coreFieldDefs().filter((x) => ALIASES_CHANGED_1B.includes(x.key))) expect(sql).toContain(aliasUpdateLine(f));
  });
});
