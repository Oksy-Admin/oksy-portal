import type { CheckDefinition, DateBasis, RuleAction as EngineRuleAction } from "@oksy/rules";
import { can, canEditRuleLibrary, canViewRuleLibrary } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { NoAccess, PageHead } from "../ui";
import { RuleTable, type RuleRowData } from "./rule-table";
import { withTiming } from "@/lib/timing";

interface RuleVersionRecord {
  id: string;
  version: number;
  status: string;
  severity: "E" | "W" | null;
  action: EngineRuleAction | null;
  staff_message: string | null;
  hospital_filter: string | null;
  scheme_filter: string | null;
  insurer_filter: string | null;
  valid_from: string | null;
  valid_to: string | null;
  date_basis: DateBasis | null;
  check_definition: CheckDefinition | null;
  parameter_name: string | null;
  parameter_value: number | null;
  needs_review: boolean;
}

interface RuleRecord {
  rule_id: string;
  rule_type: "CHECK" | "PARAMETER";
  title: string;
  rule_versions: RuleVersionRecord[];
}

async function RulesPage() {
  const me = await getMe();
  if (!canViewRuleLibrary(me)) {
    return <NoAccess title="Rule Library" who="Owner, Admin or users with the Rule Library view tick" />;
  }

  const canEdit = canEditRuleLibrary(me);
  const canApprove = can(me?.role, "approve_rules");
  const supabase = await createClient();

  const [rulesRes, issuesRes, hospitalsRes] = await Promise.all([
    supabase
      .from("rules")
      .select(`
        rule_id,
        rule_type,
        title,
        rule_versions (
          id, version, status, severity, action, staff_message,
          hospital_filter, scheme_filter, insurer_filter, valid_from, valid_to, date_basis,
          check_definition, parameter_name, parameter_value, needs_review
        )
      `)
      .order("rule_id"),
    supabase.from("issues").select("rule_id").eq("status", "OPEN"),
    supabase.from("hospitals").select("hospital_code, hospital_name").order("hospital_name"),
  ]);

  const rules = (rulesRes.data as unknown as RuleRecord[]) ?? [];
  const hitsByRule = new Map<string, number>();
  for (const row of issuesRes.data ?? []) {
    hitsByRule.set(row.rule_id, (hitsByRule.get(row.rule_id) ?? 0) + 1);
  }

  const initialRules: RuleRowData[] = rules.map((r) => {
    const sortedVersions = (r.rule_versions ?? []).sort((a, b) => b.version - a.version);
    const latest = sortedVersions[0] ?? null;
    return {
      rule_id: r.rule_id,
      rule_type: r.rule_type,
      title: r.title,
      latest_version: latest,
      hits: hitsByRule.get(r.rule_id) ?? 0,
    };
  });

  const hospitalOptions = (hospitalsRes.data ?? []).map((h) => ({ code: h.hospital_code as string, name: h.hospital_name as string }));

  const activeCount = initialRules.filter((r) => r.latest_version?.status === "ACTIVE").length;
  const proposedCount = initialRules.filter((r) => r.latest_version?.status === "PROPOSED").length;
  const referenceCount = initialRules.filter((r) => r.latest_version?.status === "REFERENCE").length;
  const retiredCount = initialRules.filter((r) => r.latest_version?.status === "RETIRED").length;

  const cards = [
    { label: "Active Rules", value: activeCount, note: "Used in cleaning", tone: "tone-green" },
    { label: "Proposed", value: proposedCount, note: "Saved, not yet activated", tone: "tone-blue" },
    { label: "Reference Rules", value: referenceCount, note: "Code only, not editable here", tone: "tone-purple" },
    { label: "Retired Rules", value: retiredCount, note: "Delete = Inactive; history kept", tone: "tone-amber" },
  ];

  return (
    <div className="stack">
      <PageHead
        title="Rule Library"
        subtitle="Every check comes from here, never from code. Add, upload, edit (keeps history) or retire a rule; test it against the stored claims of its own scope before saving; a conflict with another rule is shown before you save over it."
      />

      {(rulesRes.error || issuesRes.error || hospitalsRes.error) && (
        <div className="notice warn" role="alert">
          <strong>Cannot load the Rule Library:</strong> {(rulesRes.error ?? issuesRes.error ?? hospitalsRes.error)?.message}
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

      <RuleTable initialRules={initialRules} hospitalOptions={hospitalOptions} canEdit={canEdit} canApprove={canApprove} />
    </div>
  );
}

export default withTiming("/rules", RulesPage);
