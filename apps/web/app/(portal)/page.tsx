import Link from "next/link";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { icons } from "./icons";
import { NotBuilt } from "./ui";
import { withTiming } from "@/lib/timing";

// Home (dashboard, module F). Shows only real numbers from the database; parts whose data
// does not exist yet say which milestone brings them. "—" means the number could not be read.
async function Home() {
  const me = await getMe();
  const supabase = await createClient();

  const [hospitals, tabs, reads] = await Promise.all([
    supabase.from("hospitals").select("hospital_code", { count: "exact", head: true }),
    supabase.from("sheet_tabs").select("policy"),
    supabase.from("google_events").select("id", { count: "exact", head: true }).eq("path", "READ"),
  ]);
  const tabCount = (p: string) => (tabs.data ? tabs.data.filter((t) => t.policy === p).length : null);
  const reviewTabs = tabCount("REVIEW");

  const show = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-IN"));
  const kpis = [
    { label: "Hospitals in the portal", value: show(hospitals.count), note: "From the register import (Hospitals page)", icon: icons.hospital, tone: "tone-blue" },
    { label: "Sheet tabs allowed", value: show(tabCount("ALLOW")), note: "Only ALLOW tabs are read", icon: icons.sheet, tone: "tone-green" },
    { label: "Tabs waiting for a decision", value: show(reviewTabs), note: "REVIEW = not read", icon: icons.alert, tone: "tone-amber" },
    { label: "Google reads logged", value: show(reads.count), note: "Tab lists and tab reads", icon: icons.reports, tone: "tone-purple" },
  ];

  return (
    <div className="stack">
      <div>
        <h1>Welcome to Oksy Data Cleaning Portal</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Fresh data. Clean claims. Better outcomes.
        </p>
      </div>

      <div className="grid grid-4">
        {kpis.map((k) => (
          <div key={k.label} className="card kpi">
            <span className={`icon ${k.tone}`}>{k.icon}</span>
            <div>
              <div className="value">{k.value}</div>
              <div className="label">{k.label}</div>
              <div className="label">{k.note}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Row classification</h2>
          <NotBuilt milestone="M7">
            Rows are classified CLEAN, AUTO_FIXED, NEEDS_STAFF_INPUT or REJECTED when the cleaning engine runs.
          </NotBuilt>
        </div>
        <div className="card">
          <h2>Scheme rollout</h2>
          <table className="data">
            <tbody>
              {["PRIVATE", "MEDISEP", "KASP", "Others"].map((s) => (
                <tr key={s}>
                  <td>{s}</td>
                  <td className="muted">{s === "PRIVATE" ? "Fast track in progress (M1 to M10)" : "Not started"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Daily run</h2>
          <NotBuilt milestone="M9">
            The 6:00 AM run, the 6:00 PM evening check and &quot;Check now&quot; run as background jobs, one per sheet.
          </NotBuilt>
        </div>
        <div className="card">
          <h2>Alerts</h2>
          {reviewTabs ? (
            <ul className="list-plain">
              <li>
                {reviewTabs} sheet tab{reviewTabs === 1 ? "" : "s"} still REVIEW (not read until decided).{" "}
                {can(me?.role, "helper_work") && <Link href="/admin/tabs">Decide tabs</Link>}
              </li>
            </ul>
          ) : (
            <p className="muted">No alerts from the data that exists today. Stale-sheet alerts (3 and 7 working days) come in M9.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default withTiming("/", Home);
