import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/supabase/server";
import { icons } from "./icons";
import { Sidebar } from "./sidebar";

function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

// Shell for every signed-in page: sidebar, top bar, content.
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");
  const name = me.displayName ?? me.email;

  return (
    <div className="shell">
      <Sidebar role={me.role} />
      <div className="main">
        <header className="topbar">
          <div className="run" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 18, height: 18, display: "inline-flex" }}>{icons.calendar}</span>
            <span>
              Last daily run
              <br />
              <strong>none yet (scheduler comes in M9)</strong>
            </span>
          </div>
          <div className="me">
            <span className="avatar">{initials(name)}</span>
            <div>
              {name}
              <br />
              <small>{me.role ?? "no access"}</small>
            </div>
            <form action="/auth/signout" method="post">
              <button type="submit" className="link-button">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="content">
          {me.role === null ? (
            <div className="card">
              <h1>No access</h1>
              <p>Your access is not active. Ask Anoop (ADMIN).</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
