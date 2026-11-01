// Dev only (Playwright, Stage 2d): the Rule Library table with fake data (no patient data,
// no real Supabase read). Not built into production: notFound() outside `next dev`. Every
// save, test or upload here goes through the real server actions, which refuse because
// nobody is logged in -- the same pattern as /dev/dictionary and /dev/mappings.
import { notFound } from "next/navigation";
import { RuleTable, type RuleRowData } from "../../(portal)/rules/rule-table";

const rules: RuleRowData[] = [
  {
    rule_id: "R-W01",
    rule_type: "CHECK",
    title: "Stay over 30 days",
    hits: 3,
    latest_version: {
      id: "v1",
      version: 1,
      status: "ACTIVE",
      severity: "W",
      action: "ASK_STAFF",
      staff_message: "Length of stay is over 30 days: please confirm the dates are correct.",
      hospital_filter: null,
      scheme_filter: "PRIVATE",
      insurer_filter: null,
      valid_from: null,
      valid_to: null,
      date_basis: null,
      check_definition: { kind: "SIMPLE", logic: "AND", conditions: [{ field: "los_days", operator: "GREATER_THAN", compareValue: 30 }], issueField: "discharge_date" },
      parameter_name: null,
      parameter_value: null,
      needs_review: false,
    },
  },
  {
    rule_id: "R-T01",
    rule_type: "PARAMETER",
    title: "Default TDS rate 10 percent",
    hits: 0,
    latest_version: {
      id: "v2",
      version: 3,
      status: "ACTIVE",
      severity: null,
      action: null,
      staff_message: null,
      hospital_filter: null,
      scheme_filter: null,
      insurer_filter: null,
      valid_from: null,
      valid_to: null,
      date_basis: null,
      check_definition: null,
      parameter_name: "tds_rate",
      parameter_value: 0.1,
      needs_review: false,
    },
  },
  {
    rule_id: "R-C01",
    rule_type: "CHECK",
    title: "Non-data row (separator, total or banner)",
    hits: 0,
    latest_version: {
      id: "v3",
      version: 1,
      status: "REFERENCE",
      severity: null,
      action: null,
      staff_message: null,
      hospital_filter: null,
      scheme_filter: null,
      insurer_filter: null,
      valid_from: null,
      valid_to: null,
      date_basis: null,
      check_definition: null,
      parameter_name: null,
      parameter_value: null,
      needs_review: false,
    },
  },
];

const hospitalOptions = [
  { code: "HOSPPVTP0001", name: "Badagara (fixture)" },
  { code: "HOSPPVTP0002", name: "Tree G (fixture)" },
  { code: "HOSPPVTP0003", name: "HMS (fixture)" },
];

export default function RulesPreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main style={{ padding: 24 }}>
      <h1>Rule Library preview (dev only, fixture data)</h1>
      <RuleTable initialRules={rules} hospitalOptions={hospitalOptions} canEdit canApprove />
    </main>
  );
}
