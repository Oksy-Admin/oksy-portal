import Link from "next/link";
import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { NoAccess, PageHead, Pill } from "../../ui";
import { TabPolicyForm } from "./forms";
import { withTiming } from "@/lib/timing";

// Tab allow-list (file 05 section 2): only ALLOW tabs are ever read. Each decision is
// saved under the signed-in person's login (decided_by) and written to the audit log.
async function TabsPage() {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) return <NoAccess title="Sheet tabs" who="HELPER, APPROVER or ADMIN" />;

  const supabase = await createClient();
  const { data: tabs, error } = await supabase
    .from("sheet_tabs")
    .select("spreadsheet_id, tab_name, policy, kind, decided_at, first_seen_at")
    .order("spreadsheet_id")
    .order("first_seen_at")
    .order("tab_name");

  return (
    <>
      <p style={{ margin: "0 0 8px" }}>
        <Link href="/hospitals">‹ Hospitals</Link>
      </p>
      <PageHead
        title="Sheet tabs (allow-list)"
        subtitle="Default deny: a tab is read only when it is ALLOW with a kind. Tabs with logins or passwords (for example PORTAL LIST) are always DENY. Your decision is saved under your login and kept in the audit log."
      />
      {error ? (
        <p role="alert">Could not load tabs: {error.message}</p>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Sheet</th>
                <th>Tab</th>
                <th>Now</th>
                <th>Decided</th>
                <th>Decide</th>
              </tr>
            </thead>
            <tbody>
              {(tabs ?? []).map((t) => (
                <tr key={t.spreadsheet_id + "|" + t.tab_name}>
                  <td title={t.spreadsheet_id}>…{t.spreadsheet_id.slice(-6)}</td>
                  <td>{t.tab_name}</td>
                  <td>
                    <Pill value={t.policy} />
                    {t.kind ? ` ${t.kind}` : ""}
                  </td>
                  <td>{t.decided_at ? new Date(t.decided_at).toLocaleString("en-IN") : "not yet"}</td>
                  <td>
                    <TabPolicyForm spreadsheetId={t.spreadsheet_id} tabName={t.tab_name} policy={t.policy} kind={t.kind} />
                  </td>
                </tr>
              ))}
              {tabs?.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No tabs listed yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default withTiming("/admin/tabs", TabsPage);
