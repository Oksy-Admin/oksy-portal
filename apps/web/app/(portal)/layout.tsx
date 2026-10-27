import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/supabase/server";
import { icons } from "./icons";
import { activeSheetRuns } from "./run-now-actions";
import { RunNowButton } from "./run-now";
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
  const running = me.role ? await activeSheetRuns() : [];

  return (
    <div className="shell">
      <Sidebar role={me.role} ticks={me.ticks} />
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
          {me.role && <RunNowButton scope="ALL" running={running.length > 0} label="Run now (all hospitals)" />}
          <div className="me">
            <span className="avatar">{initials(name)}</span>
            <div>
              {name}
              <br />
              <small>{me.role ?? (me.isPending ? "Waiting for approval" : "No access")}</small>
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
            <div className="card" style={{ maxWidth: 540, margin: "6vh auto", padding: 32 }}>
              {me.isPending ? (
                <>
                  <h1>Waiting for approval</h1>
                  <p style={{ marginTop: 12, lineHeight: 1.6 }}>
                    Your sign-in with <strong>{me.email}</strong> is recorded.
                  </p>
                  <p style={{ color: "#666", lineHeight: 1.6 }}>
                    An Admin (Muhammed Ali) or the Owner (Anoop Das) will approve your account and configure your access permissions.
                    Please check back once you have been approved.
                  </p>
                </>
              ) : (
                <>
                  <h1>No access</h1>
                  <p style={{ marginTop: 12 }}>Your access is not active or has been retired. Contact an Admin if you need access restored.</p>
                </>
              )}
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
