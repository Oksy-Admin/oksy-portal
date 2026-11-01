import Link from "next/link";
import { notFound } from "next/navigation";
import { can, canEditRuleLibrary, canViewRuleLibrary } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { withTiming } from "@/lib/timing";
import { NoAccess, PageHead } from "../../../ui";
import { listCheckSetClaimsAction } from "./actions";
import { TrialPanel } from "./trial-panel";

// Rule trial and check sets, per hospital (stage-plan 2e). Reached from the hospital page;
// gated by the Rule Library view tick, same as /rules.
async function TrialPage({ params }: { params: Promise<{ code: string }> }) {
  const me = await getMe();
  if (!canViewRuleLibrary(me)) return <NoAccess title="Rule trial" who="users with the Rule Library view tick" />;
  const { code } = await params;
  if (!/^[A-Z0-9]{3,32}$/.test(code)) notFound();

  const supabase = await createClient();
  const { data: h } = await supabase.from("hospitals").select("hospital_code, hospital_name").eq("hospital_code", code).maybeSingle();
  if (!h) notFound();

  const checkSets = await listCheckSetClaimsAction(code);

  return (
    <div className="stack">
      <p style={{ margin: 0 }}>
        <Link href={`/hospitals/${code}`}>‹ {h.hospital_name}</Link>
      </p>
      <PageHead title="Rule trial" subtitle={`${h.hospital_name} · ${h.hospital_code}`} />
      {checkSets.ok ? (
        <TrialPanel hospitalCode={code} canRunTrial={canEditRuleLibrary(me)} canApprove={can(me?.role, "approve_rules")} initialCheckSets={checkSets.rows ?? []} />
      ) : (
        <p role="alert">{checkSets.error}</p>
      )}
    </div>
  );
}

export default withTiming("/hospitals/[code]/trial", TrialPage);
