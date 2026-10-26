import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { NoAccess, PageHead } from "../ui";
import { RuleTable, type RuleRowData } from "./rule-table";
import { withTiming } from "@/lib/timing";

interface RuleVersionRecord {
  id: string;
  version: number;
  status: string;
  severity: string | null;
  tier: string | null;
  parameter_name: string | null;
  parameter_value: number | null;
  condition_text: string;
  action: string | null;
  // needs_review is not selected: the live database has no such column (migration 0018 not applied; stage0_report.md).
  hospital_filter: string | null;
  scheme_filter: string | null;
  insurer_filter: string | null;
}

interface RuleRecord {
  rule_id: string;
  rule_type: "CHECK" | "PARAMETER";
  title: string;
  rule_versions: RuleVersionRecord[];
}

async function RulesPage() {
  const me = await getMe();
  if (!can(me?.role, "view_rule_library")) {
    return <NoAccess title="Rule Library" who="signed-in portal users" />;
  }

  const canApprove = can(me?.role, "approve_rules");
  const supabase = await createClient();

  const { data: rulesData, error: rulesError } = await supabase
    .from("rules")
    .select(`
      rule_id,
      rule_type,
      title,
      rule_versions (
        id,
        version,
        status,
        severity,
        tier,
        parameter_name,
        parameter_value,
        condition_text,
        action,
        hospital_filter,
        scheme_filter,
        insurer_filter
      )
    `)
    .order("rule_id");

  const rules = (rulesData as unknown as RuleRecord[]) ?? [];

  const initialRules: RuleRowData[] = rules.map((r) => {
    // Sort versions descending to pick latest version
    const sortedVersions = (r.rule_versions ?? []).sort((a, b) => b.version - a.version);
    const latest = sortedVersions[0] ?? null;
    return {
      rule_id: r.rule_id,
      rule_type: r.rule_type,
      title: r.title,
      latest_version: latest ? { ...latest, needs_review: false } : null,
      shadow_count: 0,
    };
  });

  const activeCount = initialRules.filter((r) => r.latest_version?.status === "ACTIVE").length;
  const proposedCount = initialRules.filter((r) => r.latest_version?.status === "PROPOSED").length;
  const referenceCount = initialRules.filter((r) => r.latest_version?.status === "REFERENCE").length;
  const retiredCount = initialRules.filter((r) => r.latest_version?.status === "RETIRED").length;

  const cards = [
    { label: "Active Rules", value: activeCount, note: "Used in cleaning", tone: "tone-green" },
    { label: "Proposed / Shadow", value: proposedCount, note: "Shadow mode", tone: "tone-blue" },
    { label: "Reference Rules", value: referenceCount, note: "Seeded catalogue", tone: "tone-purple" },
    { label: "Retired Rules", value: retiredCount, note: "Stopped / Archived", tone: "tone-amber" },
  ];

  return (
    <div className="stack">
      <PageHead
        title="Rule Library"
        subtitle="Versioned rule engine rules. Active rules validate claims; reference items can be reviewed."
      />

      {rulesError && (
        <div className="notice warn" role="alert">
          <strong>Cannot load rules:</strong> {rulesError.message}
        </div>
      )}

      <div className="grid grid-4">
        {cards.map((c) => (
          <div key={c.label} className="card kpi">
            <div>
              <div className="value">{c.value}</div>
              <div className="label">{c.label}</div>
              <div className="label">{c.note}</div>
            </div>
          </div>
        ))}
      </div>

      <RuleTable initialRules={initialRules} canApprove={canApprove} />
    </div>
  );
}

export default withTiming("/rules", RulesPage);
