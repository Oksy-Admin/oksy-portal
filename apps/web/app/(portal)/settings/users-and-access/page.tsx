import { can, type AccessTicks, type Role } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { NoAccess, PageHead, Pill } from "../../ui";
import { AccessTicksModal, AddPersonForm, ApprovalForm, RetireButton } from "./forms";
import { withTiming } from "@/lib/timing";

type UserRecord = {
  email: string;
  role: Role;
  display_name: string | null;
  active: boolean;
  user_id: string | null;
  granted_by: string | null;
  granted_at: string | null;
  retired_at: string | null;
};

type TicksRecord = {
  email: string;
  dashboard_view: boolean;
  dashboard_copy_reminders: boolean;
  hospitals_view: boolean;
  hospitals_add_edit: boolean;
  questions_view: boolean;
  questions_mark_answered: boolean;
  clean_data_view: boolean;
  clean_data_download: boolean;
  rule_library_view: boolean;
  rule_library_add_edit: boolean;
  audit_runs_view: boolean;
};

async function UsersAndAccessPage() {
  const me = await getMe();
  if (!me || !can(me.role, "manage_users")) {
    return <NoAccess title="Settings › Users and Access" who="an Admin or the Owner" />;
  }

  const callerRole = me.role as Role;
  const supabase = await createClient();

  // Fetch all users and access ticks in parallel
  const [usersRes, ticksRes] = await Promise.all([
    supabase
      .from("users_roles")
      .select("email, role, display_name, active, user_id, granted_by, granted_at, retired_at")
      .order("email"),
    supabase.from("user_access_ticks").select("*"),
  ]);

  const rawUsers = (usersRes.data ?? []) as UserRecord[];
  const ticksMap = new Map<string, AccessTicks>();
  ((ticksRes.data ?? []) as TicksRecord[]).forEach((t) => {
    ticksMap.set(t.email, {
      dashboard_view: t.dashboard_view,
      dashboard_copy_reminders: t.dashboard_copy_reminders,
      hospitals_view: t.hospitals_view,
      hospitals_add_edit: t.hospitals_add_edit,
      questions_view: t.questions_view,
      questions_mark_answered: t.questions_mark_answered,
      clean_data_view: t.clean_data_view,
      clean_data_download: t.clean_data_download,
      rule_library_view: t.rule_library_view,
      rule_library_add_edit: t.rule_library_add_edit,
      audit_runs_view: t.audit_runs_view,
    });
  });

  // Categorize users:
  // Pending = not active, not retired, not granted_by
  const pendingUsers = rawUsers.filter((u) => !u.active && !u.retired_at && !u.granted_by);
  // Active or Retired people
  const approvedPeople = rawUsers.filter((u) => u.active || Boolean(u.retired_at));

  // Role summary counts
  const ownerCount = approvedPeople.filter((u) => u.active && u.role === "OWNER").length;
  const adminCount = approvedPeople.filter((u) => u.active && u.role === "ADMIN").length;
  const userCount = approvedPeople.filter((u) => u.active && u.role === "USER").length;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <PageHead
        title="Settings › Users and Access"
        subtitle="Manage user approvals, roles, and per-page access ticks. People are never deleted; retiring keeps them in history. Every change is logged."
      />

      {/* 1. Role Cards (requirements v2 section 2.7) */}
      <div className="grid grid-3">
        <div className="card" style={{ borderLeft: "4px solid #8b5cf6" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>Owner</h3>
            <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>{ownerCount}</span>
          </div>
          <p style={{ margin: "8px 0 0", color: "#666", fontSize: "0.9rem" }}>
            Anoop Das (anoop@oksy.in). Full access to all pages and future owner-only areas. Sets Admin access. Cannot be retired.
          </p>
        </div>

        <div className="card" style={{ borderLeft: "4px solid #10b981" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>Admin</h3>
            <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>{adminCount}</span>
          </div>
          <p style={{ margin: "8px 0 0", color: "#666", fontSize: "0.9rem" }}>
            Muhammed Ali (admin@oksy.in). Approves new users and sets their access. An Admin&apos;s own access is set only by the Owner.
          </p>
        </div>

        <div className="card" style={{ borderLeft: "4px solid #6b7280" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>User</h3>
            <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>{userCount}</span>
          </div>
          <p style={{ margin: "8px 0 0", color: "#666", fontSize: "0.9rem" }}>
            Default role. Sees and does only what the Admin or Owner ticked. Cannot open Settings.
          </p>
        </div>
      </div>

      {/* 2. Waiting for approval list (requirements v2 section 2.7 & 3) */}
      <div className="card">
        <h2 style={{ margin: "0 0 4px" }}>Waiting for approval ({pendingUsers.length})</h2>
        <p style={{ margin: "0 0 16px", color: "#666", fontSize: "0.9rem" }}>
          Anyone can sign in with Google to request access. They see no data until an Admin or the Owner approves and sets a role.
          (Shows Google email and display name from profile).
        </p>

        {pendingUsers.length === 0 ? (
          <p style={{ color: "#888", fontStyle: "italic", margin: 0 }}>No new sign-ins waiting for approval.</p>
        ) : (
          <div className="table-wrap" style={{ margin: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Google Email</th>
                  <th>Status</th>
                  <th>Approve as</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pendingUsers.map((u, i) => (
                  <tr key={u.email}>
                    <td>{i + 1}</td>
                    <td><strong>{u.display_name || "—"}</strong></td>
                    <td>{u.email}</td>
                    <td><Pill value="Pending" /></td>
                    <td>
                      <ApprovalForm email={u.email} displayName={u.display_name} callerRole={callerRole} />
                    </td>
                    <td>
                      <RetireButton email={u.email} label="Reject" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. Add-a-person form (requirements v2 section 2.7) */}
      <div className="card">
        <h2 style={{ margin: "0 0 4px" }}>Add a person</h2>
        <p style={{ margin: "0 0 16px", color: "#666", fontSize: "0.9rem" }}>
          Pre-register someone before their first Google sign-in. When they sign in, their login will link automatically.
        </p>
        <AddPersonForm callerRole={callerRole} />
      </div>

      {/* 4. People table with per-person access ticks (requirements v2 section 2.7) */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "16px 20px 12px" }}>
          <h2 style={{ margin: 0 }}>People and Access</h2>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: "0.9rem" }}>
            Click &quot;Access ticks&quot; on any user to view or change per-page permissions.
          </p>
        </div>

        <div className="table-wrap" style={{ margin: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Signed in yet</th>
                <th>Access Ticks</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {approvedPeople.map((u, i) => {
                const userTicks = ticksMap.get(u.email) ?? {
                  dashboard_view: false,
                  dashboard_copy_reminders: false,
                  hospitals_view: false,
                  hospitals_add_edit: false,
                  questions_view: false,
                  questions_mark_answered: false,
                  clean_data_view: false,
                  clean_data_download: false,
                  rule_library_view: false,
                  rule_library_add_edit: false,
                  audit_runs_view: false,
                };

                // Admin cannot edit Owner or other Admins' access
                const canEditTicks =
                  callerRole === "OWNER" ||
                  (callerRole === "ADMIN" && u.role === "USER");

                const canRetire =
                  u.active &&
                  u.email !== me.email &&
                  u.role !== "OWNER" &&
                  (callerRole === "OWNER" || (callerRole === "ADMIN" && u.role === "USER"));

                return (
                  <tr key={u.email}>
                    <td>{i + 1}</td>
                    <td>{u.display_name || "—"}</td>
                    <td>{u.email}</td>
                    <td>
                      <Pill value={u.role} />
                    </td>
                    <td>
                      <Pill value={u.active ? "Active" : "Retired"} />
                    </td>
                    <td>{u.user_id ? "Yes" : "Not yet"}</td>
                    <td>
                      <AccessTicksModal
                        user={{ email: u.email, displayName: u.display_name, role: u.role }}
                        initialTicks={userTicks}
                        callerRole={callerRole}
                        canEdit={canEditTicks && u.active}
                      />
                    </td>
                    <td>{canRetire && <RetireButton email={u.email} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default withTiming("/settings/users-and-access", UsersAndAccessPage);
