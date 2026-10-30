// Prints the mapping_fields seed rows for the 35 core fields (migration 20261027000028).
// The test packages/worker/test/field-seed.test.ts checks the migration still matches.
//   node packages/worker/scripts/field-seed.ts
import { coreFieldDefs, type FieldDef } from "@oksy/rules";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function seedLine(f: FieldDef): string {
  const aliases = f.aliases.length ? `ARRAY[${f.aliases.map(q).join(", ")}]` : "ARRAY[]::text[]";
  return `  (${q(f.key)}, ${q(f.label)}, ${q(f.data_type)}, ${aliases}, 'ACTIVE', true, ${f.sort_order})`;
}

export function seedLines(): string[] {
  return coreFieldDefs().map(seedLine);
}

/** Core fields whose aliases a later migration changed (Stage 1b-i, decisions 30-Oct). */
export const ALIASES_CHANGED_1B = ["patient_ip_no", "followup_log", "remarks"];

/** The alias update of migration 20261030194846 for one field. */
export function aliasUpdateLine(f: FieldDef): string {
  return `UPDATE public.mapping_fields SET aliases = ARRAY[${f.aliases.map(q).join(", ")}], updated_at = now() WHERE key = ${q(f.key)};`;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(seedLines().join(",\n"));
