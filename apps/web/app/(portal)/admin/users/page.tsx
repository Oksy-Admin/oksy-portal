import { can } from "@/lib/roles";
import { createClient, getMe } from "@/lib/supabase/server";
import { NoAccess, PageHead, Pill } from "../../ui";
import { RetireButton, UserRoleForm } from "./forms";
import { withTiming } from "@/lib/timing";

async function UsersPage() {
  const me = await getMe();
  if (!me || !can(me.role, "manage_users")) return <NoAccess title="Users" who="an ADMIN" />;

  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from("users_roles")
    .select("email, role, display_name, active, granted_at, user_id")
    .order("active", { ascending: false })
    .order("email");

  return (
    <>
      <PageHead
        title="Settings › Users"
        subtitle="People are never deleted: retiring keeps them in the history. Every change is in the audit log."
      />
      <div className="card" style={{ marginBottom: 16 }}>
        <UserRoleForm />
      </div>
      {error ? (
        <p role="alert">Could not load users: {error.message}</p>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Signed in yet</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u, i) => (
                <tr key={u.email}>
                  <td>{i + 1}</td>
                  <td>{u.display_name}</td>
                  <td>{u.email}</td>
                  <td>
                    <Pill value={u.role} />
                  </td>
                  <td>
                    <Pill value={u.active ? "Active" : "Retired"} />
                  </td>
                  <td>{u.user_id ? "Yes" : "Not yet"}</td>
                  <td>{u.active && u.email !== me.email && <RetireButton email={u.email} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default withTiming("/admin/users", UsersPage);
