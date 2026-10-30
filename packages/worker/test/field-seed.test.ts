import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seedLines } from "../scripts/field-seed.ts";

// Migration 20261027000028 seeds mapping_fields from the code list (packages/rules/src/fields.ts).
const MIGRATION = new URL("../../../supabase/migrations/20261027143126_mapping_fields.sql", import.meta.url);

describe("mapping_fields seed", () => {
  it("the migration seeds exactly the 35 core fields of the code list", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    for (const line of seedLines()) expect(sql).toContain(line);
    expect(sql.match(/, 'ACTIVE', true, \d+\)/g)).toHaveLength(35);
  });
});
