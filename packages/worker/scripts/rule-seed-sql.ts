// Prints the INSERT statements for the Stage 2a rule seed, from the one list in
// packages/rules/src/initial-rules.ts, so the migration can never drift from the engine
// tests. Run by hand when the seed changes: `node scripts/rule-seed-sql.ts > /tmp/seed.sql`,
// then paste the result into a new migration (never run against live from here).
import { INITIAL_RULES } from "@oksy/rules";

const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;
const orNull = (s: string | null | undefined) => (s == null ? "null" : esc(s));

console.log("insert into public.rules (rule_id, rule_type, title) values");
console.log(
  INITIAL_RULES.map((r) => `  ('${r.ruleId}', '${r.type}', ${esc(r.title)})`).join(",\n") +
    "\non conflict (rule_id) do update set rule_type = excluded.rule_type, title = excluded.title;",
);

// R-T01 (the TDS default rate) is unchanged by Stage 2a: its existing ACTIVE version already
// has everything selectRules needs. Only the CHECK rules (engine + structural) get a fresh
// version row here.
const checkRules = INITIAL_RULES.filter((r) => r.type === "CHECK");

console.log("\ninsert into public.rule_versions");
console.log("  (rule_id, version, status, severity, condition_text, check_definition, action, staff_message, approved_by, approver_note)");
console.log("select v.rule_id, coalesce(mv.max_version, 0) + 1, v.status, v.severity, v.condition_text, v.check_definition::jsonb, v.action, v.staff_message,");
console.log("  (select id from auth.users where email = 'anoop@oksy.in'), 'approved with the Stage 2 plan (31-Oct-2026)'");
console.log("from (values");
console.log(
  checkRules
    .map((r) => {
      const conditionText = r.structuralNote ? esc(r.structuralNote) : "null";
      const checkJson = r.checkDefinition ? esc(JSON.stringify(r.checkDefinition)) : "null";
      const severity = r.severity ? esc(r.severity) : "null";
      const action = r.action ? esc(r.action) : "null";
      const staffMessage = orNull(r.staffMessage);
      return `  (${esc(r.ruleId)}::text, ${esc(r.status)}::public.rule_status, ${severity}::public.rule_severity, ${conditionText}, ${checkJson}, ${action}, ${staffMessage})`;
    })
    .join(",\n"),
);
console.log(") as v(rule_id, status, severity, condition_text, check_definition, action, staff_message)");
console.log("left join (select rule_id, max(version) as max_version from public.rule_versions group by rule_id) mv on mv.rule_id = v.rule_id;");
